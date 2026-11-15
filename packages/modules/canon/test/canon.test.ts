import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CanonEntry, CanonProposal, Project } from '@kathix/store';
import { json, sample, testRuntime } from '../../../../tests/helpers';
import { parseBible } from '../src/bible';

let rt: Awaited<ReturnType<typeof testRuntime>>;
let project: Project;
const req = (path: string, init?: RequestInit) => rt.app.request(`/api/m/canon${path}`, init);
const post = (path: string, body: unknown) =>
  req(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  rt = await testRuntime();
  project = rt.ctx.store.createProject({ name: 'Canon test', type: 'podcast' });
});
afterAll(() => rt.close());

describe('Canon Vault', () => {
  it('parses the structured sample bible into 25+ entries, each with its exact source section', () => {
    const text = sample('bible.md');
    const entries = parseBible(text);
    expect(entries.length).toBeGreaterThanOrEqual(25);
    for (const e of entries) expect(text.slice(e.start, e.end)).toBe(e.quote);
    expect(entries.find((e) => e.name === 'Mirela Voss')?.attributes.Eyes).toBe('grey');
  });

  it('imports an episode in the background; every proposal cites a verbatim source span', async () => {
    const text = sample('episode-1.txt');
    const { job, doc } = await json<{ job: { id: string }; doc: { id: string } }>(
      post('/import', {
        projectId: project.id,
        title: 'Episode 1',
        file: { name: 'ep1.txt', text },
      }),
    );
    const done = await rt.ctx.jobs.wait(job.id);
    expect(done.status).toBe('succeeded');
    const { proposals } = await json<{ proposals: CanonProposal[] }>(
      req(`/proposals?projectId=${project.id}`),
    );
    expect(proposals.length).toBeGreaterThan(2);
    const stored = rt.ctx.store.getDoc(doc.id)?.text ?? '';
    for (const p of proposals) expect(stored.slice(p.start, p.end)).toBe(p.quote);
  });

  it('approved entries appear in search, timeline and the relationship graph', async () => {
    const { proposals } = await json<{ proposals: CanonProposal[] }>(
      req(`/proposals?projectId=${project.id}`),
    );
    const mirela = proposals.find((p) => p.name.startsWith('Mirela')) as CanonProposal;
    const { entry } = await json<{ entry: CanonEntry }>(
      post(`/proposals/${mirela.id}/approve`, { attributes: { Eyes: 'grey' } }),
    );
    const teo = await json<{ entry: CanonEntry }>(
      post('/entries', {
        projectId: project.id,
        type: 'character',
        name: 'Teodor',
        summary: 'Her brother.',
        attributes: {},
      }),
    );
    await json(
      post('/links', {
        projectId: project.id,
        fromId: entry.id,
        toId: teo.entry.id,
        relation: 'sister of',
      }),
    );
    const event = await json<{ entry: CanonEntry }>(
      post('/entries', {
        projectId: project.id,
        type: 'event',
        name: 'The Long Night storm',
        summary: 'The storm.',
        attributes: {},
      }),
    );
    await json(
      rt.app.request(`/api/m/canon/entries/${event.entry.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ timelineOrder: 1, timelineLabel: 'Three years ago' }),
      }),
    );

    const search = await json<{ hits: { id: string }[] }>(
      rt.app.request(`/api/m/home/search?q=Mirela&projectId=${project.id}`),
    );
    expect(search.hits.some((h) => h.id === entry.id)).toBe(true);
    const timeline = await json<{ events: CanonEntry[] }>(req(`/timeline?projectId=${project.id}`));
    expect(timeline.events.map((e) => e.name)).toContain('The Long Night storm');
    const graph = await json<{ nodes: { id: string }[]; edges: { relation: string }[] }>(
      req(`/graph?projectId=${project.id}`),
    );
    expect(graph.nodes.map((n) => n.id)).toEqual(expect.arrayContaining([entry.id, teo.entry.id]));
    expect(graph.edges[0]?.relation).toBe('sister of');
  });

  it('merges, rejects, restores and bulk-approves proposals', async () => {
    const { proposals } = await json<{ proposals: CanonProposal[] }>(
      req(`/proposals?projectId=${project.id}`),
    );
    const [a, b] = proposals as [CanonProposal, CanonProposal];
    await json(post(`/proposals/${a.id}/reject`, {}));
    await json(post(`/proposals/${a.id}/restore`, {}));
    const target = (await json<{ entries: CanonEntry[] }>(req(`/entries?projectId=${project.id}`)))
      .entries[0] as CanonEntry;
    const merged = await json<{ entry: CanonEntry }>(
      post(`/proposals/${b.id}/merge`, { targetId: target.id }),
    );
    expect(merged.entry.id).toBe(target.id);
    const r = await json<{ approved: number }>(
      post('/proposals/bulk-approve', { projectId: project.id, type: a.type }),
    );
    expect(r.approved).toBeGreaterThan(0);
  });

  it('exports the vault to Markdown and JSON', async () => {
    const md = await (await req(`/export.md?projectId=${project.id}`)).text();
    expect(md).toContain('Story bible');
    const js = await json<{ entries: unknown[] }>(req(`/export.json?projectId=${project.id}`));
    expect(js.entries.length).toBeGreaterThan(0);
  });

  it('works with no project open (Scratchpad vault)', async () => {
    const { entry } = await json<{ entry: CanonEntry }>(
      post('/entries', {
        type: 'place',
        name: 'Hollow Quay',
        summary: 'Ruined jetty.',
        attributes: {},
      }),
    );
    expect(entry.projectId).toBe(rt.ctx.store.scratchProject().id);
  });
});
