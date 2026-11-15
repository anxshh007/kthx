import type { CliModule } from '@kathix/platform';
import type { LedgerService } from './server';

const cli: CliModule = {
  register(program, getContext) {
    const cmd = program
      .command('ledger')
      .description('Show authorship shares and export an AI disclosure statement');
    cmd
      .command('report')
      .description('Authorship share per script')
      .option('--project <id>', 'project id (default: Scratchpad)')
      .action(async (o: { project?: string }) => {
        const ctx = await getContext();
        const s = ctx.use<LedgerService>('ledger') as LedgerService;
        const p = s.project(o.project ?? ctx.store.scratchProject().id);
        console.log(`${p.project.name}: ${p.total.humanPercent}% written by the creator`);
        for (const sc of p.scripts)
          console.log(
            `  ${sc.title}: ${sc.share.humanPercent}% human, ${sc.share.ai} AI chars, ${sc.share.aiEdited} AI-then-edited chars`,
          );
        console.log(
          `Suggestions: ${p.suggestions.offered} offered, ${p.suggestions.accepted} accepted, ${p.suggestions.edited} edited, ${p.suggestions.rejected} rejected`,
        );
      });
    cmd
      .command('disclosure')
      .description('Print a Markdown disclosure statement for a project or one script')
      .option('--project <id>', 'project id (default: Scratchpad)')
      .option('--script <id>', 'one script instead of the whole project')
      .action(async (o: { project?: string; script?: string }) => {
        const ctx = await getContext();
        const s = ctx.use<LedgerService>('ledger') as LedgerService;
        console.log(
          o.script
            ? s.disclosure({ scriptId: o.script })
            : s.disclosure({ projectId: o.project ?? ctx.store.scratchProject().id }),
        );
      });
  },
};

export default cli;
