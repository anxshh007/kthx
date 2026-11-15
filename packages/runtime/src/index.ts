import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  CapabilityRegistry,
  EventBus,
  JobQueue,
  SecretStore,
  createLogger,
  loadConfig,
  type KathixEvents,
  type ModuleManifest,
} from '@kathix/kernel';
import { ModelRouter } from '@kathix/models';
import { mockResponders } from '@kathix/prompts';
import { Store } from '@kathix/store';
import {
  plainError,
  type AgentStep,
  type CliModule,
  type ModuleContext,
  type ServerModule,
} from '@kathix/platform';

export interface RuntimeOptions {
  dataDir?: string;
  mock?: boolean;
  quiet?: boolean;
}

export interface LoadedModule {
  manifest: ModuleManifest;
  service: unknown;
  def: ServerModule;
}

export interface Runtime {
  ctx: ModuleContext;
  modules: LoadedModule[];
  app: Hono;
  refreshCapabilities(): Promise<void>;
  close(): void;
}

export function moduleIds(rootDir: string): string[] {
  const raw = JSON.parse(readFileSync(path.join(rootDir, 'modules.config.json'), 'utf8')) as {
    modules: string[];
  };
  return raw.modules;
}

async function importModuleFile<T>(rootDir: string, id: string, file: string): Promise<T> {
  const url = pathToFileURL(path.join(rootDir, 'packages', 'modules', id, 'src', file)).href;
  const mod = (await import(url)) as { default: T };
  return mod.default;
}

export async function loadCliModules(rootDir: string): Promise<CliModule[]> {
  return Promise.all(
    moduleIds(rootDir).map((id) => importModuleFile<CliModule>(rootDir, id, 'cli.ts')),
  );
}

export async function createRuntime(opts: RuntimeOptions = {}): Promise<Runtime> {
  const config = loadConfig(opts.dataDir ? { dataDir: opts.dataDir } : {});
  if (opts.mock !== undefined) config.mockProvider = opts.mock;
  const logger = createLogger('kathix', opts.quiet ? 'warn' : 'info');
  const store = new Store(config.dbPath);
  const secrets = new SecretStore(config.dataDir);
  const router = new ModelRouter({
    store,
    secrets,
    env: config.env,
    logger,
    mock: config.mockProvider,
    mockResponders,
  });
  const capabilities = new CapabilityRegistry();
  const jobs = new JobQueue(store.jobs, 2);
  const events = new EventBus<KathixEvents>();
  const apis = new Map<string, unknown>();
  const ctx: ModuleContext = {
    config,
    store,
    secrets,
    router,
    capabilities,
    jobs,
    events,
    logger,
    agentSteps: new Map<string, AgentStep>(),
    provide: (name, api) => apis.set(name, api),
    use: <T>(name: string) => apis.get(name) as T | undefined,
  };

  capabilities.setProbe('store.ready', async () =>
    store.probe()
      ? { ok: true, detail: 'Library ready' }
      : { ok: false, detail: 'Library write failed' },
  );
  capabilities.setProbe('model.local', () => router.probeLocal());
  capabilities.setProbe('model.text', () => router.probeText());
  capabilities.setProbe('model.structured', () =>
    capabilities.has('model.text')
      ? router.probeStructured()
      : Promise.resolve({ ok: false, detail: 'Needs a writing model first.' }),
  );
  capabilities.setProbe('model.embeddings', () => router.probeEmbeddings());
  capabilities.setProbe('model.custom.adaption', () => router.probeAdaption());

  const modules: LoadedModule[] = [];
  for (const id of moduleIds(config.rootDir)) {
    const def = await importModuleFile<ServerModule>(config.rootDir, id, 'server.ts');
    const service = def.createService(ctx);
    ctx.provide(id, service);
    modules.push({ manifest: def.manifest, service, def });
  }
  for (const m of modules)
    for (const step of m.def.agentSteps?.(m.service, ctx) ?? []) ctx.agentSteps.set(step.id, step);

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  // Jobs start only after the first probe, so resumed work sees the real capabilities.
  const refreshCapabilities = async () => {
    await capabilities.refresh();
    jobs.start();
  };
  const refreshSoon = () => {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshCapabilities();
    }, 1500);
  };
  jobs.onUpdate((job) => {
    if (job.status === 'failed') refreshSoon();
  });

  const app = buildApp(ctx, modules, refreshCapabilities);
  return {
    ctx,
    modules,
    app,
    refreshCapabilities,
    close: () => {
      jobs.stop();
      if (refreshTimer) clearTimeout(refreshTimer);
      store.close();
    },
  };
}

function buildApp(ctx: ModuleContext, modules: LoadedModule[], refresh: () => Promise<void>): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    const { message, status } = plainError(err);
    if (status >= 500 && !(err instanceof Error && err.name === 'UserError'))
      ctx.logger.error('Request failed', err);
    return c.json({ error: message }, status as 400);
  });

  app.get('/api/state', (c) =>
    c.json({
      capabilities: ctx.capabilities.snapshot(),
      probing: ctx.capabilities.probing,
      modules: modules.map((m) => m.manifest),
      setupRequired: !ctx.capabilities.has('model.text'),
      scratchProjectId: ctx.store.scratchProject().id,
    }),
  );

  app.post('/api/capabilities/refresh', async (c) => {
    await refresh();
    return c.json({ capabilities: ctx.capabilities.snapshot() });
  });

  app.get('/api/jobs', (c) => c.json({ jobs: ctx.store.jobs.list(30) }));
  app.post('/api/jobs/:id/cancel', (c) => c.json({ ok: ctx.jobs.cancel(c.req.param('id')) }));
  app.post('/api/jobs/:id/retry', (c) => c.json({ job: ctx.jobs.retry(c.req.param('id')) }));

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const offs: (() => void)[] = [];
      const send = (event: string, data: unknown) => {
        void stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => undefined);
      };
      offs.push(ctx.jobs.onUpdate((job) => send('job', job)));
      offs.push(ctx.capabilities.onChange((caps) => send('capabilities', caps)));
      offs.push(ctx.events.on('ledger.event', (e) => send('ledger', e)));
      offs.push(ctx.events.on('script.saved', (e) => send('script', e)));
      offs.push(ctx.events.on('showrunner.updated', (e) => send('showrunner', e)));
      let open = true;
      stream.onAbort(() => {
        open = false;
        offs.forEach((o) => o());
      });
      send('hello', { at: new Date().toISOString() });
      while (open) {
        await stream.sleep(15000);
        if (open) send('ping', {});
      }
    }),
  );

  for (const m of modules) {
    const sub = new Hono();
    const requires = m.manifest.requires;
    sub.use('*', async (c, next) => {
      const missing = requires.filter((cap) => !ctx.capabilities.has(cap));
      if (missing.length) {
        return c.json(
          {
            error:
              'This part of Kathix needs a connected writing model. Open Model Router to connect one.',
          },
          503,
        );
      }
      await next();
    });
    m.def.routes?.(sub, m.service, ctx);
    app.route(`/api/m/${m.manifest.id}`, sub);
  }
  return app;
}
