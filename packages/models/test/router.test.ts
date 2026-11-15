import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SecretStore, createLogger } from '@kathix/kernel';
import { Store } from '@kathix/store';
import {
  ModelRouter,
  RateBudget,
  extractJson,
  pickTierModels,
  type MockAdapter,
} from '../src/index';
import { tempDir } from '../../../tests/helpers';

function router() {
  const dir = tempDir();
  const store = new Store(path.join(dir, 'k.db'));
  const r = new ModelRouter({
    store,
    secrets: new SecretStore(dir),
    env: {},
    logger: createLogger('test', 'error'),
    mock: true,
    mockResponders: { echo: (input) => ({ echo: input }) },
  });
  return { r, store };
}

const opts = (extra: object = {}) => ({
  module: 'test',
  templateId: 'echo',
  tier: 'fast' as const,
  messages: [{ role: 'user' as const, content: 'hello' }],
  maxTokens: 50,
  temperature: 0,
  priority: 'interactive' as const,
  mockInput: 'x',
  ...extra,
});

describe('model router', () => {
  it('picks tier models from live lists by size hints, without fixed names', () => {
    const picked = pickTierModels([
      { id: 'acme-large-2', label: '', kind: 'chat' },
      { id: 'acme-mini-2', label: '', kind: 'chat' },
      { id: 'acme-standard-2', label: '', kind: 'chat' },
      { id: 'acme-embed', label: '', kind: 'embedding' },
    ]);
    expect(picked).toEqual({
      fast: 'acme-mini-2',
      balanced: 'acme-standard-2',
      deep: 'acme-large-2',
    });
  });

  it('streams, records usage and caches by prompt hash', async () => {
    const { r, store } = router();
    await r.refreshAll();
    const deltas: string[] = [];
    const first = await r.generate(opts({ onDelta: (d: string) => deltas.push(d) }));
    expect(JSON.parse(first.text)).toEqual({ echo: 'x' });
    expect(deltas.join('')).toBe(first.text);
    const second = await r.generate(opts());
    expect(second.cached).toBe(true);
    const usage = store.usageSummary();
    expect(usage.byModule[0]?.calls).toBe(2);
    expect(usage.byModule[0]?.cached).toBe(1);
  });

  it('fails over to the secondary provider when the primary errors', async () => {
    const { r } = router();
    const backup = r.addProvider({ kind: 'mock', label: 'Backup' });
    await r.refreshAll();
    r.setTier('fast', [
      { providerId: 'mock', model: 'mock-small' },
      { providerId: backup, model: 'mock-small' },
    ]);
    (r.adapter('mock') as MockAdapter).failWith = 'service unavailable';
    const res = await r.generate(opts({ cache: false }));
    expect(res.providerId).toBe(backup);
    expect(res.attempts[0]?.error).toContain('service unavailable');
  });

  it('retries on the secondary with no user action when the primary is turned off mid-request', async () => {
    const { r } = router();
    const backup = r.addProvider({ kind: 'mock', label: 'Backup' });
    await r.refreshAll();
    r.setTier('fast', [
      { providerId: 'mock', model: 'mock-small' },
      { providerId: backup, model: 'mock-small' },
    ]);
    (r.adapter('mock') as MockAdapter).latencyMs = 600;
    let resets = 0;
    const pending = r.generate(
      opts({ cache: false, mockInput: 'x'.repeat(400), onReset: () => resets++ }),
    );
    await new Promise((res) => setTimeout(res, 150));
    r.setEnabled('mock', false);
    const res = await pending;
    expect(res.providerId).toBe(backup);
    expect(resets).toBe(1);
  });

  it('gives a plain-language error when nothing can answer', async () => {
    const { r } = router();
    await r.refreshAll();
    r.setEnabled('mock', false);
    await expect(r.generate(opts({ cache: false }))).rejects.toThrow(
      /No writing model is connected/,
    );
  });

  it('queues interactive work ahead of background work in the rate budget', async () => {
    const budget = new RateBudget(60);
    for (let i = 0; i < 60; i++) await budget.acquire('background');
    const order: string[] = [];
    const bg = budget.acquire('background').then(() => order.push('background'));
    const fg = budget.acquire('interactive').then(() => order.push('interactive'));
    await Promise.all([bg, fg]);
    expect(order).toEqual(['interactive', 'background']);
  }, 10_000);

  it('extracts JSON from fenced or chatty answers', () => {
    expect(extractJson('Sure!\n```json\n{"a": "}"}\n```')).toBe('{"a": "}"}');
    expect(extractJson('prefix {"x":[1,{"y":2}]} suffix')).toBe('{"x":[1,{"y":2}]}');
  });
});
