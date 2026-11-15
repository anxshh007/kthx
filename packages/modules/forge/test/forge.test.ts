import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ForgeItem } from '@kathix/store';
import { json, sample, testRuntime } from '../../../../tests/helpers';
import { PLATFORMS } from '../src/limits';
import type { ScoredOption } from '../src/service';

let rt: Awaited<ReturnType<typeof testRuntime>>;
const post = (path: string, body: unknown) =>
  rt.app.request(`/api/m/forge${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  rt = await testRuntime();
});
afterAll(() => rt.close());

describe('Hook and Title Forge', () => {
  it('never exceeds the platform length limit, for every kind and platform', async () => {
    for (const platform of Object.keys(PLATFORMS)) {
      for (const kind of ['title', 'hook', 'thumbnail', 'description']) {
        const { items, limit } = await json<{ items: ForgeItem[]; limit: number }>(
          post('/generate', { script: sample('episode-3.txt'), kind, platform, count: 4 }),
        );
        expect(limit).toBe(PLATFORMS[platform]?.limits[kind as 'title']);
        for (const i of items) expect(i.text.length).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('respects a custom limit', async () => {
    const { items } = await json<{ items: ForgeItem[] }>(
      post('/generate', {
        script: sample('episode-3.txt'),
        kind: 'title',
        platform: 'youtube',
        count: 3,
        maxChars: 20,
      }),
    );
    for (const i of items) expect(i.text.length).toBeLessThanOrEqual(20);
  });

  it('flags clickbait and names the claim the script lacks', async () => {
    const { items } = await json<{ items: ForgeItem[] }>(
      post('/generate', {
        script: sample('episode-2.txt'),
        kind: 'title',
        platform: 'youtube',
        count: 4,
      }),
    );
    const flagged = items
      .map((i) => i.payload as unknown as ScoredOption)
      .filter((p) => p.clickbait);
    expect(flagged.length).toBeGreaterThan(0);
    for (const f of flagged) {
      expect(f.missingPayoffs.length).toBeGreaterThan(0);
      expect(f.scores.find((s) => s.criterion.startsWith('Honesty'))?.reason).toContain(
        f.missingPayoffs[0],
      );
    }
    for (const p of items.map((i) => i.payload as unknown as ScoredOption)) {
      expect(p.scores.map((s) => s.criterion)).toEqual([
        'Clarity',
        'Curiosity',
        'Honesty to the content',
        'Voice match',
      ]);
    }
  });

  it('shortlists, refines and exports', async () => {
    const { items } = await json<{ items: ForgeItem[] }>(
      post('/generate', {
        script: sample('episode-1.txt'),
        kind: 'hook',
        platform: 'podcast',
        count: 2,
      }),
    );
    const first = items[0] as ForgeItem;
    await json(post(`/items/${first.id}/shortlist`, { on: true }));
    const refined = await json<{ items: ForgeItem[] }>(
      post(`/items/${first.id}/refine`, { note: 'shorter' }),
    );
    expect(refined.items.length).toBeGreaterThan(0);
    const md = await (await rt.app.request('/api/m/forge/shortlist.md')).text();
    expect(md).toContain(first.text);
  });
});
