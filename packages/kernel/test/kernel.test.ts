import { describe, expect, it } from 'vitest';
import {
  CapabilityRegistry,
  JobQueue,
  SecretStore,
  applyAuthorChange,
  authorshipShare,
  fitSpans,
  locateQuote,
  redact,
  scriptStats,
  splitSentences,
  type JobRecord,
  type JobStatus,
  type JobStorage,
} from '../src/index';
import { tempDir } from '../../../tests/helpers';

function memoryStorage(): JobStorage & { all: Map<string, JobRecord> } {
  const all = new Map<string, JobRecord>();
  return {
    all,
    insert: (j) => void all.set(j.id, structuredClone(j)),
    update: (id, p) => {
      const cur = all.get(id);
      if (cur) all.set(id, { ...cur, ...p });
    },
    get: (id) => structuredClone(all.get(id) ?? null),
    listByStatus: (s: JobStatus[]) => [...all.values()].filter((j) => s.includes(j.status)),
  };
}

describe('authorship', () => {
  it('maps insertions and deletions and keeps unchanged text', () => {
    let spans = fitSpans([], 10);
    spans = applyAuthorChange(spans, 4, 6, 5, 'ai');
    expect(spans).toEqual([
      { len: 4, origin: 'human' },
      { len: 5, origin: 'ai' },
      { len: 4, origin: 'human' },
    ]);
    spans = applyAuthorChange(spans, 6, 6, 2, 'human');
    expect(authorshipShare(spans)).toMatchObject({ total: 15, human: 10, ai: 5 });
  });

  it('computes the human share from characters', () => {
    expect(
      authorshipShare([
        { len: 75, origin: 'human' },
        { len: 25, origin: 'ai_edited' },
      ]).humanPercent,
    ).toBe(75);
    expect(authorshipShare([]).humanPercent).toBe(100);
  });
});

describe('text', () => {
  it('locates exact and typographically different quotes with original offsets', () => {
    const src = 'She said, “The lamp never goes dark.” Then she left.';
    const exact = locateQuote(src, 'Then she left.');
    expect(exact && src.slice(exact.start, exact.end)).toBe('Then she left.');
    const loose = locateQuote(src, '"The lamp  never goes dark."');
    expect(loose && src.slice(loose.start, loose.end)).toBe('“The lamp never goes dark.”');
    expect(locateQuote(src, 'a sentence that is not there')).toBeNull();
  });

  it('splits sentences with offsets', () => {
    const s = splitSentences('One. Two words! Three?');
    expect(s.map((x) => x.text)).toEqual(['One.', 'Two words!', 'Three?']);
    expect(s[1]?.start).toBe(5);
  });

  it('counts scenes and runtime for scripts', () => {
    const st = scriptStats(
      'SCENE 1 - A\nMIRELA: Hello there friend.\n[SFX: wind]\nSCENE 2 - B\nNARRATOR: Night falls.',
      'podcast',
    );
    expect(st.scenes).toBe(2);
    expect(st.words).toBeGreaterThan(5);
  });
});

describe('job queue', () => {
  it('runs interactive work before background work', async () => {
    const storage = memoryStorage();
    const q = new JobQueue(storage, 1);
    const order: string[] = [];
    q.register('t', async (job) => {
      order.push(String(job.input));
    });
    q.enqueue('t', 'background-1', { priority: 'background' });
    q.enqueue('t', 'interactive-1', { priority: 'interactive' });
    q.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual(['interactive-1', 'background-1']);
  });

  it('resumes a job that was running when the process stopped, with its checkpoint', async () => {
    const storage = memoryStorage();
    const first = new JobQueue(storage, 1);
    let release: () => void = () => undefined;
    first.register('long', (_job, ctx) => {
      ctx.checkpoint({ step: 2 });
      return new Promise<void>((r) => (release = r));
    });
    const job = first.enqueue('long', null);
    first.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(storage.get(job.id)?.status).toBe('running');
    first.stop();
    release();
    const second = new JobQueue(storage, 1);
    let resumedFrom: unknown = null;
    second.register('long', async (j) => {
      resumedFrom = j.state;
      return 'ok';
    });
    second.start();
    const done = await second.wait(job.id);
    expect(done.status).toBe('succeeded');
    expect(resumedFrom).toEqual({ step: 2 });
  });

  it('cancels and retries', async () => {
    const storage = memoryStorage();
    const q = new JobQueue(storage, 1);
    let fail = true;
    q.register('flaky', async () => {
      if (fail) throw new Error('No writing model is connected right now.');
      return 'fine';
    });
    q.start();
    const job = q.enqueue('flaky', null);
    expect((await q.wait(job.id)).status).toBe('failed');
    fail = false;
    q.retry(job.id);
    expect((await q.wait(job.id)).status).toBe('succeeded');
  });
});

describe('capabilities', () => {
  it('runs probes in order and notifies on change', async () => {
    const reg = new CapabilityRegistry();
    const seen: string[] = [];
    reg.setProbe('store.ready', async () => {
      seen.push('store');
      return { ok: true, detail: '' };
    });
    reg.setProbe('model.text', async () => {
      seen.push('text');
      return { ok: reg.has('store.ready'), detail: '' };
    });
    let changes = 0;
    reg.onChange(() => changes++);
    await reg.refresh();
    expect(seen).toEqual(['store', 'text']);
    expect(reg.hasAll(['store.ready', 'model.text'])).toBe(true);
    expect(changes).toBe(1);
  });
});

describe('secrets and logs', () => {
  it('stores keys encrypted on disk', async () => {
    const dir = tempDir();
    const s = new SecretStore(dir);
    s.set('provider.x.key', 'sk-test-1234567890abcdef');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(`${dir}/secrets.enc`).toString('latin1')).not.toContain('sk-test');
    expect(new SecretStore(dir).get('provider.x.key')).toBe('sk-test-1234567890abcdef');
  });

  it('redacts keys from log lines', () => {
    expect(redact('key sk-ant-abcdefghijklmnop and Bearer abcdefghijkl')).toBe(
      'key [redacted] and Bearer [redacted]',
    );
  });
});
