import type { ProjectType } from '@kathix/kernel/shared';
import type { CliModule } from '@kathix/platform';
import { createHomeService } from './service';

const cli: CliModule = {
  register(program, getContext) {
    const cmd = program
      .command('home')
      .description('List and create projects, and see the next best action');
    cmd
      .command('projects')
      .description('List projects')
      .option('--archived', 'include archived projects')
      .action(async (o: { archived?: boolean }) => {
        const s = createHomeService(await getContext());
        const list = s.listProjects(Boolean(o.archived));
        if (!list.length)
          console.log('No projects yet. Create one with `kathix home create "My series"`.');
        for (const p of list)
          console.log(`${p.id}  ${p.name}  (${p.type}${p.archived ? ', archived' : ''})`);
      });
    cmd
      .command('create <name>')
      .description('Create a project')
      .option('--type <type>', 'video, podcast, fiction or comic', 'video')
      .action(async (name: string, o: { type: ProjectType }) => {
        const p = createHomeService(await getContext()).createProject(name, o.type);
        console.log(`Created ${p.name} (${p.id})`);
      });
    cmd
      .command('next <projectId>')
      .description('Show the next best action for a project')
      .action(async (projectId: string) => {
        const o = createHomeService(await getContext()).overview(projectId);
        console.log(`${o.nextAction.label}\n  ${o.nextAction.detail}`);
      });
    cmd
      .command('search <query>')
      .description('Search scripts and canon across projects')
      .action(async (q: string) => {
        for (const h of createHomeService(await getContext()).search(q))
          console.log(`[${h.kind}] ${h.title}: ${h.snippet}`);
      });
    program
      .command('seed')
      .description('Load the sample project through the normal import paths')
      .action(async () => {
        const p = await createHomeService(await getContext()).seedSample();
        console.log(`Sample project ready: ${p.name} (${p.id})`);
      });
  },
};

export default cli;
