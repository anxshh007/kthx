import { z } from 'zod';
import { UserError, body, sse, type ServerModule } from '@kathix/platform';
import { manifest } from './manifest';
import { continuityAgentSteps, createContinuityService, type ContinuityService } from './service';

const serverModule: ServerModule<ContinuityService> = {
  manifest,
  createService: createContinuityService,
  agentSteps: continuityAgentSteps,
  routes(app, s, ctx) {
    app.post('/scripts/:id/check', (c) =>
      sse(c, (send, signal) =>
        s.checkScript(c.req.param('id'), {
          signal,
          onStage: (stage) => void send('stage', { stage }),
        }),
      ),
    );
    app.post('/compare', async (c) => {
      const { reference, draft } = await body(
        c,
        z.object({ reference: z.string().max(400000), draft: z.string().max(400000) }),
      );
      return sse(c, (send, signal) => {
        void send('stage', { stage: 'Comparing the draft with the reference' });
        return s.compare(reference, draft, signal);
      });
    });
    app.get('/scripts/:id/issues', (c) => c.json({ issues: s.issues(c.req.param('id')) }));
    app.post('/issues/:id/apply', async (c) => {
      const { text, edited } = await body(c, z.object({ text: z.string(), edited: z.boolean() }));
      return c.json(s.applyFix(c.req.param('id'), text, edited));
    });
    app.get('/issues/:id/entry', (c) => {
      const entry = s.entryFor(c.req.param('id'));
      if (!entry) throw new UserError('This issue does not point at a canon entry.', 404);
      return c.json({ entry });
    });
    app.post('/issues/:id/edit-canon', async (c) => {
      const patch = await body(
        c,
        z.object({
          summary: z.string().optional(),
          attributes: z.record(z.string(), z.string()).optional(),
        }),
      );
      return c.json(s.editCanon(c.req.param('id'), patch));
    });
    app.post('/issues/:id/intentional', (c) => c.json(s.markIntentional(c.req.param('id'))));
    app.post('/issues/:id/reopen', (c) => c.json(s.reopen(c.req.param('id'))));
    app.get('/health', (c) => {
      const projectId = c.req.query('projectId');
      if (!projectId || !ctx.store.getProject(projectId))
        throw new UserError('Open a project to see its health.', 404);
      return c.json({ scripts: s.health(projectId) });
    });
  },
};

export default serverModule;
