import { z } from 'zod';
import { body, type ServerModule } from '@kathix/platform';
import { manifest } from './manifest';
import { createHomeService, type HomeService } from './service';

const projectType = z.enum(['video', 'podcast', 'fiction', 'comic']);

const serverModule: ServerModule<HomeService> = {
  manifest,
  createService: createHomeService,
  routes(app, s) {
    app.get('/projects', (c) =>
      c.json({ projects: s.listProjects(c.req.query('archived') === '1') }),
    );
    app.post('/projects', async (c) => {
      const { name, type } = await body(
        c,
        z.object({ name: z.string().min(1).max(120), type: projectType }),
      );
      return c.json({ project: s.createProject(name, type) });
    });
    app.put('/projects/:id', async (c) => {
      const patch = await body(
        c,
        z.object({
          name: z.string().min(1).max(120).optional(),
          type: projectType.optional(),
          archived: z.boolean().optional(),
          settings: z
            .object({
              continuityOnSave: z.boolean().optional(),
              activeVoiceProfileId: z.string().nullable().optional(),
              voiceConditioning: z.boolean().optional(),
              useAdaptionWriter: z.boolean().optional(),
            })
            .optional(),
        }),
      );
      return c.json({ project: s.updateProject(c.req.param('id'), patch) });
    });
    app.delete('/projects/:id', (c) => {
      s.deleteProject(c.req.param('id'));
      return c.json({ ok: true });
    });
    app.get('/projects/:id/overview', (c) => c.json(s.overview(c.req.param('id'))));
    app.get('/search', (c) =>
      c.json({ hits: s.search(c.req.query('q') ?? '', c.req.query('projectId') || undefined) }),
    );
    app.post('/sample', async (c) => c.json({ project: await s.seedSample() }));
  },
};

export default serverModule;
