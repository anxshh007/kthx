/**
 * Runs every eval case against the real providers configured in .env or the
 * Studio, and writes the results into docs/EVALS.md. Usage: `pnpm evals:real`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRuntime } from '@kathix/runtime';
import { cases, runCase } from './cases';

async function main() {
  process.env.KATHIX_LOG = 'silent';
  const rt = await createRuntime({ mock: false, quiet: true });
  await rt.refreshCapabilities();
  const docPath = path.join(rt.ctx.config.rootDir, 'docs', 'EVALS.md');
  const marker = '<!-- real-provider-results -->';
  const doc = readFileSync(docPath, 'utf8');
  const head = doc.includes(marker) ? doc.slice(0, doc.indexOf(marker)) : `${doc.trimEnd()}\n\n`;
  let body: string;
  if (!rt.ctx.capabilities.has('model.structured')) {
    body = `${marker}\n\n_Last attempted ${new Date().toISOString()}: no real provider was configured, so no real-provider results were recorded._\n`;
    console.log('No real provider is configured. Add a key to .env and run again.');
  } else {
    const rows: string[] = [];
    let passed = 0;
    for (const c of cases()) {
      const r = await runCase(rt.ctx.router, c);
      if (r.ok) passed++;
      rows.push(
        `| ${c.name} | ${r.ok ? 'pass' : 'fail'} | ${r.model || '—'} | ${r.errors.join('; ').replace(/\|/g, '/') || ''} |`,
      );
      console.log(
        `${r.ok ? 'PASS' : 'FAIL'} ${c.name}${r.errors.length ? ` — ${r.errors.join('; ')}` : ''}`,
      );
    }
    body = `${marker}\n\nRun ${new Date().toISOString()}: ${passed}/${rows.length} passed.\n\n| Case | Result | Model | Notes |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`;
  }
  writeFileSync(docPath, head + body);
  rt.close();
}

void main();
