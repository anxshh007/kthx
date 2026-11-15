import type { CliModule } from '@kathix/platform';
import { createRouterService } from './server';

const cli: CliModule = {
  register(program, getContext) {
    const cmd = program
      .command('router')
      .description('Check model providers, test connections and see usage');
    cmd
      .command('status')
      .description('List providers, their state and the model chosen for each tier')
      .action(async () => {
        const ctx = await getContext();
        const s = createRouterService(ctx);
        for (const p of s.providers()) {
          console.log(
            `${p.config.enabled ? '●' : '○'} ${p.config.label} [${p.config.id}] ${p.status}${p.lastError ? ` – ${p.lastError}` : ''}`,
          );
        }
        const tiers = s.tiers();
        for (const t of ['fast', 'balanced', 'deep'] as const) {
          console.log(
            `${t.padEnd(9)} ${tiers[t].map((x) => `${x.providerId}/${x.model}`).join(' → ') || '(none)'}`,
          );
        }
        const caps = ctx.capabilities.snapshot();
        for (const [k, v] of Object.entries(caps))
          console.log(`${v.available ? '✓' : '✗'} ${k}: ${v.detail}`);
      });
    cmd
      .command('test <providerId>')
      .description('Run a real one-token call against a provider')
      .action(async (id: string) => {
        const s = createRouterService(await getContext());
        const r = await s.test(id);
        console.log(r.ok ? `Connected: ${r.message}` : `Failed: ${r.message}`);
        if (!r.ok) process.exitCode = 1;
      });
    cmd
      .command('usage')
      .description('Calls, tokens and estimated cost per module and per day')
      .action(async () => {
        const u = createRouterService(await getContext()).usage();
        console.log('By module');
        for (const m of u.byModule)
          console.log(
            `  ${m.module.padEnd(12)} ${m.calls} calls  ${m.inputTokens} in  ${m.outputTokens} out  ${m.cost === null ? '' : `$${m.cost.toFixed(4)}`}`,
          );
        console.log('By day');
        for (const d of u.byDay)
          console.log(`  ${d.day}  ${d.calls} calls  ${d.inputTokens + d.outputTokens} tokens`);
      });
  },
};

export default cli;
