import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, defineConfig } from '@playwright/test';

const PORT = 4320;
const dataDir = process.env.KATHIX_E2E_DATA ?? mkdtempSync(path.join(tmpdir(), 'kathix-e2e-'));
process.env.KATHIX_E2E_DATA = dataDir;

/** Use Playwright's own Chromium when installed; otherwise the system Edge or Chrome. */
function browserChannel(): string | undefined {
  if (process.env.KATHIX_E2E_CHANNEL) return process.env.KATHIX_E2E_CHANNEL;
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    // fall through to a system browser
  }
  return process.platform === 'win32' ? 'msedge' : 'chrome';
}

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 240_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: browserChannel(),
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @kathix/web build && pnpm --filter @kathix/web serve',
    url: `http://127.0.0.1:${PORT}/api/state`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      KATHIX_PORT: String(PORT),
      KATHIX_HOST: '127.0.0.1',
      KATHIX_MOCK_PROVIDER: '1',
      KATHIX_DATA_DIR: dataDir,
      KATHIX_LOG: 'silent',
    },
  },
});
