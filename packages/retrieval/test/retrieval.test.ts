import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '@kathix/store';
import { budget, chunkScript, indexEntry, indexScript, retrieve } from '../src/index';
import { sample, tempDir } from '../../../tests/helpers';

describe('retrieval', () => {
  it('chunks scripts by scene with exact offsets', () => {
    const text = sample('episode-1.txt');
    const chunks = chunkScript(text, 'Ep 1', 1);
    expect(chunks).toHaveLength(4);
    for (const c of chunks) expect(text.slice(c.start, c.end)).toBe(c.text);
    expect(chunks[1]?.label).toContain('THE RADIO SHED');
  });

  it('budgets context and reports exactly what was included', () => {
    const items = [{ text: 'a'.repeat(400) }, { text: 'b'.repeat(400) }, { text: 'c'.repeat(40) }];
    const r = budget(items, 120);
    expect(r.included.map((i) => i.text[0])).toEqual(['a', 'c']);
    expect(r.dropped).toHaveLength(1);
    expect(r.tokens).toBe(110);
  });

  it('ranks by full text and boosts canon entries named in the passage', async () => {
    const store = new Store(path.join(tempDir(), 'k.db'));
    const p = store.createProject({ name: 'P', type: 'podcast' });
    const base = {
      projectId: p.id,
      aliases: [],
      sourceDocId: null,
      sourceStart: null,
      sourceEnd: null,
      timelineOrder: null,
      timelineLabel: '',
      plantedIn: '',
    };
    const teo = store.createEntry({
      ...base,
      type: 'character',
      name: 'Teodor Voss',
      summary: 'Ferry apprentice.',
      attributes: { Fears: 'deep water' },
      sourceQuote: 'Teodor fears deep water.',
    });
    const odile = store.createEntry({
      ...base,
      type: 'character',
      name: 'Odile Marr',
      summary: 'Skipper of the Gannet.',
      attributes: {},
      sourceQuote: 'Odile runs the crossing.',
    });
    const bell = store.createEntry({
      ...base,
      type: 'rule',
      name: 'The curfew bell',
      summary: 'Harbour closes at dusk.',
      attributes: {},
      sourceQuote: 'The bell closes the harbour.',
    });
    for (const e of [teo, odile, bell]) indexEntry(store, e);
    store.addLink(p.id, teo.id, odile.id, 'apprentice to');
    const script = store.createScript({
      projectId: p.id,
      title: 'Ep 1',
      episode: 1,
      text: 'SCENE 1\nThe harbour closes when the bell rings.',
    });
    indexScript(store, script, 'SCENE 1\nThe harbour closes when the bell rings.');
    const hits = await retrieve(store, {
      projectId: p.id,
      query: 'Teodor stands at the rail.',
      kinds: ['canon'],
    });
    expect(hits[0]?.sourceId).toBe(teo.id);
    expect(hits.find((h) => h.sourceId === odile.id)?.why).toContain(
      'linked to someone in this passage',
    );
    const harbour = await retrieve(store, {
      projectId: p.id,
      query: 'when does the harbour close',
    });
    expect(harbour.some((h) => h.sourceId === bell.id)).toBe(true);
  });
});
