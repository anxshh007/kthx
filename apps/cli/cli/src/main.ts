#!/usr/bin/env node
import { Command } from 'commander';
import { findRootDir } from '@kathix/kernel';
import { createRuntime, loadCliModules, type Runtime } from '@kathix/runtime';
import type { ModuleContext } from '@kathix/platform';

async function main() {
  const program = new Command();
  program
    .name('kathix')
    .description(
      'Kathix: a production co-pilot stack for serialized creators. Every Studio module is also a command.',
    )
    .option('--data-dir <dir>', 'folder holding the Kathix library (default: ./data)');

  let runtime: Runtime | null = null;
  const getContext = async (): Promise<ModuleContext> => {
    if (!runtime) {
      process.env.KATHIX_LOG = process.env.KATHIX_LOG ?? 'silent';
      const opts = program.opts<{ dataDir?: string }>();
      runtime = await createRuntime({ dataDir: opts.dataDir, quiet: true });
      await runtime.refreshCapabilities();
    }
    return runtime.ctx;
  };

  for (const m of await loadCliModules(findRootDir())) m.register(program, getContext);

  program
    .command('capabilities')
    .description('Show what can run right now (the same check the Studio uses)')
    .action(async () => {
      const ctx = await getContext();
      for (const [k, v] of Object.entries(ctx.capabilities.snapshot()))
        console.log(`${v.available ? '✓' : '✗'} ${k.padEnd(22)} ${v.detail}`);
    });

  program.hook('preAction', async (_cmd, action) => {
    // Commands that need a model refuse plainly instead of failing midway.
    const needsModel = [
      'canon import',
      'script suggest',
      'continuity compare',
      'continuity check',
      'forge',
      'showrunner',
    ];
    const full =
      `${action.parent?.name() === 'kathix' ? '' : `${action.parent?.name()} `}${action.name()}`.trim();
    if (needsModel.includes(full)) {
      const ctx = await getContext();
      if (!ctx.capabilities.has('model.structured')) {
        console.error(
          'No writing model is connected. Add a key to .env or connect one in the Studio’s Model Router, then try again.',
        );
        process.exit(2);
      }
    }
  });

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    (runtime as Runtime | null)?.close();
  }
}

void main();
