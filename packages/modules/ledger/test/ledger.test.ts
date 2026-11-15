import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Project } from '@kathix/store';
import { replaceRange } from '@kathix/platform';
import { json, testRuntime } from '../../../../tests/helpers';

let rt: Awaited<ReturnType<typeof testRuntime>>;
let project: Project;

beforeAll(async () => {
  rt = await testRuntime();
  project = rt.ctx.store.createProject({ name: 'Ledger test', type: 'fiction' });
});
afterAll(() => rt.close());

describe('Provenance Ledger', () => {
  it('computes the human share by character and colours text by origin', async () => {
    const script = rt.ctx.store.createScript({
      projectId: project.id,
      title: 'Chapter 1',
      text: 'abcdefghij',
    });
    replaceRange(rt.ctx, {
      scriptId: script.id,
      from: 10,
      to: 10,
      text: 'XXXXX',
      origin: 'ai',
      source: 'suggestion',
    });
    replaceRange(rt.ctx, {
      scriptId: script.id,
      from: 15,
      to: 15,
      text: 'YYYYY',
      origin: 'ai_edited',
      source: 'suggestion',
    });
    const a = await json<{
      share: { humanPercent: number; ai: number; aiEdited: number };
      ranges: { origin: string }[];
    }>(rt.app.request(`/api/m/ledger/scripts/${script.id}`));
    expect(a.share).toMatchObject({ humanPercent: 50, ai: 5, aiEdited: 5 });
    expect(a.ranges.map((r) => r.origin)).toEqual(['human', 'ai', 'ai_edited']);
  });

  it('exports a Markdown disclosure statement', async () => {
    const md = await (
      await rt.app.request(`/api/m/ledger/disclosure.md?projectId=${project.id}`)
    ).text();
    expect(md).toContain('# AI use disclosure: Ledger test');
    expect(md).toContain('Written by the creator across all scripts:** 50%');
  });
});
