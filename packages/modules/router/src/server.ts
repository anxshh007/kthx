import { z } from 'zod';
import { PROVIDER_KINDS, type ModelRouter, type ProviderKind, type Tier } from '@kathix/models';
import { UserError, body, type ModuleContext, type ServerModule } from '@kathix/platform';
import { manifest } from './manifest';

export function createRouterService(ctx: ModuleContext) {
  const router: ModelRouter = ctx.router;
  const refreshCaps = () => void ctx.capabilities.refresh();
  return {
    kinds: () => PROVIDER_KINDS,
    providers: () =>
      router.statuses().map((s) => ({ ...s, removable: router.isRemovable(s.config.id) })),
    async add(input: { kind: ProviderKind; apiKey?: string; baseUrl?: string; label?: string }) {
      const id = router.addProvider(input);
      const test = await router.testProvider(id);
      if (!test.ok) {
        router.removeProvider(id);
        return { ok: false, message: `That did not work: ${test.message}` };
      }
      await ctx.capabilities.refresh();
      return { ok: true, id, message: test.message };
    },
    async test(id: string) {
      const res = await router.testProvider(id);
      refreshCaps();
      return res;
    },
    setEnabled(id: string, enabled: boolean) {
      router.setEnabled(id, enabled);
      refreshCaps();
    },
    remove(id: string) {
      if (!router.removeProvider(id))
        throw new UserError(
          'Providers set through environment variables are removed by editing your .env file.',
        );
      refreshCaps();
    },
    setRpm: (id: string, rpm: number) => router.setRpm(id, rpm),
    tiers: () => router.tiers(),
    setTier: (tier: Tier, targets: { providerId: string; model: string }[]) =>
      router.setTier(tier, targets),
    get localOnly() {
      return router.localOnly;
    },
    setLocalOnly(on: boolean) {
      if (on && !ctx.capabilities.has('model.local'))
        throw new UserError(
          'No local model runtime is answering, so local-only mode is not available.',
        );
      router.setLocalOnly(on);
      refreshCaps();
    },
    usage: () => ({ ...ctx.store.usageSummary(), prices: router.prices() }),
    setPrice: (p: { providerId: string; model: string; input: number; output: number }) =>
      router.setPrice(p.providerId, p.model, p.input, p.output),
    adaption() {
      const status = router.statuses().find((s) => s.config.kind === 'adaption');
      return status
        ? {
            configured: true,
            model: router.adaptionModel,
            models: status.models.map((m) => m.id),
            available: ctx.capabilities.has('model.custom.adaption'),
          }
        : { configured: false, model: '', models: [], available: false };
    },
    async setAdaptionModel(model: string) {
      router.setAdaptionModel(model);
      await ctx.capabilities.refresh();
      return this.adaption();
    },
  };
}

export type RouterService = ReturnType<typeof createRouterService>;

const tierSchema = z.enum(['fast', 'balanced', 'deep']);

const serverModule: ServerModule<RouterService> = {
  manifest,
  createService: createRouterService,
  routes(app, s) {
    app.get('/kinds', (c) => c.json({ kinds: s.kinds() }));
    app.get('/providers', (c) => c.json({ providers: s.providers(), localOnly: s.localOnly }));
    app.post('/providers', async (c) => {
      const input = await body(
        c,
        z.object({
          kind: z.enum(['anthropic', 'openai', 'gemini', 'openai-compatible', 'ollama']),
          apiKey: z.string().max(400).optional(),
          baseUrl: z.string().url().optional(),
          label: z.string().max(60).optional(),
        }),
      );
      return c.json(await s.add(input));
    });
    app.post('/providers/:id/test', async (c) => c.json(await s.test(c.req.param('id'))));
    app.post('/providers/:id/enabled', async (c) => {
      const { enabled } = await body(c, z.object({ enabled: z.boolean() }));
      s.setEnabled(c.req.param('id'), enabled);
      return c.json({ ok: true });
    });
    app.post('/providers/:id/rpm', async (c) => {
      const { rpm } = await body(c, z.object({ rpm: z.number().min(1).max(10000) }));
      s.setRpm(c.req.param('id'), rpm);
      return c.json({ ok: true });
    });
    app.delete('/providers/:id', (c) => {
      s.remove(c.req.param('id'));
      return c.json({ ok: true });
    });
    app.get('/tiers', (c) => c.json({ tiers: s.tiers() }));
    app.put('/tiers/:tier', async (c) => {
      const tier = tierSchema.parse(c.req.param('tier'));
      const { targets } = await body(
        c,
        z.object({ targets: z.array(z.object({ providerId: z.string(), model: z.string() })) }),
      );
      s.setTier(tier, targets);
      return c.json({ tiers: s.tiers() });
    });
    app.post('/local-only', async (c) => {
      const { on } = await body(c, z.object({ on: z.boolean() }));
      s.setLocalOnly(on);
      return c.json({ localOnly: s.localOnly });
    });
    app.get('/usage', (c) => c.json(s.usage()));
    app.put('/prices', async (c) => {
      s.setPrice(
        await body(
          c,
          z.object({
            providerId: z.string(),
            model: z.string(),
            input: z.number().min(0),
            output: z.number().min(0),
          }),
        ),
      );
      return c.json({ ok: true });
    });
    app.get('/adaption', (c) => c.json(s.adaption()));
    app.put('/adaption', async (c) => {
      const { model } = await body(c, z.object({ model: z.string().max(200) }));
      return c.json(await s.setAdaptionModel(model));
    });
  },
};

export default serverModule;
