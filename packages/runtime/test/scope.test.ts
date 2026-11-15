import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../../tests/helpers';

const FINALE = /repurpose|storyboard|publish packager|idea lab|production governor|device mesh/i;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'test') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx|json|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

describe('round 1 scope', () => {
  it('has no trace of the finale modules in code or UI', () => {
    const hits = [
      ...files(path.join(ROOT, 'packages')),
      ...files(path.join(ROOT, 'apps')),
      path.join(ROOT, 'modules.config.json'),
    ].filter((f) => FINALE.test(readFileSync(f, 'utf8')));
    expect(hits.map((h) => path.relative(ROOT, h))).toEqual([]);
  });

  it('ships no stubs, placeholders or commented-out work markers', () => {
    const hits = [...files(path.join(ROOT, 'packages')), ...files(path.join(ROOT, 'apps'))].filter(
      (f) => /\b(TODO|FIXME|XXX|coming soon|not implemented)\b/i.test(readFileSync(f, 'utf8')),
    );
    expect(hits.map((h) => path.relative(ROOT, h))).toEqual([]);
  });
});
