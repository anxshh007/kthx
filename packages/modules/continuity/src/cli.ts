import { readFileSync } from 'node:fs';
import type { CliModule } from '@kathix/platform';
import type { ContinuityService, FoundIssue } from './service';

function print(
  issues: Pick<
    FoundIssue,
    | 'type'
    | 'severity'
    | 'confidence'
    | 'summary'
    | 'draftQuote'
    | 'refLabel'
    | 'refQuote'
    | 'fixText'
  >[],
) {
  if (!issues.length) console.log('No contradictions found.');
  for (const i of issues) {
    console.log(
      `\n[${i.severity}] ${i.type} (${Math.round(i.confidence * 100)}% sure): ${i.summary}`,
    );
    console.log(`  Draft:     “${i.draftQuote}”`);
    console.log(`  ${i.refLabel}: “${i.refQuote}”`);
    if (i.fixText) console.log(`  Fix:       “${i.fixText}”`);
  }
}

const cli: CliModule = {
  register(program, getContext) {
    const cmd = program
      .command('continuity')
      .description('Check a draft against a reference text or a project');
    cmd
      .command('compare <referenceFile> <draftFile>')
      .description('Standalone: list contradictions between a reference text and a draft')
      .action(async (ref: string, draft: string) => {
        const ctx = await getContext();
        const s = ctx.use<ContinuityService>('continuity') as ContinuityService;
        const res = await s.compare(readFileSync(ref, 'utf8'), readFileSync(draft, 'utf8'));
        print(res.issues);
        if (res.discarded)
          console.log(
            `\n(${res.discarded} answers were discarded because their quotes were not in the texts.)`,
          );
      });
    cmd
      .command('check <scriptId>')
      .description('Check a project script against its canon and earlier episodes')
      .action(async (id: string) => {
        const ctx = await getContext();
        const s = ctx.use<ContinuityService>('continuity') as ContinuityService;
        const res = await s.checkScript(id, { onStage: (st) => console.log(`… ${st}`) });
        print(res.issues);
      });
  },
};

export default cli;
