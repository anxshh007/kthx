import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface KathixConfig {
  rootDir: string;
  dataDir: string;
  dbPath: string;
  port: number;
  host: string;
  mockProvider: boolean;
  env: Record<string, string | undefined>;
}

/** Repository root: the folder holding pnpm-workspace.yaml. */
export function findRootDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function loadConfig(overrides: Partial<Pick<KathixConfig, 'dataDir'>> = {}): KathixConfig {
  const rootDir = findRootDir();
  const envFile = path.join(rootDir, '.env');
  if (existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      // A malformed .env is ignored; variables can still come from the shell.
    }
  }
  const env = process.env;
  const rawData = overrides.dataDir ?? env.KATHIX_DATA_DIR ?? 'data';
  const dataDir = path.isAbsolute(rawData) ? rawData : path.join(rootDir, rawData);
  mkdirSync(dataDir, { recursive: true });
  return {
    rootDir,
    dataDir,
    dbPath: path.join(dataDir, 'kathix.db'),
    port: Number(env.KATHIX_PORT ?? 4319),
    host: env.KATHIX_HOST ?? '127.0.0.1',
    mockProvider: env.KATHIX_MOCK_PROVIDER === '1',
    env: { ...env },
  };
}
