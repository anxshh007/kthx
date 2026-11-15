# Kathix architecture

Kathix is a local-first web application in a TypeScript monorepo. A shared kernel serves independent modules, and no module imports another module's internals.

## Packages

| Package              | Responsibility                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | The Studio: a Vite + React client and a Node HTTP server. `/api/*` goes to the Hono app; everything else is the built client, or Vite middleware in dev. All model calls happen on the server.                                                                                                                                                    |
| `apps/cli`           | The `kathix` command. It loads every module's `cli.ts` from the registry, so each module works headless.                                                                                                                                                                                                                                          |
| `packages/kernel`    | Capability registry with ordered real probes, typed event bus, persisted job queue (priorities, checkpoints, resume, cancel, retry), configuration, key-redacting logger, and an AES-256-GCM encrypted settings file. Its `shared/` subpath is browser-safe: types, authorship spans, text utilities, script format and the canon block renderer. |
| `packages/store`     | `node:sqlite` wrapper, migrations, typed repositories and the FTS5 chunk index.                                                                                                                                                                                                                                                                   |
| `packages/models`    | Model Router: provider adapters (Anthropic SDK; OpenAI and OpenAI-compatible, Gemini, Ollama and Adaption over `fetch`; a deterministic test provider), rate budgets with a priority queue, prompt-hash response cache, failover, usage records, probes and live model lists.                                                                     |
| `packages/prompts`   | One file per task. Each template has a version, tier, temperature, zod schema, data-block builder and deterministic test answer. Also holds `runTemplate` (validation, retry, failover), the evidence verifier, and evals.                                                                                                                        |
| `packages/retrieval` | Scene chunking, FTS5 ranking, optional embeddings, recency and relationship boosts, and the token budgeter.                                                                                                                                                                                                                                       |
| `packages/platform`  | The module contract (`ServerModule`, `CliModule`, `AgentStep`, cross-module APIs), script edit helpers that keep authorship and versions, the SSE helper and plain-language errors.                                                                                                                                                               |
| `packages/runtime`   | Assembles kernel, store, router, probes and modules, and builds the Hono app with core routes (`/api/state`, `/api/events`, `/api/jobs`).                                                                                                                                                                                                         |
| `packages/ui`        | Design tokens and stylesheet, shared components (suggestion card, diff view, evidence list, menus, dialogs, background system), the API client and the Studio context (routing, toasts, undo, confirmations, live events).                                                                                                                        |
| `packages/modules/*` | `home`, `canon`, `script`, `continuity`, `voice`, `forge`, `showrunner`, `ledger`, `router`. Each has `manifest.ts`, `server.ts` (service, routes and agent steps), `ui.tsx` and `cli.ts`.                                                                                                                                                        |

## Module contract

```ts
interface ModuleManifest {
  id;
  title;
  tagline;
  requires: Capability[];
  nav;
  cli;
  actions: PaletteAction[];
}
interface ServerModule<S> {
  manifest;
  createService(ctx): S;
  routes?(app, service, ctx);
  agentSteps?(service, ctx): AgentStep[];
}
interface CliModule {
  register(program, getContext);
}
```

- `modules.config.json` is the single registry. The server and CLI import each module by path, and the client finds pages with `import.meta.glob`.
- A module's routes are mounted at `/api/m/<id>`, behind a guard that returns a plain message when the capabilities it needs are missing.
- Cross-module features go through small published contracts, never through internals. Voice exposes `VoiceApi` (used by Script Studio and the Forge), and canon exposes `CanonApi` (used by seeding). Each is registered with `ctx.provide` and read with `ctx.use`.
- The Showrunner never names other modules. It plans with whatever `AgentStep`s are registered and runnable, so a finale module that registers a step joins plans with no change to the agent.

## Data model

Tables: `projects`, `scripts`, `script_versions` (text and authorship spans), `source_docs`, `canon_entries`, `canon_history`, `canon_links`, `canon_proposals`, `continuity_issues`, `continuity_dismissals`, `voice_profiles`, `voice_samples`, `suggestions`, `ledger_events`, `jobs`, `usage_records`, `response_cache`, `settings`, `showrunner_runs`, `forge_items`, `chunks` and `chunks_fts`.

- One database file per installation, at `./data/kathix.db` (git-ignored).
- **Nothing is overwritten.** `saveVersion` creates a new numbered version whenever text or authorship changes.
- **Authorship** is run-length spans (`human`, `ai`, `ai_edited`). Every edit maps them through the change: typing in the editor, accepted suggestions and fixes on the server, and diff-mapping for whole rewrites from the Showrunner. The human share is computed from characters.
- **Jobs** store their input, checkpointed state, progress and result. On start, any job left `running` is re-queued and resumes from its checkpoint. Jobs start only after the first capability probe, so resumed work sees the real capabilities.

## Capability gating

| Capability              | Probe                                                                  |
| ----------------------- | ---------------------------------------------------------------------- |
| `store.ready`           | Migrations applied and a real write succeeds                           |
| `model.local`           | Ollama answers at its default address with at least one model          |
| `model.text`            | A short completion succeeds on at least one enabled provider           |
| `model.structured`      | A schema-constrained call returns valid JSON (native mode tried first) |
| `model.embeddings`      | An embedding call succeeds                                             |
| `model.custom.adaption` | Adaption key set, voice model chosen, and a real call succeeds         |

The client renders navigation, buttons, palette actions and module controls only when their capabilities are present. When a capability drops, the server's change event makes the client re-read state, and affected controls disappear. A failed job shows its plain-language error with a retry button in the jobs tray. Without `model.text`, only the setup screen is shown. Embeddings degrade silently: without them, retrieval uses FTS ranking alone.

## Request flow: a co-writer suggestion

1. The Studio flushes autosave and posts `{action, from, to}` to `/api/m/script/scripts/:id/suggest`.
2. Retrieval ranks canon entries and passages from earlier episodes for the selection. The budgeter keeps what fits the co-write budget.
3. `runTemplate(cowrite)` renders the prompt in a fixed order (role, rules, schema, then data blocks), and the router streams it from the first healthy model in the tier. Partial `text` fields go to the browser as SSE `delta` events. If a provider fails mid-stream, a `reset` event is sent and the next model continues.
4. The answer is validated with zod. If it fails, Kathix retries with the error, then fails over. Evidence quotes are verified against their sources; unverifiable ones are dropped.
5. The suggestion is stored as `offered` and a ledger event is written. When the creator accepts, the server replaces the exact original range (refusing if that text has changed), maps authorship, saves a new version, reindexes and logs the decision.

## Security and privacy

- The server binds to `127.0.0.1`, and there is no telemetry.
- Keys come from `.env` or the encrypted settings file. They never reach the browser, the database or the logs; the logger redacts key patterns.
- Imported and pasted text is always wrapped as data. Closing tags inside it are escaped, and the rules say data is never an instruction. Model output can only propose: canon writes and script changes always need an explicit action by the creator.
