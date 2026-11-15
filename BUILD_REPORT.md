# Kathix build report: Round 1

Built 14–15 November 2026 for GeNarrative Clash 2026 (Round 1 submission, due 16 November 2026).

## What was built

All eight Round 1 modules from section 7 of the brief are built, running on the shared platform described in `docs/ARCHITECTURE.md`:

- Studio Home
- Canon Vault
- Script Studio
- Continuity Guard
- Voice Mirror
- Hook and Title Forge
- Showrunner agent
- Provenance Ledger, with the Model Router

Each module has its own route, its own `kathix` CLI command, and a standalone mode that needs no project. The platform also includes the capability registry, persisted job queue, encrypted settings, the model router with five provider adapters plus a test provider, the versioned prompt templates with an evidence verifier, retrieval with a token budgeter, the UI kit and background system, and an original sample project.

None of the six section 8 finale modules was built, stubbed or shown. An automated test (`packages/runtime/test/scope.test.ts`) fails if any trace of them appears in code or UI. They appear only in the README roadmap.

## Definition of done

| #   | Item                                                                                                     | Result                   | How it was verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A clean clone installs and starts with the two documented commands                                       | **Pass**                 | Cloned into a fresh folder: `pnpm install --frozen-lockfile` took 15 s. `pnpm start` built the client and served the Studio at `http://127.0.0.1:4319`: `/api/state` answered with 9 modules, the page returned 200, and background images were served. `pnpm seed` loaded the sample with no provider configured.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2   | All eight modules meet their "Done when" line                                                            | **Pass** (test provider) | Module integration tests in `packages/modules/*/test` (via `pnpm test:unit`), plus `tests/e2e/demo.spec.ts`. Checks per module: a new project reaches a working module (routes test); every canon proposal cites a verbatim span, and approved entries show in search, timeline and graph; every co-writer action streams, accepting writes a ledger event, and restore returns the exact prior text; at least 4 of the 5 planted contradictions are found with both quotes verbatim (all 5 are found); the two authors' profiles differ, and each held-out draft scores higher against its own author; Forge never exceeds limits and names the missing payoff; the Showrunner run completes, survives a restart and commits only approved changes; disabling the primary provider mid-request retries on the secondary with no user action (`packages/models/test/router.test.ts`). |
| 3   | Each module's standalone mode and CLI command works with no project open                                 | **Pass**                 | Standalone routes are covered by the UI truth test (`/`, `/continuity?mode=compare` and `/voice` with no project), and the script and canon tests cover the Scratchpad. CLI: `pnpm kathix seed`, `home projects`, `script list`, `continuity check`, `capabilities` and `router status` were run against the test provider. Every other command is registered from the same services the tests cover.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 4   | The UI truth test passes: no visible control is inert                                                    | **Pass**                 | `pnpm exec playwright test truth`: 26 tests. It crawls 24 routes, activates every visible control plus the controls inside the menus and dialogs they open, and checks the no-provider and no-Adaption gating. All 26 passed after one fix to the test itself (see "Fixes found by tests").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 5   | With no provider, only the setup screen shows; without Adaption credentials, no Adaption control renders | **Pass**                 | Routes test: a runtime with no provider reports `setupRequired: true`, and model routes return 503 with a plain message. Truth test: the setup screen shows with no navigation, and no "Adaption voice model" control appears on the Router, Script Studio or Voice pages. On the clean clone, `setupRequired` was `true`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 6   | No trace of the section 8 modules in code or UI                                                          | **Pass**                 | `packages/runtime/test/scope.test.ts` scans all package and app sources and the module registry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7   | Every background loads at full resolution with credits recorded, or the procedural fallback is in place  | **Pass, mixed**          | `apps/web/test/backgrounds.test.ts` checks that every slot has 3840×2160 masters, AVIF and WebP at 1920/2560/3840 wide, a placeholder, the 1920 AVIF under 400 KB, and photo credits. A pixel-sampling test confirms text over the scrim stays at 4.5:1 or better on every image.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 8   | The demo script runs start to finish on the seeded project in under four minutes                         | **Pass**                 | `tests/e2e/demo.spec.ts` follows `docs/DEMO_SCRIPT.md` end to end in about 31 s.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Performance budgets** (`tests/e2e/performance.spec.ts`, built Studio):

| Budget                                                                         | Result                                                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| First screen interactive in under 2 seconds                                    | 0.6–1.2 s measured. Passes.                                                             |
| Typing under 50 ms per keystroke on a 20,000-word script                       | Worst event duration 32–48 ms after warm-up. Passes.                                    |
| Canon import of a long document runs in the background without freezing the UI | Imports run as jobs, split into 12,000-character segments, with checkpoints after each. |
| First streamed token within 1.5 s on a hosted provider                         | **Not measured.** No hosted provider key was available.                                 |

**Quality gates:** `pnpm typecheck`, `pnpm lint` and `pnpm format:check` are all clean. `pnpm test:unit` runs 82 tests across 16 files (unit, integration, background and contrast, plus 11 prompt evals), and all pass. The final full run of `pnpm check` is recorded at the end of this report.

## Decisions and fallbacks

All 24 decisions, with reasons, are in `DECISIONS.md`. The fallbacks taken:

- **Database:** Node's built-in `node:sqlite`, so no WebAssembly fallback was needed.
- **TypeScript 6.0.3 instead of 7.0.2:** the lint tooling does not support 7 yet.
- **Adaption:** inference and model listing use the documented Responses API. Training is documented in the README via the exported dataset; Kathix makes no unverifiable training calls.
- **Backgrounds:** photographs for 2 slots, procedural masters for 6.
- **Embeddings:** without an embedding model, retrieval falls back silently to full-text ranking.
- **Spellcheck:** turned off only for scripts over 40,000 characters, to keep within the typing budget.

## Photographs or procedural backgrounds

Both. The Canon Vault and Continuity Guard backgrounds are CC0 photographs from Wikimedia Commons, credited in `CREDITS.md`. Studio Home, Voice Mirror, Hook and Title Forge, Showrunner, Ledger and Model Router use procedurally generated 4K masters in the Studio palette. No licensed photograph found during the build was at least 3840 pixels wide, landscape, and free of people and logos for those subjects. Script Studio uses the paper-grain texture, as the brief specifies.

## Removed or not done, and why

- **Real-provider evals and first-token latency.** No model API key was available in the build environment. Everything was verified with the deterministic test provider, which exercises the real code paths but not model quality. Run `pnpm evals:real` with a key to fill `docs/EVALS.md`.
- **Live Adaption verification.** There were no Adaption credentials. The adapter follows the published API and stays hidden unless its probe succeeds.
- **Demo video.** Recording it (deliverable 3) is left to the creator, using `docs/DEMO_SCRIPT.md` with a real provider connected.
- No capability was removed.

## Fixes found by tests

1. Resumed jobs ran before the first capability probe. Jobs now start only after it.
2. A canon import that finished before the browser received its job id never moved to Review. Fixed.
3. Tabs didn't follow in-app navigation. They are now derived from the URL in every module.
4. Words could run together when a suggestion was trimmed. The spacing around the selection is now preserved.
5. Several destructive actions had no undo. They now have one.
6. Disabled buttons became clickable explanations, so no control is greyed out.
7. Typing on very long scripts stalled. Removed per-keystroke copies and debounced state, and spellcheck is off for very long scripts.
8. The truth test itself was adjusted:
   - It now counts already-selected tabs, file pickers, and switches that remove themselves as effects.
   - It crawls the shared sidebar once instead of on every route.

## Commands

| Task                                     | Command                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Install                                  | `pnpm install`                                                                                        |
| Start the Studio (builds the client)     | `pnpm start` → http://127.0.0.1:4319                                                                  |
| Seed the sample project                  | `pnpm seed`                                                                                           |
| Development mode                         | `pnpm dev`                                                                                            |
| Unit, integration and evals              | `pnpm test:unit`                                                                                      |
| End-to-end (demo, UI truth, performance) | `pnpm test:e2e` (first run `pnpm exec playwright install chromium`, or rely on system Edge or Chrome) |
| Everything                               | `pnpm check`                                                                                          |
| Real-provider evals                      | `pnpm evals:real`                                                                                     |
| CLI                                      | `pnpm kathix --help`                                                                                  |
| Rebuild backgrounds                      | `pnpm backgrounds`                                                                                    |

## Final full run

`pnpm check` on 15 November 2026 exited 0:

- typecheck, lint and format check were all clean
- Vitest: 16 files, **82 passed**
- Playwright: **29 passed** in 6.7 minutes (1 demo path, 26 UI truth tests, 2 performance tests)
