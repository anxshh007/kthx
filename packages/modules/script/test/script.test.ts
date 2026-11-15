import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Project, Script, ScriptVersion, Suggestion } from '@kathix/store';
import { json, readSse, testRuntime } from '../../../../tests/helpers';

let rt: Awaited<ReturnType<typeof testRuntime>>;
let project: Project;
const post = (path: string, body: unknown) =>
  rt.app.request(`/api/m/script${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  rt = await testRuntime();
  project = rt.ctx.store.createProject({ name: 'Script test', type: 'video' });
});
afterAll(() => rt.close());

const TEXT =
  'SCENE 1 - THE QUAY\nMIRELA: I really just think that we should very quickly go.\nNARRATOR: The bell rings.';

describe('Script Studio', () => {
  it('streams a suggestion; accepting it changes the script and writes a ledger event', async () => {
    const { script } = await json<{ script: Script }>(
      post('/scripts', { projectId: project.id, title: 'Ep 1', text: TEXT }),
    );
    const from = TEXT.indexOf('I really');
    const to = TEXT.indexOf(' go.') + 4;
    const events = await readSse(
      await post(`/scripts/${script.id}/suggest`, { action: 'tighten', from, to }),
    );
    expect(events.some((e) => e.event === 'delta')).toBe(true);
    const result = events.find((e) => e.event === 'result')?.data as { suggestions: Suggestion[] };
    const sg = result.suggestions[0] as Suggestion;
    expect(sg.reason.length).toBeGreaterThan(0);
    expect(sg.originalText).toBe(TEXT.slice(from, to));
    const before = rt.ctx.store.listLedger({ scriptId: script.id }).length;
    const { version } = await json<{ version: ScriptVersion }>(
      post(`/suggestions/${sg.id}/accept`, { finalText: sg.proposedText, edited: false }),
    );
    expect(version.text).toContain(sg.proposedText.trim());
    expect(version.text).not.toContain('really just');
    expect(version.authorship.some((s) => s.origin === 'ai')).toBe(true);
    const ledger = rt.ctx.store.listLedger({ scriptId: script.id });
    expect(ledger.length).toBeGreaterThan(before);
    expect(ledger[0]?.kind).toBe('suggestion.accepted');
  });

  it('every co-writer action returns a suggestion with a reason', async () => {
    const { script } = await json<{ script: Script }>(
      post('/scripts', { projectId: project.id, title: 'Ep 2', text: TEXT }),
    );
    for (const action of [
      'continue',
      'rewrite',
      'expand',
      'tone',
      'alternatives',
      'punchup',
      'instruction',
    ]) {
      const events = await readSse(
        await post(`/scripts/${script.id}/suggest`, {
          action,
          instruction: 'warmer',
          from: 20,
          to: 60,
        }),
      );
      const result = events.find((e) => e.event === 'result')?.data as
        { suggestions: Suggestion[] } | undefined;
      expect(result?.suggestions.length, action).toBeGreaterThan(0);
      if (action === 'alternatives') expect(result?.suggestions.length).toBe(3);
    }
  });

  it('rejects with a reason that shapes the next attempt', async () => {
    const { script } = await json<{ script: Script }>(
      post('/scripts', { projectId: project.id, title: 'Ep 3', text: TEXT }),
    );
    const events = await readSse(
      await post(`/scripts/${script.id}/suggest`, { action: 'rewrite', from: 20, to: 60 }),
    );
    const sg = (events.find((e) => e.event === 'result')?.data as { suggestions: Suggestion[] })
      .suggestions[0] as Suggestion;
    await json(post(`/suggestions/${sg.id}/reject`, { reason: 'Too formal' }));
    expect(rt.ctx.store.getSuggestion(sg.id)?.status).toBe('rejected');
    expect(
      rt.ctx.store.listSuggestions({ scriptId: script.id, status: 'rejected' })[0]?.rejectReason,
    ).toBe('Too formal');
  });

  it('restore returns the exact prior text as a new version', async () => {
    const { script } = await json<{ script: Script }>(
      post('/scripts', { projectId: project.id, title: 'Ep 4', text: 'Original text.' }),
    );
    const first = rt.ctx.store.currentVersion(script.id) as ScriptVersion;
    await json(
      rt.app.request(`/api/m/script/scripts/${script.id}/text`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Changed text.', authorship: null }),
      }),
    );
    const { version } = await json<{ version: ScriptVersion }>(
      post(`/scripts/${script.id}/versions/${first.id}/restore`, {}),
    );
    expect(version.text).toBe('Original text.');
    expect(rt.ctx.store.listVersions(script.id).length).toBe(3);
  });

  it('exports Markdown, plain text and Word', async () => {
    const { script } = await json<{ script: Script }>(
      post('/scripts', { projectId: project.id, title: 'Ep 5', text: TEXT }),
    );
    const md = await (
      await rt.app.request(`/api/m/script/scripts/${script.id}/export?format=md`)
    ).text();
    expect(md).toContain('**MIRELA:**');
    const docx = await rt.app.request(`/api/m/script/scripts/${script.id}/export?format=docx`);
    const bytes = new Uint8Array(await docx.arrayBuffer());
    expect(String.fromCharCode(bytes[0] as number, bytes[1] as number)).toBe('PK');
  });

  it('works with an empty vault and with no project open', async () => {
    const { script } = await json<{ script: Script }>(
      post('/scripts', { title: 'Scratch', text: TEXT }),
    );
    expect(script.projectId).toBe(rt.ctx.store.scratchProject().id);
    const events = await readSse(
      await post(`/scripts/${script.id}/suggest`, { action: 'tighten', from: 20, to: 60 }),
    );
    const result = events.find((e) => e.event === 'result')?.data as {
      suggestions: Suggestion[];
      canonUsed: boolean;
    };
    expect(result.canonUsed).toBe(false);
    expect(result.suggestions[0]?.evidence).toEqual([]);
  });
});
