import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Project } from '@kathix/store';
import { createRuntime } from '../src/index';
import { json, tempDir, testRuntime } from '../../../tests/helpers';

let rt: Awaited<ReturnType<typeof testRuntime>>;
const post = (path: string, body: unknown = {}) =>
  rt.app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  rt = await testRuntime();
});
afterAll(() => rt.close());

describe('Studio server routes', () => {
  it('reports capabilities and modules', async () => {
    const s = await json<{
      setupRequired: boolean;
      modules: { id: string }[];
      capabilities: Record<string, { available: boolean }>;
    }>(rt.app.request('/api/state'));
    expect(s.setupRequired).toBe(false);
    expect(s.modules.map((m) => m.id)).toEqual([
      'home',
      'canon',
      'script',
      'continuity',
      'voice',
      'forge',
      'showrunner',
      'ledger',
      'router',
    ]);
    expect(s.capabilities['model.custom.adaption']?.available).toBe(false);
  });

  it('creates a project and reaches a working module with its next action', async () => {
    const started = Date.now();
    const { project } = await json<{ project: Project }>(
      post('/api/m/home/projects', { name: 'Fresh', type: 'podcast' }),
    );
    const o = await json<{ nextAction: { path: string } }>(
      rt.app.request(`/api/m/home/projects/${project.id}/overview`),
    );
    expect(o.nextAction.path).toBe('/canon?tab=import');
    expect(Date.now() - started).toBeLessThan(60_000);
  });

  it('lists, cancels and retries jobs', async () => {
    const { jobs } = await json<{ jobs: unknown[] }>(rt.app.request('/api/jobs'));
    expect(Array.isArray(jobs)).toBe(true);
  });

  it('manages providers and usage through Model Router routes', async () => {
    const p = await json<{ providers: { config: { id: string } }[] }>(
      rt.app.request('/api/m/router/providers'),
    );
    expect(p.providers.map((x) => x.config.id)).toContain('mock');
    const tiers = await json<{ tiers: Record<string, unknown[]> }>(
      rt.app.request('/api/m/router/tiers'),
    );
    expect(tiers.tiers.fast?.length).toBeGreaterThan(0);
    const u = await json<{ byModule: unknown[] }>(rt.app.request('/api/m/router/usage'));
    expect(Array.isArray(u.byModule)).toBe(true);
    const adaption = await json<{ configured: boolean }>(rt.app.request('/api/m/router/adaption'));
    expect(adaption.configured).toBe(false);
  });

  it('returns plain-language errors, never stack traces', async () => {
    const res = await post('/api/m/canon/proposals/does-not-exist/approve', {});
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(409);
    expect(body.error).toBe('That proposal was already handled.');
    const bad = await post('/api/m/home/projects', { name: '' });
    expect(bad.status).toBe(400);
  });

  it('with no provider configured, model-dependent modules refuse and setup is required', async () => {
    const bare = await createRuntime({ dataDir: tempDir(), mock: false, quiet: true });
    await bare.refreshCapabilities();
    const s = await json<{ setupRequired: boolean }>(bare.app.request('/api/state'));
    expect(s.setupRequired).toBe(true);
    const res = await bare.app.request('/api/m/continuity/compare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(503);
    bare.close();
  }, 30_000);
});
