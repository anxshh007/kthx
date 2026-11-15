import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CliModule } from '@kathix/platform';
import type { CanonService } from './service';

const cli: CliModule = {
  register(program, getContext) {
    const cmd = program
      .command('canon')
      .description('Import material, review proposals and export the story bible');
    const service = async () => {
      const ctx = await getContext();
      return { ctx, s: ctx.use<CanonService>('canon') as CanonService };
    };
    const projectOf = (ctx: Awaited<ReturnType<typeof getContext>>, id?: string) =>
      id ? id : ctx.store.scratchProject().id;

    cmd
      .command('import <file>')
      .description(
        'Read a .txt, .md, .docx or .pdf file and propose canon entries (no --project: the Scratchpad vault)',
      )
      .option('--project <id>', 'project id')
      .option('--title <title>', 'document title')
      .action(async (file: string, o: { project?: string; title?: string }) => {
        const { ctx, s } = await service();
        const buf = readFileSync(file);
        const name = path.basename(file);
        const isText = /\.(txt|md)$/i.test(name);
        const projectId = projectOf(ctx, o.project);
        const { job } = await s.importText(
          projectId,
          o.title ?? name,
          isText ? { name, text: buf.toString('utf8') } : { name, base64: buf.toString('base64') },
        );
        const done = await ctx.jobs.wait(job.id, 600_000);
        if (done.status !== 'succeeded') {
          console.error(done.error ?? 'Import failed');
          process.exitCode = 1;
          return;
        }
        const props = s.proposals(projectId);
        console.log(`${props.length} proposals waiting for review:`);
        for (const p of props)
          console.log(`  ${p.id}  [${p.type}] ${p.name}\n      “${p.quote.slice(0, 120)}”`);
      });
    cmd
      .command('proposals')
      .description('List pending proposals with their source passages')
      .option('--project <id>', 'project id')
      .action(async (o: { project?: string }) => {
        const { ctx, s } = await service();
        for (const p of s.proposals(projectOf(ctx, o.project)))
          console.log(`${p.id}  [${p.type}] ${p.name}: “${p.quote.slice(0, 140)}”`);
      });
    cmd
      .command('approve <proposalId>')
      .description('Approve a proposal into the canon')
      .action(async (id: string) => {
        const { s } = await service();
        console.log(`Approved ${s.approve(id).name}`);
      });
    cmd
      .command('reject <proposalId>')
      .description('Reject a proposal')
      .action(async (id: string) => {
        const { s } = await service();
        s.reject(id);
        console.log('Rejected');
      });
    cmd
      .command('export')
      .description('Export the vault as Markdown or JSON')
      .option('--project <id>', 'project id')
      .option('--format <format>', 'md or json', 'md')
      .option('--out <file>', 'write to a file instead of the terminal')
      .action(async (o: { project?: string; format: string; out?: string }) => {
        const { ctx, s } = await service();
        const pid = projectOf(ctx, o.project);
        const content =
          o.format === 'json' ? JSON.stringify(s.exportJson(pid), null, 2) : s.exportMarkdown(pid);
        if (o.out) {
          writeFileSync(o.out, content);
          console.log(`Wrote ${o.out}`);
        } else console.log(content);
      });
  },
};

export default cli;
