import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { COWRITE_ACTIONS, type CowriteAction } from '@kathix/prompts';
import type { CliModule } from '@kathix/platform';
import type { ScriptService } from './service';

const cli: CliModule = {
  register(program, getContext) {
    const cmd = program
      .command('script')
      .description('Ask the co-writer for a suggestion and export scripts');
    cmd
      .command('suggest <file>')
      .description(
        `Ask the co-writer about a passage of a text file (actions: ${COWRITE_ACTIONS.join(', ')})`,
      )
      .option('--action <action>', 'co-writer action', 'tighten')
      .option('--from <n>', 'start of the passage (character offset)', '0')
      .option('--to <n>', 'end of the passage (defaults to the end of the file)')
      .option('--instruction <text>', 'free-form note for the co-writer', '')
      .option('--project <id>', 'use this project’s canon (default: Scratchpad, no canon)')
      .action(
        async (
          file: string,
          o: {
            action: CowriteAction;
            from: string;
            to?: string;
            instruction: string;
            project?: string;
          },
        ) => {
          const ctx = await getContext();
          const s = ctx.use<ScriptService>('script') as ScriptService;
          const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
          const projectId = o.project ?? ctx.store.scratchProject().id;
          const script = s.create(projectId, path.basename(file), null, text);
          const res = await s.suggest(
            {
              scriptId: script.id,
              action: o.action,
              instruction: o.instruction,
              from: Number(o.from),
              to: o.to ? Number(o.to) : text.length,
            },
            () => undefined,
            () => undefined,
          );
          for (const sg of res.suggestions) {
            console.log(`--- Suggestion (${sg.model}) ---\n${sg.proposedText}\nWhy: ${sg.reason}`);
            console.log(
              sg.evidence.length
                ? `Relied on: ${sg.evidence.map((e) => e.label).join(', ')}`
                : res.canonUsed
                  ? 'Relied on no canon.'
                  : 'No canon available; suggestion made without canon evidence.',
            );
          }
          s.remove(script.id);
        },
      );
    cmd
      .command('list')
      .description('List scripts in a project')
      .option('--project <id>', 'project id (default: Scratchpad)')
      .action(async (o: { project?: string }) => {
        const ctx = await getContext();
        const s = ctx.use<ScriptService>('script') as ScriptService;
        for (const x of s.list(o.project ?? ctx.store.scratchProject().id))
          console.log(`${x.id}  ${x.title}  (${x.stats.words} words)`);
      });
    cmd
      .command('export <scriptId>')
      .description('Export a script as md, txt or docx')
      .option('--format <format>', 'md, txt or docx', 'md')
      .option('--out <file>', 'output file')
      .action(async (id: string, o: { format: string; out?: string }) => {
        const ctx = await getContext();
        const s = ctx.use<ScriptService>('script') as ScriptService;
        const out =
          o.format === 'docx'
            ? await s.exportDocx(id)
            : s.exportText(id, o.format === 'txt' ? 'txt' : 'md');
        writeFileSync(o.out ?? out.name, out.body);
        console.log(`Wrote ${o.out ?? out.name}`);
      });
  },
};

export default cli;
