import { z } from 'zod';
import { body, projectOrScratch, requireCaps, type ServerModule } from '@kathix/platform';
import { manifest } from './manifest';
import { createVoiceService, voiceAgentSteps, type VoiceService } from './service';

const samples = z
  .array(z.object({ title: z.string().max(200).default(''), text: z.string().max(400000) }))
  .min(1);

const serverModule: ServerModule<VoiceService> = {
  manifest,
  createService: createVoiceService,
  agentSteps: voiceAgentSteps,
  routes(app, s, ctx) {
    app.get('/profiles', (c) =>
      c.json({ profiles: s.profiles(projectOrScratch(ctx, c.req.query('projectId')).id) }),
    );
    app.post('/profiles', async (c) => {
      const { projectId, name } = await body(
        c,
        z.object({ projectId: z.string().nullable().optional(), name: z.string().max(120) }),
      );
      return c.json({
        profile: await s.createProfile(projectOrScratch(ctx, projectId ?? undefined).id, name),
      });
    });
    app.get('/profiles/:id', (c) => c.json(s.profile(c.req.param('id'))));
    app.put('/profiles/:id', async (c) => {
      const { name } = await body(c, z.object({ name: z.string().min(1).max(120) }));
      return c.json({ profile: s.rename(c.req.param('id'), name) });
    });
    app.delete('/profiles/:id', (c) => {
      s.remove(c.req.param('id'));
      return c.json({ ok: true });
    });
    app.post('/profiles/:id/samples', async (c) => {
      const input = await body(c, z.object({ samples, confirmedOwn: z.boolean() }));
      return c.json({
        profile: await s.addSamples(c.req.param('id'), input.samples, input.confirmedOwn),
      });
    });
    app.delete('/profiles/:id/samples/:sampleId', async (c) =>
      c.json({ profile: await s.removeSample(c.req.param('id'), c.req.param('sampleId')) }),
    );
    app.post('/profiles/:id/match', async (c) => {
      const { text } = await body(c, z.object({ text: z.string().max(400000) }));
      return c.json(s.match(c.req.param('id'), text));
    });
    app.post('/standalone/match', async (c) => {
      const input = await body(
        c,
        z.object({
          samples: z.string().max(400000),
          text: z.string().max(400000),
          confirmedOwn: z.boolean(),
        }),
      );
      return c.json(s.matchStandalone(input.samples, input.text, input.confirmedOwn));
    });
    app.post('/rewrites', async (c) => {
      requireCaps(ctx, ['model.structured']);
      const input = await body(
        c,
        z.object({
          profileId: z.string().nullable(),
          samples: z.string().nullable(),
          text: z.string().max(400000),
        }),
      );
      return c.json(await s.rewrites(input.profileId, input.samples, input.text));
    });
    app.post('/rewrites/accept', async (c) => {
      const input = await body(
        c,
        z.object({
          scriptId: z.string(),
          original: z.string(),
          text: z.string(),
          edited: z.boolean(),
        }),
      );
      return c.json(s.acceptRewrite(input.scriptId, input.original, input.text, input.edited));
    });
    app.get('/profiles/:id/dataset.jsonl', (c) =>
      c.body(s.dataset(c.req.param('id')), 200, {
        'content-type': 'application/jsonl; charset=utf-8',
        'content-disposition': 'attachment; filename="voice-dataset.jsonl"',
      }),
    );
  },
};

export default serverModule;
