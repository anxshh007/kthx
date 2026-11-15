# Kathix build progress

Resume rule: read the build brief and this file, then carry on from the first unchecked item. Don't redo checked items.

## Round 1 status (15 November 2026)

- [x] Toolchain, monorepo, TypeScript 6.0.3 (see DECISIONS #2), ESLint, Prettier, Vitest, Playwright, CI workflow
- [x] Kernel: capabilities, event bus, persisted job queue, config, redacting logger, encrypted secrets, shared types
- [x] Store: `node:sqlite` with FTS5, migrations, repositories
- [x] Model Router: Anthropic (SDK), OpenAI and compatible, Gemini, Ollama, Adaption, test provider; probes; failover; cache; budgets; usage
- [x] Prompts: 10 versioned templates, renderer, `runTemplate`, evidence verifier, evals
- [x] Retrieval: scene chunking, FTS ranking, embeddings, boosts, budgeter
- [x] UI kit, Studio shell, setup flow, palette, jobs tray, toasts with undo, background system
- [x] Modules: home, canon, script, continuity, voice, forge, showrunner, ledger, router (UI, routes, CLI, standalone)
- [x] Sample project: _The Lantern Keepers_ (bible with 28 entries, 3 episodes, episode 4 with 5 planted contradictions, episode 5 outline, two author voices with held-out drafts)
- [x] Backgrounds: 2 CC0 photographs and 6 procedural masters, AVIF and WebP exports, contrast test
- [x] Tests: unit, integration, evals, e2e demo path, UI truth test, performance
- [x] Docs: README, ARCHITECTURE, EVALS, DEMO_SCRIPT, DECISIONS, THIRD_PARTY, CREDITS, LICENSE, BUILD_REPORT
- [ ] Real-provider eval results in `docs/EVALS.md`. This needs an API key: run `pnpm evals:real`.
- [ ] Record the demo video from `docs/DEMO_SCRIPT.md` with a real provider connected.

## Round 2 (finale, 21 November 2026)

Not started. Paste the brief with "Run Round 2". Each finale module is a new package in `packages/modules/`, plus one line in `modules.config.json`, plus `agentSteps` if the Showrunner should use it.
