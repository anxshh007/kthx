import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SecretStore, createLogger } from '@kathix/kernel';
import { ModelRouter } from '@kathix/models';
import { Store } from '@kathix/store';
import { TEMPLATES, mockResponders } from '../src/index';
import { tempDir } from '../../../tests/helpers';
import { cases, runCase } from './cases';

describe('prompt evals (test provider)', async () => {
  const dir = tempDir();
  const router = new ModelRouter({
    store: new Store(path.join(dir, 'k.db')),
    secrets: new SecretStore(dir),
    env: {},
    logger: createLogger('evals', 'error'),
    mock: true,
    mockResponders,
  });
  await router.refreshAll();

  it('covers every template', () => {
    const covered = new Set(cases().map((c) => c.template.id));
    expect(TEMPLATES.filter((t) => !covered.has(t.id)).map((t) => t.id)).toEqual([]);
  });

  for (const c of cases()) {
    it(c.name, async () => {
      const r = await runCase(router, c);
      expect(r.errors).toEqual([]);
    });
  }
});
