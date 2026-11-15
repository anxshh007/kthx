import { createHash } from 'node:crypto';
import { shortId, type Logger, type SecretStore } from '@kathix/kernel';
import type { Store } from '@kathix/store';
import { RateBudget } from './budget';
import { AdaptionAdapter } from './providers/adaption';
import { AnthropicAdapter } from './providers/anthropic';
import { GeminiAdapter } from './providers/gemini';
import { MockAdapter, type MockResponder } from './providers/mock';
import { OllamaAdapter, DEFAULT_OLLAMA_URL } from './providers/ollama';
import { OpenAIAdapter } from './providers/openai';
import {
  ProviderDisabledError,
  ProviderError,
  type ChatMessage,
  type ModelInfo,
  type Priority,
  type ProviderAdapter,
  type ProviderConfig,
  type ProviderKind,
  type Tier,
  type TierMap,
  type TierTarget,
} from './types';

export interface GenerateOptions {
  module: string;
  templateId: string;
  tier: Tier;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  json?: { schema: Record<string, unknown> };
  priority: Priority;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  /** Called when a partial stream is abandoned and another model takes over. */
  onReset?: () => void;
  cache?: boolean;
  /** A specific model to try first (for example the creator's Adaption voice model). */
  target?: TierTarget;
  excludeProviders?: string[];
  mockInput?: unknown;
}

export interface GenerateResult {
  text: string;
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cached: boolean;
  attempts: { providerId: string; model: string; error: string | null }[];
}

export class RouterError extends Error {}

export interface ProviderStatus {
  config: ProviderConfig;
  status: 'unknown' | 'ok' | 'error';
  lastError: string | null;
  models: ModelInfo[];
  nativeStructured: boolean | null;
  hasKey: boolean;
  inFlight: number;
  queued: number;
}

interface Runtime {
  config: ProviderConfig;
  adapter: ProviderAdapter | null;
  models: ModelInfo[];
  status: ProviderStatus['status'];
  lastError: string | null;
  native: boolean | null;
  budget: RateBudget;
  controllers: Set<AbortController>;
}

const FAST_HINT = /(mini|flash|haiku|small|lite|nano|instant|8b|7b|3b|1b)/i;
const DEEP_HINT = /(opus|pro|large|ultra|70b|72b|405b|max|fable)/i;
const NOT_TEXT = /(vision-only|guard|tts|audio|image|search|realtime|transcribe|embed)/i;

/** Picks a default model per tier from a live model list using size hints in the ids. */
export function pickTierModels(models: ModelInfo[]): Record<Tier, string | null> {
  const chat = models
    .filter((m) => m.kind === 'chat' && !NOT_TEXT.test(m.id))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  if (!chat.length) return { fast: null, balanced: null, deep: null };
  const fast = chat.find((m) => FAST_HINT.test(m.id)) ?? chat[0];
  const balanced =
    chat.find((m) => !FAST_HINT.test(m.id) && !DEEP_HINT.test(m.id)) ??
    chat.find((m) => !FAST_HINT.test(m.id)) ??
    chat[0];
  const deep = chat.find((m) => DEEP_HINT.test(m.id) && !FAST_HINT.test(m.id)) ?? balanced;
  return { fast: fast?.id ?? null, balanced: balanced?.id ?? null, deep: deep?.id ?? null };
}

export const PROVIDER_KINDS: {
  kind: ProviderKind;
  label: string;
  needsKey: boolean;
  needsBaseUrl: boolean;
}[] = [
  { kind: 'anthropic', label: 'Anthropic', needsKey: true, needsBaseUrl: false },
  { kind: 'openai', label: 'OpenAI', needsKey: true, needsBaseUrl: false },
  { kind: 'gemini', label: 'Google Gemini', needsKey: true, needsBaseUrl: false },
  {
    kind: 'openai-compatible',
    label: 'OpenAI-compatible endpoint',
    needsKey: false,
    needsBaseUrl: true,
  },
  { kind: 'ollama', label: 'Local runtime (Ollama)', needsKey: false, needsBaseUrl: false },
];

export interface RouterDeps {
  store: Store;
  secrets: SecretStore;
  env: Record<string, string | undefined>;
  logger: Logger;
  mock: boolean;
  mockResponders?: Record<string, MockResponder>;
}

export class ModelRouter {
  private runtimes = new Map<string, Runtime>();
  private listeners = new Set<() => void>();

  constructor(private deps: RouterDeps) {
    this.load();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }

  // ---------------- configuration ----------------

  private envConfigs(): ProviderConfig[] {
    const e = this.deps.env;
    const out: ProviderConfig[] = [];
    const add = (c: Omit<ProviderConfig, 'enabled' | 'rpm'>) =>
      out.push({ ...c, enabled: true, rpm: 30 });
    if (this.deps.mock)
      add({ id: 'mock', kind: 'mock', label: 'Test provider', keySource: 'none' });
    if (e.ANTHROPIC_API_KEY)
      add({
        id: 'anthropic',
        kind: 'anthropic',
        label: 'Anthropic',
        keySource: 'env',
        envVar: 'ANTHROPIC_API_KEY',
      });
    if (e.OPENAI_API_KEY)
      add({
        id: 'openai',
        kind: 'openai',
        label: 'OpenAI',
        keySource: 'env',
        envVar: 'OPENAI_API_KEY',
      });
    const geminiVar = e.GEMINI_API_KEY
      ? 'GEMINI_API_KEY'
      : e.GOOGLE_API_KEY
        ? 'GOOGLE_API_KEY'
        : null;
    if (geminiVar)
      add({
        id: 'gemini',
        kind: 'gemini',
        label: 'Google Gemini',
        keySource: 'env',
        envVar: geminiVar,
      });
    if (e.OPENAI_COMPATIBLE_BASE_URL)
      add({
        id: 'compatible',
        kind: 'openai-compatible',
        label: 'OpenAI-compatible',
        baseUrl: e.OPENAI_COMPATIBLE_BASE_URL,
        keySource: e.OPENAI_COMPATIBLE_API_KEY ? 'env' : 'none',
        envVar: 'OPENAI_COMPATIBLE_API_KEY',
      });
    if (e.ADAPTION_API_KEY)
      add({
        id: 'adaption',
        kind: 'adaption',
        label: 'Adaption',
        baseUrl: e.ADAPTION_BASE_URL,
        keySource: 'env',
        envVar: 'ADAPTION_API_KEY',
      });
    if (!this.deps.mock)
      add({
        id: 'local',
        kind: 'ollama',
        label: 'Local runtime',
        baseUrl: e.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL,
        keySource: 'none',
      });
    return out;
  }

  private savedConfigs(): ProviderConfig[] {
    return this.deps.store.getSetting<ProviderConfig[]>('router.providers', []);
  }

  private keyFor(c: ProviderConfig): string {
    if (c.keySource === 'env' && c.envVar) return this.deps.env[c.envVar] ?? '';
    if (c.keySource === 'secret') return this.deps.secrets.get(`provider.${c.id}.key`) ?? '';
    return '';
  }

  private makeAdapter(c: ProviderConfig): ProviderAdapter | null {
    const key = this.keyFor(c);
    switch (c.kind) {
      case 'anthropic':
        return key ? new AnthropicAdapter(c.id, key, c.baseUrl) : null;
      case 'openai':
        return key
          ? new OpenAIAdapter(c.id, key, c.baseUrl || 'https://api.openai.com/v1', true)
          : null;
      case 'openai-compatible':
        return c.baseUrl ? new OpenAIAdapter(c.id, key, c.baseUrl, false) : null;
      case 'gemini':
        return key ? new GeminiAdapter(c.id, key, c.baseUrl) : null;
      case 'ollama':
        return new OllamaAdapter(c.id, c.baseUrl);
      case 'adaption':
        return key ? new AdaptionAdapter(c.id, key, c.baseUrl) : null;
      case 'mock':
        return new MockAdapter(c.id, this.deps.mockResponders ?? {});
    }
  }

  load(): void {
    const disabled = new Set(this.deps.store.getSetting<string[]>('router.disabled', []));
    const rpm = this.deps.store.getSetting<Record<string, number>>('router.rpm', {});
    const natives = this.deps.store.getSetting<Record<string, boolean>>('router.native', {});
    const all = [...this.envConfigs(), ...this.savedConfigs()];
    const next = new Map<string, Runtime>();
    for (const raw of all) {
      if (next.has(raw.id)) continue;
      const config = { ...raw, enabled: !disabled.has(raw.id), rpm: rpm[raw.id] ?? raw.rpm };
      const prev = this.runtimes.get(raw.id);
      next.set(raw.id, {
        config,
        adapter: this.makeAdapter(config),
        models: prev?.models ?? [],
        status: prev?.status ?? 'unknown',
        lastError: prev?.lastError ?? null,
        native: natives[raw.id] ?? prev?.native ?? null,
        budget: prev?.budget ?? new RateBudget(config.rpm),
        controllers: prev?.controllers ?? new Set(),
      });
      next.get(raw.id)?.budget.setRpm(config.rpm);
    }
    this.runtimes = next;
    this.changed();
  }

  /** Test hook: direct access to an adapter (used for the mock provider in tests). */
  adapter(id: string): ProviderAdapter | null {
    return this.runtimes.get(id)?.adapter ?? null;
  }

  addProvider(input: {
    kind: ProviderKind;
    label?: string;
    baseUrl?: string;
    apiKey?: string;
  }): string {
    const id = `${input.kind}-${shortId().slice(0, 6)}`;
    const meta = PROVIDER_KINDS.find((k) => k.kind === input.kind);
    const config: ProviderConfig = {
      id,
      kind: input.kind,
      label: input.label || meta?.label || input.kind,
      baseUrl: input.baseUrl || undefined,
      enabled: true,
      rpm: 30,
      keySource: input.apiKey ? 'secret' : 'none',
    };
    if (input.apiKey) this.deps.secrets.set(`provider.${id}.key`, input.apiKey);
    this.deps.store.setSetting('router.providers', [...this.savedConfigs(), config]);
    this.load();
    return id;
  }

  removeProvider(id: string): boolean {
    const saved = this.savedConfigs();
    if (!saved.some((c) => c.id === id)) return false;
    this.abortProvider(id);
    this.deps.store.setSetting(
      'router.providers',
      saved.filter((c) => c.id !== id),
    );
    this.deps.secrets.set(`provider.${id}.key`, null);
    this.load();
    return true;
  }

  isRemovable(id: string): boolean {
    return this.savedConfigs().some((c) => c.id === id);
  }

  private abortProvider(id: string): void {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    for (const c of rt.controllers) c.abort(new ProviderDisabledError(id));
  }

  setEnabled(id: string, enabled: boolean): void {
    const disabled = new Set(this.deps.store.getSetting<string[]>('router.disabled', []));
    if (enabled) disabled.delete(id);
    else {
      disabled.add(id);
      this.abortProvider(id);
    }
    this.deps.store.setSetting('router.disabled', [...disabled]);
    this.load();
  }

  setRpm(id: string, rpm: number): void {
    const map = this.deps.store.getSetting<Record<string, number>>('router.rpm', {});
    map[id] = Math.max(1, Math.min(10_000, Math.round(rpm)));
    this.deps.store.setSetting('router.rpm', map);
    this.load();
  }

  get localOnly(): boolean {
    return this.deps.store.getSetting('router.localOnly', false);
  }

  setLocalOnly(on: boolean): void {
    this.deps.store.setSetting('router.localOnly', on);
    this.changed();
  }

  prices(): Record<string, { input: number; output: number }> {
    return this.deps.store.getSetting('router.prices', {});
  }

  setPrice(providerId: string, model: string, input: number, output: number): void {
    const p = this.prices();
    p[`${providerId}/${model}`] = { input, output };
    this.deps.store.setSetting('router.prices', p);
  }

  get adaptionModel(): string {
    return (
      this.deps.store.getSetting('router.adaptionModel', '') ||
      this.deps.env.ADAPTION_VOICE_MODEL ||
      ''
    );
  }

  setAdaptionModel(model: string): void {
    this.deps.store.setSetting('router.adaptionModel', model);
  }

  statuses(): ProviderStatus[] {
    return [...this.runtimes.values()].map((rt) => ({
      config: rt.config,
      status: rt.status,
      lastError: rt.lastError,
      models: rt.models,
      nativeStructured: rt.native,
      hasKey: rt.config.keySource === 'none' ? true : Boolean(this.keyFor(rt.config)),
      inFlight: rt.controllers.size,
      queued: rt.budget.waiting,
    }));
  }

  private chatRuntimes(includeLocal: boolean): Runtime[] {
    return [...this.runtimes.values()].filter(
      (rt) =>
        rt.config.enabled &&
        rt.adapter &&
        rt.config.kind !== 'adaption' &&
        (includeLocal || rt.config.kind !== 'ollama') &&
        rt.status !== 'error' &&
        rt.models.some((m) => m.kind === 'chat'),
    );
  }

  /** Resolved tier map: creator overrides that still exist, else defaults from live model lists. */
  tiers(): TierMap {
    const overrides = this.deps.store.getSetting<Partial<TierMap>>('router.tiers', {});
    const out: TierMap = { fast: [], balanced: [], deep: [] };
    const localOnly = this.localOnly;
    for (const tier of ['fast', 'balanced', 'deep'] as Tier[]) {
      const valid = (overrides[tier] ?? []).filter((t) => {
        const rt = this.runtimes.get(t.providerId);
        return (
          rt &&
          rt.config.enabled &&
          rt.models.some((m) => m.id === t.model) &&
          (!localOnly || rt.config.kind === 'ollama')
        );
      });
      const list = [...valid];
      for (const rt of this.chatRuntimes(true)) {
        if (localOnly && rt.config.kind !== 'ollama') continue;
        if (list.some((t) => t.providerId === rt.config.id)) continue;
        const pick = pickTierModels(rt.models)[tier];
        if (pick) list.push({ providerId: rt.config.id, model: pick });
      }
      // The local runtime is always the last resort.
      list.sort((a, b) => {
        const la = this.runtimes.get(a.providerId)?.config.kind === 'ollama' ? 1 : 0;
        const lb = this.runtimes.get(b.providerId)?.config.kind === 'ollama' ? 1 : 0;
        return la - lb;
      });
      out[tier] = list;
    }
    return out;
  }

  setTier(tier: Tier, targets: TierTarget[]): void {
    const overrides = this.deps.store.getSetting<Partial<TierMap>>('router.tiers', {});
    overrides[tier] = targets;
    this.deps.store.setSetting('router.tiers', overrides);
    this.changed();
  }

  // ---------------- probing ----------------

  async refreshModels(id: string): Promise<ModelInfo[]> {
    const rt = this.runtimes.get(id);
    if (!rt || !rt.adapter) return [];
    try {
      rt.models = await rt.adapter.listModels(AbortSignal.timeout(15_000));
      rt.status = rt.models.length ? 'ok' : 'error';
      rt.lastError = rt.models.length ? null : 'This provider lists no models';
    } catch (err) {
      rt.models = [];
      rt.status = 'error';
      rt.lastError = err instanceof Error ? err.message : String(err);
    }
    this.changed();
    return rt.models;
  }

  async refreshAll(): Promise<void> {
    await Promise.all(
      [...this.runtimes.values()]
        .filter((r) => r.config.enabled)
        .map((r) => this.refreshModels(r.config.id)),
    );
  }

  /** Real one-token call against one provider. */
  async testProvider(id: string): Promise<{ ok: boolean; message: string }> {
    const rt = this.runtimes.get(id);
    if (!rt?.adapter) return { ok: false, message: 'This provider is missing its key or address.' };
    const models = await this.refreshModels(id);
    if (!models.length) return { ok: false, message: rt.lastError ?? 'No models found.' };
    const model =
      rt.config.kind === 'adaption' && this.adaptionModel
        ? this.adaptionModel
        : pickTierModels(models).fast;
    if (!model) return { ok: false, message: 'No text models found.' };
    try {
      await rt.adapter.complete({
        model,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        maxTokens: 32,
        temperature: 0,
        tier: 'fast',
        signal: AbortSignal.timeout(60_000),
      });
      rt.status = 'ok';
      rt.lastError = null;
      this.changed();
      return {
        ok: true,
        message: `Connected. ${models.filter((m) => m.kind === 'chat').length} models available.`,
      };
    } catch (err) {
      rt.status = 'error';
      rt.lastError = err instanceof Error ? err.message : String(err);
      this.changed();
      return { ok: false, message: rt.lastError };
    }
  }

  async probeText(): Promise<{ ok: boolean; detail: string }> {
    await this.refreshAll();
    const candidates = this.chatRuntimes(true).filter(
      (rt) => !this.localOnly || rt.config.kind === 'ollama',
    );
    const passed: string[] = [];
    for (const rt of candidates) {
      const r = await this.testProvider(rt.config.id);
      if (r.ok) passed.push(rt.config.label);
    }
    return passed.length
      ? { ok: true, detail: `Writing models ready: ${passed.join(', ')}` }
      : { ok: false, detail: 'No model provider is connected yet.' };
  }

  async probeStructured(): Promise<{ ok: boolean; detail: string }> {
    const schema = {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    };
    const natives = this.deps.store.getSetting<Record<string, boolean>>('router.native', {});
    let any = false;
    for (const rt of this.chatRuntimes(true)) {
      if (rt.status !== 'ok' || !rt.adapter) continue;
      const model = pickTierModels(rt.models).fast;
      if (!model) continue;
      for (const native of [true, false]) {
        try {
          const res = await rt.adapter.complete({
            model,
            messages: [
              {
                role: 'user',
                content: 'Return only this JSON object and nothing else: {"ok": true}',
              },
            ],
            maxTokens: 64,
            temperature: 0,
            tier: 'fast',
            json: { schema, native },
            signal: AbortSignal.timeout(60_000),
          });
          const parsed = JSON.parse(extractJson(res.text)) as { ok?: unknown };
          if (parsed.ok === true) {
            rt.native = native;
            natives[rt.config.id] = native;
            any = true;
            break;
          }
        } catch {
          // try the next mode
        }
      }
    }
    this.deps.store.setSetting('router.native', natives);
    return any
      ? { ok: true, detail: 'Structured answers validate.' }
      : { ok: false, detail: 'No model returned valid structured answers.' };
  }

  private embeddingRuntime(): { rt: Runtime; model: string } | null {
    const saved = this.deps.store.getSetting<TierTarget | null>('router.embedding', null);
    if (saved) {
      const rt = this.runtimes.get(saved.providerId);
      if (rt?.config.enabled && rt.adapter?.embed && rt.models.some((m) => m.id === saved.model)) {
        return { rt, model: saved.model };
      }
    }
    for (const rt of this.runtimes.values()) {
      if (!rt.config.enabled || !rt.adapter?.embed || rt.status !== 'ok') continue;
      if (this.localOnly && rt.config.kind !== 'ollama') continue;
      const m = rt.models.find((x) => x.kind === 'embedding');
      if (m) return { rt, model: m.id };
    }
    return null;
  }

  async probeEmbeddings(): Promise<{ ok: boolean; detail: string }> {
    const target = this.embeddingRuntime();
    if (!target)
      return { ok: false, detail: 'No embedding model available; full-text ranking is used.' };
    try {
      const v = await target.rt.adapter?.embed?.(
        ['probe'],
        target.model,
        AbortSignal.timeout(30_000),
      );
      if (v && v[0]?.length) {
        this.deps.store.setSetting('router.embedding', {
          providerId: target.rt.config.id,
          model: target.model,
        });
        return { ok: true, detail: `Embeddings via ${target.rt.config.label}` };
      }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    return { ok: false, detail: 'Embedding call returned nothing.' };
  }

  async embed(
    texts: string[],
    signal?: AbortSignal,
  ): Promise<{ vectors: number[][]; model: string } | null> {
    const target = this.embeddingRuntime();
    if (!target?.rt.adapter?.embed) return null;
    try {
      const vectors = await target.rt.adapter.embed(texts, target.model, signal);
      return { vectors, model: target.model };
    } catch {
      return null;
    }
  }

  async probeLocal(): Promise<{ ok: boolean; detail: string }> {
    const rt = [...this.runtimes.values()].find((r) => r.config.kind === 'ollama');
    if (!rt) return { ok: false, detail: 'No local runtime configured.' };
    const models = await this.refreshModels(rt.config.id);
    return models.some((m) => m.kind === 'chat')
      ? { ok: true, detail: `Local runtime answers with ${models.length} models.` }
      : { ok: false, detail: rt.lastError ?? 'Local runtime has no models.' };
  }

  async probeAdaption(): Promise<{ ok: boolean; detail: string }> {
    const rt = [...this.runtimes.values()].find((r) => r.config.kind === 'adaption');
    if (!rt?.adapter || !rt.config.enabled)
      return { ok: false, detail: 'Adaption credentials are not set.' };
    if (!this.adaptionModel)
      return { ok: false, detail: 'Choose your Adaption voice model first.' };
    const r = await this.testProvider(rt.config.id);
    return r.ok
      ? { ok: true, detail: `Voice model ${this.adaptionModel} answers.` }
      : { ok: false, detail: r.message };
  }

  adaptionTarget(): TierTarget | null {
    const rt = [...this.runtimes.values()].find((r) => r.config.kind === 'adaption');
    return rt && this.adaptionModel
      ? { providerId: rt.config.id, model: this.adaptionModel }
      : null;
  }

  // ---------------- generation ----------------

  private cacheKey(opts: GenerateOptions): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          t: opts.templateId,
          tier: opts.tier,
          m: opts.messages,
          j: opts.json?.schema ?? null,
          x: opts.maxTokens,
          g: opts.target ?? null,
        }),
      )
      .digest('hex');
  }

  private attempts(opts: GenerateOptions): TierTarget[] {
    const exclude = new Set(opts.excludeProviders ?? []);
    const list: TierTarget[] = [];
    const push = (t: TierTarget) => {
      if (exclude.has(t.providerId)) return;
      if (list.some((x) => x.providerId === t.providerId && x.model === t.model)) return;
      list.push(t);
    };
    if (opts.target) {
      const rt = this.runtimes.get(opts.target.providerId);
      if (rt?.config.enabled && rt.adapter) push(opts.target);
    }
    const tiers = this.tiers();
    for (const t of tiers[opts.tier]) push(t);
    // Any other tier's models on other providers act as further failover.
    for (const tier of ['balanced', 'fast', 'deep'] as Tier[]) for (const t of tiers[tier]) push(t);
    return list;
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const useCache = opts.cache !== false;
    const key = useCache ? this.cacheKey(opts) : '';
    if (useCache) {
      const hit = this.deps.store.cacheGet(key);
      if (hit) {
        const parsed = JSON.parse(hit) as { text: string; providerId: string; model: string };
        opts.onDelta?.(parsed.text);
        this.deps.store.addUsage({
          module: opts.module,
          provider: parsed.providerId,
          model: parsed.model,
          tier: opts.tier,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          cached: true,
        });
        return { ...parsed, inputTokens: 0, outputTokens: 0, cached: true, attempts: [] };
      }
    }
    const attempts = this.attempts(opts);
    const log: GenerateResult['attempts'] = [];
    if (!attempts.length) {
      throw new RouterError(
        'No writing model is connected right now. Open Model Router to connect one.',
      );
    }
    for (const target of attempts) {
      const rt = this.runtimes.get(target.providerId);
      if (!rt?.adapter || !rt.config.enabled) continue;
      const controller = new AbortController();
      const onUserAbort = () => controller.abort(opts.signal?.reason);
      opts.signal?.addEventListener('abort', onUserAbort, { once: true });
      let emitted = false;
      try {
        await rt.budget.acquire(opts.priority, controller.signal);
        rt.controllers.add(controller);
        const adapter = rt.adapter;
        const call = (native: boolean) =>
          adapter.complete({
            model: target.model,
            messages: opts.messages,
            maxTokens: opts.maxTokens,
            temperature: opts.temperature,
            tier: opts.tier,
            json: opts.json ? { schema: opts.json.schema, native } : undefined,
            signal: controller.signal,
            onDelta: (d) => {
              emitted = true;
              opts.onDelta?.(d);
            },
            meta: { templateId: opts.templateId, input: opts.mockInput },
          });
        let res;
        try {
          res = await call(rt.native === true);
        } catch (err) {
          // A schema the provider's native mode rejects falls back to plain JSON instructions.
          if (
            opts.json &&
            rt.native === true &&
            err instanceof ProviderError &&
            err.status === 400 &&
            !emitted
          ) {
            res = await call(false);
          } else throw err;
        }
        log.push({ ...target, error: null });
        const price = this.prices()[`${target.providerId}/${target.model}`];
        this.deps.store.addUsage({
          module: opts.module,
          provider: target.providerId,
          model: target.model,
          tier: opts.tier,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          cost: price
            ? (res.inputTokens * price.input + res.outputTokens * price.output) / 1_000_000
            : null,
          cached: false,
        });
        if (useCache && res.text) {
          this.deps.store.cachePut(
            key,
            JSON.stringify({ text: res.text, providerId: target.providerId, model: target.model }),
          );
        }
        return {
          text: res.text,
          providerId: target.providerId,
          model: target.model,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          cached: false,
          attempts: log,
        };
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        const message = err instanceof Error ? err.message : String(err);
        log.push({ ...target, error: message });
        this.deps.logger.warn(
          `Model call failed on ${target.providerId}/${target.model}, trying the next one`,
          message,
        );
        if (emitted) opts.onReset?.();
      } finally {
        rt.controllers.delete(controller);
        opts.signal?.removeEventListener('abort', onUserAbort);
      }
    }
    throw new RouterError(
      'Every connected model failed to answer. Check Model Router and try again.',
    );
  }
}

/** Pulls the first JSON object or array out of a model answer. */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.search(/[{[]/);
  if (start < 0) return body;
  const open = body[start] as string;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return body.slice(start);
}
