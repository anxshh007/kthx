import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'packages/prompts/evals/**'],
          environment: 'node',
          testTimeout: 30000,
          env: { KATHIX_MOCK_PROVIDER: '1', KATHIX_LOG: 'silent' },
        },
      },
      {
        test: {
          name: 'evals',
          include: ['packages/prompts/evals/**/*.eval.test.ts'],
          environment: 'node',
          testTimeout: 30000,
          env: { KATHIX_MOCK_PROVIDER: '1', KATHIX_LOG: 'silent' },
        },
      },
    ],
  },
});
