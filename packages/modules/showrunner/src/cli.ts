import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import type { CliModule } from '@kathix/platform';
import type { ShowrunnerRun } from '@kathix/store';
import type { ShowrunnerService } from './service';

const cli: CliModule = {
  register(program, getContext) {
    program
      .command('showrunner')
      .description('Run the production pipeline with an approval checkpoint after every step')
      .requiredOption(
        '--goal <text>',
        'what you want, e.g. "Draft episode 5 and make it ready to record"',
      )
      .option('--project <id>', 'project id (default: Scratchpad)')
      .option('--script <id>', 'existing script to work on')
      .option('--title <title>', 'title for a new script', 'New episode')
      .option('--outline <file>', 'outline file')
      .option('--approve-all', 'approve every step without asking (you are approving in advance)')
      .action(
        async (o: {
          goal: string;
          project?: string;
          script?: string;
          title: string;
          outline?: string;
          approveAll?: boolean;
        }) => {
          const ctx = await getContext();
          const s = ctx.use<ShowrunnerService>('showrunner') as ShowrunnerService;
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          let run: ShowrunnerRun = s.start({
            projectId: o.project ?? ctx.store.scratchProject().id,
            scriptId: o.script ?? null,
            newTitle: o.title,
            goal: o.goal,
            outline: o.outline ? readFileSync(o.outline, 'utf8') : '',
            templateRunId: null,
          });
          const waitFor = () =>
            new Promise<ShowrunnerRun>((resolve) => {
              const check = () => {
                const r = ctx.store.getRun(run.id) as ShowrunnerRun;
                if (['awaiting_approval', 'completed', 'stopped', 'failed'].includes(r.status)) {
                  off();
                  resolve(r);
                }
              };
              const off = ctx.events.on('showrunner.updated', (e) => e.runId === run.id && check());
              check();
            });
          try {
            for (;;) {
              run = await waitFor();
              if (run.status !== 'awaiting_approval') break;
              const step = run.steps[run.stepIndex];
              console.log(
                `\n[${run.stepIndex + 1}/${run.steps.length}] ${step?.label}: ${step?.summary}`,
              );
              const answer = o.approveAll
                ? 'a'
                : (await rl.question('Approve (a), skip (s), redo with a note (r), stop (q)? '))
                    .trim()
                    .toLowerCase();
              if (answer === 'a') s.approve(run.id, null);
              else if (answer === 's') s.skip(run.id);
              else if (answer === 'r') s.redo(run.id, await rl.question('Note for the redo: '));
              else {
                s.stop(run.id);
                break;
              }
            }
          } finally {
            rl.close();
          }
          const final = ctx.store.getRun(run.id) as ShowrunnerRun;
          console.log(`\nRun ${final.status}. ${final.tokens} tokens used.`);
          if (final.status === 'failed') process.exitCode = 1;
        },
      );
  },
};

export default cli;
