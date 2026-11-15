/**
 * Eval cases: fixture inputs plus assertions for every prompt template.
 * The same cases run against the test provider in CI (`pnpm evals`) and against
 * real providers with `pnpm evals:real`, which records results in docs/EVALS.md.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateQuote, renderCanonBlock } from '@kathix/kernel/shared';
import type { ModelRouter } from '@kathix/models';
import {
  canonExtract,
  coach,
  continuityCheck,
  cowrite,
  draftFromOutline,
  forgeGenerate,
  forgeRefine,
  runTemplate,
  showrunnerPlan,
  verifyEvidence,
  voiceDescribe,
  voiceRewrite,
  type PromptTemplate,
} from '../src/index';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sample = (f: string) =>
  readFileSync(path.join(root, 'seed', 'sample', f), 'utf8').replace(/\r\n/g, '\n');

export interface EvalCase {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  template: PromptTemplate<any, any>;
  input: unknown;
  /** Returns failure messages; empty means the case passed. */
  check(output: unknown): string[];
}

const canonBlocks = () => {
  const bible = sample('bible.md');
  const blocks: { id: string; label: string; text: string }[] = [];
  for (const m of bible.matchAll(/^## (Character|Rule): (.+)\n([\s\S]*?)(?=\n## |(?![\s\S]))/gm)) {
    const attrs = Object.fromEntries(
      [...(m[3] as string).matchAll(/^- ([^:]+): (.+)$/gm)].map((a) => [
        a[1] as string,
        a[2] as string,
      ]),
    );
    blocks.push({
      id: `canon-${blocks.length}`,
      label: m[2] as string,
      text: renderCanonBlock({
        name: m[2] as string,
        type: (m[1] as string).toLowerCase(),
        aliases: [],
        summary: '',
        attributes: attrs,
        sourceQuote: '',
      }),
    });
  }
  return blocks;
};

export function cases(): EvalCase[] {
  const ep1 = sample('episode-1.txt');
  const ep3 = sample('episode-3.txt');
  const ep4 = sample('episode-4-draft.txt');
  const canon = canonBlocks();
  return [
    {
      name: 'canon-extract: every proposal quotes the material verbatim',
      template: canonExtract,
      input: {
        docId: 'doc',
        title: 'Episode 1',
        text: ep1,
        projectType: 'podcast',
        existingNames: [],
      },
      check: (o) => {
        const out = o as { entries: { name: string; quote: string }[] };
        const errs: string[] = [];
        if (out.entries.length < 3) errs.push(`only ${out.entries.length} entries`);
        for (const e of out.entries)
          if (!locateQuote(ep1, e.quote)) errs.push(`unverifiable quote for ${e.name}`);
        if (!out.entries.some((e) => /Mirela/.test(e.name))) errs.push('missed Mirela');
        return errs;
      },
    },
    {
      name: 'cowrite: tighten keeps format and cites only real canon',
      template: cowrite,
      input: {
        action: 'tighten',
        instruction: '',
        projectType: 'podcast',
        before: '',
        selection: 'MIRELA: I really just think that we should very quickly go up the stair now.',
        after: '',
        canon: canon.slice(0, 3),
        passages: [],
        voice: null,
        rejectNotes: [],
        count: 1,
      },
      check: (o) => {
        const out = o as {
          suggestions: { text: string; evidence: { sourceId: string; quote: string }[] }[];
        };
        const errs: string[] = [];
        const s = out.suggestions[0];
        if (!s) return ['no suggestion'];
        if (s.text.length >= 75) errs.push('not tighter');
        const verified = verifyEvidence(
          s.evidence,
          canon.slice(0, 3).map((c) => ({ ...c, kind: 'canon' as const })),
        );
        if (verified.length !== s.evidence.length) errs.push('unverifiable evidence');
        return errs;
      },
    },
    {
      name: 'coach: questions anchor to real passages and write no script',
      template: coach,
      input: { projectType: 'podcast', text: ep3, canon: [] },
      check: (o) => {
        const out = o as { questions: { quote: string }[]; weakBeats: { quote: string }[] };
        return [...out.questions, ...out.weakBeats]
          .filter((q) => !locateQuote(ep3, q.quote))
          .map((q) => `unanchored: ${q.quote.slice(0, 40)}`);
      },
    },
    {
      name: 'continuity-check: finds at least 4 of 5 planted contradictions with verbatim quotes',
      template: continuityCheck,
      input: {
        draft: { id: 'draft', label: 'Episode 4', text: ep4 },
        canon,
        references: [],
        dismissed: [],
      },
      check: (o) => {
        const out = o as {
          issues: { draftQuote: string; refSourceId: string; refQuote: string }[];
        };
        const planted = [
          /brown eyes/,
          /Teodor dove/,
          /BRANNOCH:/,
          /Ilsabeth/,
          /after the curfew bell/,
        ];
        const errs: string[] = [];
        const found = planted.filter((re) => out.issues.some((i) => re.test(i.draftQuote))).length;
        if (found < 4) errs.push(`found ${found} of 5`);
        for (const i of out.issues) {
          if (!locateQuote(ep4, i.draftQuote)) errs.push('draft quote not verbatim');
          const block = canon.find((c) => c.id === i.refSourceId);
          if (!block || !locateQuote(block.text, i.refQuote))
            errs.push('reference quote not verbatim');
        }
        return errs;
      },
    },
    {
      name: 'voice-describe: returns a description and traits',
      template: voiceDescribe,
      input: {
        metrics: 'Average sentence length: 31 words\nPoint of view: third person',
        excerpts: ['The ferry left at the hour when the light goes thin.'],
      },
      check: (o) =>
        (o as { description: string }).description.length > 10 ? [] : ['empty description'],
    },
    {
      name: 'voice-rewrite: one rewrite per drifting line id',
      template: voiceRewrite,
      input: {
        profile: 'Short punchy first-person sentences.',
        context: '',
        lines: [
          {
            id: 'line-1',
            text: 'The harbour, which had for many generations stood patient beneath the lighthouse, received the evening quietly.',
            reasons: ['much longer than your usual sentences; this voice uses shorter sentences'],
          },
        ],
      },
      check: (o) => {
        const out = o as { rewrites: { lineId: string; text: string }[] };
        return out.rewrites.some((r) => r.lineId === 'line-1' && r.text.trim())
          ? []
          : ['no rewrite for line-1'];
      },
    },
    {
      name: 'forge-generate: options within limit, claims traced or flagged',
      template: forgeGenerate,
      input: {
        kind: 'title',
        platform: 'YouTube',
        audience: 'mystery fans',
        tone: 'eerie',
        maxChars: 60,
        count: 4,
        script: ep3,
        voice: null,
      },
      check: (o) => {
        const out = o as { options: { text: string; claims: { scriptQuote: string }[] }[] };
        const errs: string[] = [];
        if (!out.options.length) errs.push('no options');
        for (const op of out.options) {
          if (op.text.length > 60) errs.push(`over limit: ${op.text.length}`);
          for (const c of op.claims)
            if (c.scriptQuote && !locateQuote(ep3, c.scriptQuote))
              errs.push('claim quote not in script');
        }
        return errs;
      },
    },
    {
      name: 'forge-refine: refined options stay within limit',
      template: forgeRefine,
      input: {
        kind: 'hook',
        platform: 'Podcast apps',
        audience: '',
        tone: '',
        maxChars: 120,
        count: 3,
        script: ep3,
        voice: null,
        favourite: 'A key turns up under the salt.',
        note: 'more mystery',
      },
      check: (o) =>
        (o as { options: { text: string }[] }).options
          .filter((x) => x.text.length > 120)
          .map(() => 'over limit'),
    },
    {
      name: 'showrunner-plan: uses only available step ids',
      template: showrunnerPlan,
      input: {
        goal: 'Draft episode 5 from this outline and make it ready to record',
        steps: [
          { id: 'script.draft', label: 'Draft', description: 'Draft from outline' },
          { id: 'continuity.check', label: 'Continuity', description: 'Check' },
        ],
        hasOutline: true,
        hasScriptText: false,
      },
      check: (o) =>
        (o as { steps: { stepId: string }[] }).steps
          .filter((s) => !['script.draft', 'continuity.check'].includes(s.stepId))
          .map((s) => `unknown step ${s.stepId}`),
    },
    {
      name: 'draft-from-outline: follows the outline in script format',
      template: draftFromOutline,
      input: {
        projectType: 'podcast',
        title: 'Episode 5',
        outline: sample('episode-5-outline.txt'),
        existing: '',
        canon: canon.slice(0, 4),
        voice: null,
        note: '',
      },
      check: (o) => {
        const out = o as { script: string };
        return /SCENE|INT\.|EXT\./.test(out.script) && /^[A-Z][A-Z ]+:/m.test(out.script)
          ? []
          : ['not in script format'];
      },
    },
  ];
}

export async function runCase(
  router: ModelRouter,
  c: EvalCase,
): Promise<{ ok: boolean; errors: string[]; model: string }> {
  try {
    const res = await runTemplate(router, c.template, c.input, {
      module: 'evals',
      priority: 'background',
      cache: false,
    });
    const errors = c.check(res.output);
    return { ok: errors.length === 0, errors, model: `${res.providerId}/${res.model}` };
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)], model: '' };
  }
}
