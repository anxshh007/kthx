import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/index';
import { tempDir } from '../../../tests/helpers';

const open = () => new Store(path.join(tempDir(), 'k.db'));

describe('store', () => {
  it('applies migrations and passes the write probe', () => {
    const s = open();
    expect(s.probe()).toBe(true);
    expect(s.db.all('SELECT id FROM schema_migrations').length).toBeGreaterThan(0);
  });

  it('never overwrites a script: every change is a new version', () => {
    const s = open();
    const p = s.createProject({ name: 'P', type: 'video' });
    const sc = s.createScript({ projectId: p.id, title: 'Ep 1', text: 'first' });
    const v1 = s.currentVersion(sc.id);
    const same = s.saveVersion(sc.id, v1?.text ?? '', v1?.authorship ?? null, 'edit');
    expect(same.id).toBe(v1?.id);
    s.saveVersion(sc.id, 'second', null, 'edit');
    s.saveVersion(sc.id, 'third', null, 'edit');
    const versions = s.listVersions(sc.id);
    expect(versions.map((v) => v.seq)).toEqual([3, 2, 1]);
    expect(s.getVersion(v1?.id ?? '')?.text).toBe('first');
  });

  it('searches chunks with full-text ranking and stemming', () => {
    const s = open();
    const p = s.createProject({ name: 'P', type: 'video' });
    s.replaceChunks(p.id, 'canon', 'e1', [
      {
        label: 'Lighthouse',
        start: 0,
        end: 10,
        text: 'The lighthouse keeper climbs the stair',
        ordinal: 0,
      },
    ]);
    s.replaceChunks(p.id, 'canon', 'e2', [
      { label: 'Harbour', start: 0, end: 10, text: 'Boats sleep in the harbour', ordinal: 0 },
    ]);
    const hits = s.searchChunks(p.id, 'lighthouses climbing');
    expect(hits[0]?.sourceId).toBe('e1');
    s.replaceChunks(p.id, 'canon', 'e1', []);
    expect(s.searchChunks(p.id, 'lighthouse')).toHaveLength(0);
  });

  it('remembers continuity dismissals per project', () => {
    const s = open();
    const p = s.createProject({ name: 'P', type: 'video' });
    s.addDismissal(p.id, 'fp1', 'Intentional');
    expect(s.listDismissals(p.id).map((d) => d.fingerprint)).toEqual(['fp1']);
    s.removeDismissal(p.id, 'fp1');
    expect(s.listDismissals(p.id)).toHaveLength(0);
  });

  it('keeps a hidden scratchpad project for standalone use', () => {
    const s = open();
    const scratch = s.scratchProject();
    expect(s.scratchProject().id).toBe(scratch.id);
    expect(s.listProjects().some((p) => p.id === scratch.id)).toBe(false);
  });
});
