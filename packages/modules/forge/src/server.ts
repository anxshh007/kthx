import { z } from 'zod';
import { FORGE_KINDS } from '@kathix/prompts';
import { body, projectOrScratch, type ServerModule } from '@kathix/platform';
import { manifest } from './manifest';
import { createForgeService, forgeAgentSteps, type ForgeService } from './service';

const serverModule: ServerModule<ForgeService> = {
  manifest,
  createService: createForgeService,
  agentSteps: forgeAgentSteps,
  routes(app, s, ctx) {
    app.get('/platforms', (c) => c.json({ platforms: s.platforms() }));
    app.post('/generate', async (c) => {
      const req = await body(
        c,
        z.object({
          projectId: z.string().nullable().optional(),
          scriptId: z.string().nullable().default(null),
          script: z.string().max(400000).nullable().default(null),
          kind: z.enum(FORGE_KINDS),
          platform: z.string().max(40),
          audience: z.string().max(300).default(''),
          tone: z.string().max(120).default(''),
          count: z.number().int().min(1).max(8).default(5),
          maxChars: z.number().int().min(10).max(2000).nullable().optional(),
        }),
      );
      return c.json(
        await s.generate({
          ...req,
          projectId: projectOrScratch(ctx, req.projectId ?? undefined).id,
        }),
      );
    });
    app.post('/items/:id/refine', async (c) => {
      const { note } = await body(c, z.object({ note: z.string().max(500).default('') }));
      return c.json(await s.refine(c.req.param('id'), note));
    });
    app.post('/items/:id/shortlist', async (c) => {
      const { on } = await body(c, z.object({ on: z.boolean() }));
      return c.json(s.shortlist(c.req.param('id'), on));
    });
    app.get('/items', (c) =>
      c.json({
        items: s.items(
          projectOrScratch(ctx, c.req.query('projectId')).id,
          c.req.query('shortlist') === '1',
        ),
      }),
    );
    app.get('/shortlist.md', (c) =>
      c.body(s.exportShortlist(projectOrScratch(ctx, c.req.query('projectId')).id), 200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': 'attachment; filename="shortlist.md"',
      }),
    );
  },
};

export default serverModule;
