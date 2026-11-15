import { z } from 'zod';
import { body, projectOrScratch, type ServerModule } from '@kathix/platform';
import { manifest } from './manifest';
import { createShowrunnerService, type ShowrunnerService } from './service';

const serverModule: ServerModule<ShowrunnerService> = {
  manifest,
  createService: createShowrunnerService,
  routes(app, s, ctx) {
    const needProject = (id: string | undefined) => projectOrScratch(ctx, id).id;
    app.get('/steps', (c) => c.json({ steps: s.availableSteps() }));
    app.get('/runs', (c) => c.json({ runs: s.runs(needProject(c.req.query('projectId'))) }));
    app.get('/templates', (c) =>
      c.json({ templates: s.templates(needProject(c.req.query('projectId'))) }),
    );
    app.get('/docs', (c) => c.json({ docs: s.docs(needProject(c.req.query('projectId'))) }));
    app.post('/runs', async (c) => {
      const req = await body(
        c,
        z.object({
          projectId: z.string(),
          scriptId: z.string().nullable().default(null),
          newTitle: z.string().max(200).default(''),
          goal: z.string().min(1).max(2000),
          outline: z.string().max(200000).default(''),
          templateRunId: z.string().nullable().default(null),
        }),
      );
      return c.json({ run: s.start(req) });
    });
    app.get('/runs/:id', (c) => c.json({ run: s.run(c.req.param('id')) }));
    app.post('/runs/:id/approve', async (c) => {
      const { text } = await body(c, z.object({ text: z.string().nullable().default(null) }));
      return c.json({ run: s.approve(c.req.param('id'), text) });
    });
    app.post('/runs/:id/redo', async (c) => {
      const { note } = await body(c, z.object({ note: z.string().max(1000).default('') }));
      return c.json({ run: s.redo(c.req.param('id'), note) });
    });
    app.post('/runs/:id/skip', (c) => c.json({ run: s.skip(c.req.param('id')) }));
    app.post('/runs/:id/stop', (c) => c.json({ run: s.stop(c.req.param('id')) }));
    app.post('/runs/:id/template', async (c) => {
      const { name } = await body(c, z.object({ name: z.string().max(120) }));
      return c.json({ run: s.saveTemplate(c.req.param('id'), name) });
    });
  },
};

export default serverModule;
