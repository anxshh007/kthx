import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContinuityIssue, Project, Script } from '@kathix/store';
import { json, readSse, testRuntime } from '../../../../tests/helpers';
import type { FoundIssue } from '../src/service';

let rt: Awaited<ReturnType<typeof testRuntime>>;
let project: Project;
let ep4: Script;
const post = (path: string, body: unknown = {}) =>
  rt.app.request(`/api/m/continuity${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const PLANTED = [
  /brown eyes/,
  /Teodor dove into the deep water/,
  /^BRANNOCH:/,
  /Ilsabeth/,
  /after the curfew bell/,
];

beforeAll(async () => {
  rt = await testRuntime();
  project = await (rt.ctx.use('home') as { seedSample(): Promise<Project> }).seedSample();
  ep4 = rt.ctx.store.listScripts(project.id).find((s) => s.episode === 4) as Script;
});
afterAll(() => rt.close());

async function check(): Promise<ContinuityIssue[]> {
  const events = await readSse(await post(`/scripts/${ep4.id}/check`));
  const result = events.find((e) => e.event === 'result')?.data as { issues: ContinuityIssue[] };
  return result.issues;
}

describe('Continuity Guard', () => {
  it('finds at least four of the five planted contradictions, each quoting both passages verbatim', async () => {
    const issues = await check();
    const found = PLANTED.filter((re) => issues.some((i) => re.test(i.draftQuote)));
    expect(found.length).toBeGreaterThanOrEqual(4);
    const draft = rt.ctx.store.currentVersion(ep4.id)?.text ?? '';
    const entries = new Map(rt.ctx.store.listEntries(project.id).map((e) => [e.id, e]));
    for (const i of issues) {
      expect(draft.slice(i.draftStart, i.draftEnd)).toBe(i.draftQuote);
      const ref = entries.get(i.refId);
      expect(ref, `issue cites a real canon entry: ${i.summary}`).toBeTruthy();
      const block = `Name: ${ref?.name}\n${Object.entries(ref?.attributes ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')}`;
      expect(block.includes(i.refQuote) || ref?.sourceQuote.includes(i.refQuote)).toBe(true);
      expect(['low', 'medium', 'high']).toContain(i.severity);
      expect(i.confidence).toBeGreaterThan(0);
    }
  });

  it('remembers intentional marks and never raises them again', async () => {
    const issues = await check();
    const drift = issues.find((i) => i.type === 'name_drift') as ContinuityIssue;
    await json(post(`/issues/${drift.id}/intentional`));
    const again = await check();
    expect(again.some((i) => i.draftQuote === drift.draftQuote && i.type === 'name_drift')).toBe(
      false,
    );
  });

  it('applies a fix to the script as an AI change, and can edit canon instead', async () => {
    const issues = await check();
    const eyes = issues.find((i) => /brown eyes/.test(i.draftQuote)) as ContinuityIssue;
    await json(post(`/issues/${eyes.id}/apply`, { text: eyes.fixText, edited: false }));
    expect(rt.ctx.store.currentVersion(ep4.id)?.text).toContain('grey eyes');
    const rule = issues.find((i) => i.type === 'world_rule') as ContinuityIssue;
    const r = await json<{ entry: { summary: string } }>(
      post(`/issues/${rule.id}/edit-canon`, {
        summary: 'Boats may leave after the bell only for a rescue.',
      }),
    );
    expect(r.entry.summary).toContain('rescue');
  });

  it('two-box mode works with no project', async () => {
    const events = await readSse(
      await post('/compare', {
        reference: 'Name: Mirela\nEyes: grey',
        draft: 'Mirela turned her brown eyes to the sea.',
      }),
    );
    const result = events.find((e) => e.event === 'result')?.data as { issues: FoundIssue[] };
    expect(Array.isArray(result.issues)).toBe(true);
  });

  it('reports project health per script', async () => {
    const res = await json<{ scripts: { id: string; runs: unknown[] }[] }>(
      rt.app.request(`/api/m/continuity/health?projectId=${project.id}`),
    );
    expect(res.scripts.find((s) => s.id === ep4.id)?.runs.length).toBeGreaterThan(0);
  });
});
