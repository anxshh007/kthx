import { z } from 'zod';
import { COWRITE_ACTIONS } from '@kathix/prompts';
import { body, projectOrScratch, requireCaps, sse, type ServerModule } from '@kathix/platform';
import { manifest } from './manifest';
import { createScriptService, scriptAgentSteps, type ScriptService } from './service';

const span = z.object({
  len: z.number().int().min(0),
  origin: z.enum(['human', 'ai', 'ai_edited']),
});

const serverModule: ServerModule<ScriptService> = {
  manifest,
  createService: createScriptService,
  agentSteps: scriptAgentSteps,
  routes(app, s, ctx) {
    app.get('/scripts', (c) =>
      c.json({ scripts: s.list(projectOrScratch(ctx, c.req.query('projectId')).id) }),
    );
    app.post('/scripts', async (c) => {
      const input = await body(
        c,
        z.object({
          projectId: z.string().nullable().optional(),
          title: z.string().max(200),
          episode: z.number().int().nullable().optional(),
          text: z.string().optional(),
        }),
      );
      return c.json({
        script: s.create(
          projectOrScratch(ctx, input.projectId ?? undefined).id,
          input.title,
          input.episode ?? null,
          input.text,
        ),
      });
    });
    app.get('/scripts/:id', (c) => c.json(s.get(c.req.param('id'))));
    app.put('/scripts/:id', async (c) => {
      const patch = await body(
        c,
        z.object({
          title: z.string().min(1).max(200).optional(),
          episode: z.number().int().nullable().optional(),
          archived: z.boolean().optional(),
        }),
      );
      return c.json({ script: s.update(c.req.param('id'), patch) });
    });
    app.delete('/scripts/:id', (c) => {
      s.remove(c.req.param('id'));
      return c.json({ ok: true });
    });
    app.put('/scripts/:id/text', async (c) => {
      const { text, authorship } = await body(
        c,
        z.object({ text: z.string().max(2_000_000), authorship: z.array(span).nullable() }),
      );
      return c.json(s.save(c.req.param('id'), text, authorship));
    });
    app.get('/scripts/:id/versions', (c) => c.json({ versions: s.versions(c.req.param('id')) }));
    app.get('/scripts/:id/versions/:vid', (c) =>
      c.json({ version: s.version(c.req.param('id'), c.req.param('vid')) }),
    );
    app.post('/scripts/:id/versions/:vid/restore', (c) =>
      c.json({ version: s.restore(c.req.param('id'), c.req.param('vid')) }),
    );
    app.get('/scripts/:id/context', async (c) =>
      c.json({
        entries: await s.context(
          c.req.param('id'),
          Number(c.req.query('from') ?? 0),
          Number(c.req.query('to') ?? 0),
        ),
      }),
    );
    app.post('/scripts/:id/suggest', async (c) => {
      requireCaps(ctx, ['model.structured']);
      const req = await body(
        c,
        z.object({
          action: z.enum(COWRITE_ACTIONS),
          instruction: z.string().max(2000).default(''),
          from: z.number().int().min(0),
          to: z.number().int().min(0),
          count: z.number().int().optional(),
        }),
      );
      const scriptId = c.req.param('id');
      return sse(c, (send, signal) =>
        s.suggest(
          { ...req, scriptId },
          (t) => void send('delta', { text: t }),
          () => void send('reset', {}),
          signal,
        ),
      );
    });
    app.post('/scripts/:id/coach', async (c) => {
      requireCaps(ctx, ['model.structured']);
      const { from, to } = await body(
        c,
        z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }),
      );
      return c.json(await s.coach(c.req.param('id'), from, to));
    });
    app.post('/suggestions/:id/accept', async (c) => {
      const { finalText, edited } = await body(
        c,
        z.object({ finalText: z.string(), edited: z.boolean() }),
      );
      return c.json(s.accept(c.req.param('id'), finalText, edited));
    });
    app.post('/suggestions/:id/reject', async (c) => {
      const { reason } = await body(c, z.object({ reason: z.string().max(500).default('') }));
      return c.json(s.reject(c.req.param('id'), reason));
    });
    app.get('/scripts/:id/export', async (c) => {
      const format = c.req.query('format') ?? 'md';
      if (format === 'docx') {
        const out = await s.exportDocx(c.req.param('id'));
        return c.body(new Uint8Array(out.body), 200, {
          'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'content-disposition': `attachment; filename="${encodeURIComponent(out.name)}"`,
        });
      }
      const out = s.exportText(c.req.param('id'), format === 'txt' ? 'txt' : 'md');
      return c.body(out.body, 200, {
        'content-type': `${format === 'txt' ? 'text/plain' : 'text/markdown'}; charset=utf-8`,
        'content-disposition': `attachment; filename="${encodeURIComponent(out.name)}"`,
      });
    });
  },
};

export default serverModule;
