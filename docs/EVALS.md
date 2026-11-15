# Prompt evals

Every prompt template has fixture inputs and assertions in `packages/prompts/evals/cases.ts`. Each case checks schema validity (through `runTemplate`) plus task-specific properties:

| Case               | Assertions                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| canon-extract      | At least 3 entries; every quote is found verbatim in the material; the main character is found                            |
| cowrite (tighten)  | Output is shorter; every evidence quote verifies against the canon blocks provided                                        |
| coach              | Every question and weak beat anchors to a real passage                                                                    |
| continuity-check   | At least 4 of the 5 planted contradictions in the sample episode 4 are found; every draft and reference quote is verbatim |
| voice-describe     | A non-empty description                                                                                                   |
| voice-rewrite      | A rewrite is returned for each drifting line id                                                                           |
| forge-generate     | Every option is within the 60-character limit; every claim quote is in the script                                         |
| forge-refine       | Every refined option is within the limit                                                                                  |
| showrunner-plan    | Only available step ids are used                                                                                          |
| draft-from-outline | Output is in script format (scene headings and speaker lines)                                                             |

## Test provider (CI)

`pnpm evals` runs every case against the deterministic test provider. All 11 cases pass, including the check that every template is covered. The test provider answers each template from its own rule-based responder, so the cases exercise the real rendering, validation, verification and storage code without network calls.

## Real providers

`pnpm evals:real` runs the same cases against the providers configured in `.env` or the Studio, and writes the results below.

<!-- real-provider-results -->

_Last attempted 15 November 2026: no real provider key was available in the build environment, so no real-provider results are recorded yet. Run `pnpm evals:real` after adding a key to fill this table._
