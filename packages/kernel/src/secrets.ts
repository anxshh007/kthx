import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';

/**
 * Encrypted local settings file (AES-256-GCM). Provider keys entered in the
 * Studio live here, never in the database or logs. The key file sits in the
 * git-ignored data folder with owner-only permissions.
 */
export class SecretStore {
  private keyPath: string;
  private filePath: string;
  private cache: Record<string, string> | null = null;

  constructor(dataDir: string) {
    this.keyPath = path.join(dataDir, '.kathix-key');
    this.filePath = path.join(dataDir, 'secrets.enc');
  }

  private key(): Buffer {
    if (!existsSync(this.keyPath)) {
      writeFileSync(this.keyPath, randomBytes(32));
      try {
        chmodSync(this.keyPath, 0o600);
      } catch {
        // Permissions are best-effort on Windows.
      }
    }
    return readFileSync(this.keyPath);
  }

  private load(): Record<string, string> {
    if (this.cache) return this.cache;
    if (!existsSync(this.filePath)) {
      this.cache = {};
      return this.cache;
    }
    const raw = readFileSync(this.filePath);
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key(), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    this.cache = JSON.parse(json) as Record<string, string>;
    return this.cache;
  }

  private save(data: Record<string, string>): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    writeFileSync(this.filePath, Buffer.concat([iv, cipher.getAuthTag(), body]));
    this.cache = data;
  }

  get(name: string): string | undefined {
    return this.load()[name];
  }

  set(name: string, value: string | null): void {
    const data = { ...this.load() };
    if (value === null || value === '') delete data[name];
    else data[name] = value;
    this.save(data);
  }
}
