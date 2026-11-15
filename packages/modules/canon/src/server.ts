import { z } from 'zod';
import { CANON_TYPES } from '@kathix/kernel/shared';
import { body, projectOrScratch, requireCaps, type ServerModule } from '@kathix/platform';
import { manifest } from './manifest';
import { createCanonService, type CanonService } from './service';

const canonType = z.enum(CANON_TYPES);
const attrs = z.record(z.string(), z.string());

const serverModule: ServerModule<CanonService> = {
  manifest,
  createService: createCanonService,
  routes(app, s, ctx) {
    const pid = (q: string | undefined) => projectOrScratch(ctx, q).id;
    app.post('/import', async (c) => {
      requireCaps(ctx, ['model.structured']);
      const input = await body(
        c,
        z.object({
          projectId: z.string().nullable().optional(),
          title: z.string().max(200).default(''),
          file: z.object({
            name: z.string(),
            text: z.string().optional(),
            base64: z.string().optional(),
          }),
        }),
      );
      return c.json(await s.importText(pid(input.projectId ?? undefined), input.title, input.file));
    });
    app.get('/proposals', (c) => c.json({ proposals: s.proposals(pid(c.req.query('projectId'))) }));
    app.post('/proposals/:id/approve', async (c) => {
      const edits = await body(
        c,
        z.object({
          name: z.string().min(1).optional(),
          summary: z.string().optional(),
          type: canonType.optional(),
          attributes: attrs.optional(),
        }),
      );
      return c.json({ entry: s.approve(c.req.param('id'), edits) });
    });
    app.post('/proposals/:id/merge', async (c) => {
      const { targetId } = await body(c, z.object({ targetId: z.string() }));
      return c.json({ entry: s.merge(c.req.param('id'), targetId) });
    });
    app.post('/proposals/:id/reject', (c) => c.json(s.reject(c.req.param('id'))));
    app.post('/proposals/:id/restore', (c) => c.json(s.restoreProposal(c.req.param('id'))));
    app.post('/proposals/bulk-approve', async (c) => {
      const { projectId, type } = await body(
        c,
        z.object({ projectId: z.string().nullable().optional(), type: canonType }),
      );
      return c.json(s.bulkApprove(pid(projectId ?? undefined), type));
    });
    app.get('/entries', (c) => c.json({ entries: s.entries(pid(c.req.query('projectId'))) }));
    app.post('/entries', async (c) => {
      const input = await body(
        c,
        z.object({
          projectId: z.string().nullable().optional(),
          type: canonType,
          name: z.string().min(1).max(200),
          summary: z.string().default(''),
          attributes: attrs.default({}),
        }),
      );
      return c.json({ entry: s.createEntry(pid(input.projectId ?? undefined), input) });
    });
    app.get('/entries/:id', (c) => c.json(s.entryDetail(c.req.param('id'))));
    app.put('/entries/:id', async (c) => {
      const patch = await body(
        c,
        z.object({
          name: z.string().min(1).optional(),
          type: canonType.optional(),
          summary: z.string().optional(),
          attributes: attrs.optional(),
          aliases: z.array(z.string()).optional(),
          timelineLabel: z.string().optional(),
          timelineOrder: z.number().nullable().optional(),
          plantedIn: z.string().optional(),
          status: z.enum(['active', 'paid']).optional(),
        }),
      );
      return c.json({ entry: s.updateEntry(c.req.param('id'), patch) });
    });
    app.delete('/entries/:id', (c) => {
      s.deleteEntry(c.req.param('id'));
      return c.json({ ok: true });
    });
    app.post('/links', async (c) => {
      const l = await body(
        c,
        z.object({
          projectId: z.string().nullable().optional(),
          fromId: z.string(),
          toId: z.string(),
          relation: z.string().max(80),
        }),
      );
      return c.json({
        link: s.addLink(pid(l.projectId ?? undefined), l.fromId, l.toId, l.relation),
      });
    });
    app.delete('/links/:id', (c) => {
      s.removeLink(c.req.param('id'));
      return c.json({ ok: true });
    });
    app.get('/timeline', (c) => c.json({ events: s.timeline(pid(c.req.query('projectId'))) }));
    app.get('/graph', (c) => c.json(s.graph(pid(c.req.query('projectId')))));
    app.get('/promises', (c) => c.json({ promises: s.promises(pid(c.req.query('projectId'))) }));
    app.get('/export.md', (c) => {
      c.header('content-disposition', 'attachment; filename="story-bible.md"');
      return c.body(s.exportMarkdown(pid(c.req.query('projectId'))), 200, {
        'content-type': 'text/markdown; charset=utf-8',
      });
    });
    app.get('/export.json', (c) => {
      c.header('content-disposition', 'attachment; filename="story-bible.json"');
      return c.json(s.exportJson(pid(c.req.query('projectId'))));
    });
  },
};

export default serverModule;
