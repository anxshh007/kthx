import { readFileSync } from 'node:fs';
import type { ForgeKind } from '@kathix/prompts';
import type { CliModule } from '@kathix/platform';
import { PLATFORMS } from './limits';
import type { ForgeService, ScoredOption } from './service';

const cli: CliModule = {
  register(program, getContext) {
    program
      .command('forge <scriptFile>')
      .description(
        'Standalone: write hooks, titles, thumbnail text or descriptions for a script file',
      )
      .option('--kind <kind>', 'hook, title, thumbnail or description', 'title')
      .option('--platform <platform>', Object.keys(PLATFORMS).join(', '), 'youtube')
      .option('--audience <text>', 'who it is for', '')
      .option('--tone <text>', 'tone', '')
      .option('--count <n>', 'how many options', '5')
      .action(
        async (
          file: string,
          o: { kind: ForgeKind; platform: string; audience: string; tone: string; count: string },
        ) => {
          const ctx = await getContext();
          const s = ctx.use<ForgeService>('forge') as ForgeService;
          const res = await s.generate({
            projectId: ctx.store.scratchProject().id,
            scriptId: null,
            script: readFileSync(file, 'utf8'),
            kind: o.kind,
            platform: o.platform,
            audience: o.audience,
            tone: o.tone,
            count: Number(o.count),
          });
          for (const item of res.items) {
            const p = item.payload as unknown as ScoredOption;
            console.log(`\n${item.text}   (${p.length}/${p.limit})`);
            for (const sc of p.scores)
              console.log(`  ${sc.criterion}: ${sc.score ?? '—'}/10  ${sc.reason}`);
            if (p.clickbait)
              console.log(`  ⚠ Clickbait: the script lacks ${p.missingPayoffs.join('; ')}`);
          }
        },
      );
  },
};

export default cli;
