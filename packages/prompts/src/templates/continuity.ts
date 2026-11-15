import { z } from 'zod';
import { classifyLine, levenshtein, splitSentences } from '@kathix/kernel/shared';
export { renderCanonBlock, type CanonBlockEntry } from '@kathix/kernel/shared';
import { EVIDENCE_RULE, type PromptTemplate } from '../template';
import type { SourceBlock } from './cowrite';

export const ISSUE_TYPES = [
  'contradicted_fact',
  'character_trait',
  'timeline',
  'name_drift',
  'world_rule',
  'forgotten_promise',
] as const;

const RESERVED = new Set(['name', 'type', 'also called', 'summary', 'source passage']);

function parseCanonBlock(text: string): {
  name: string;
  type: string;
  aliases: string[];
  attrs: [string, string][];
} {
  let name = '';
  let type = '';
  let aliases: string[] = [];
  const attrs: [string, string][] = [];
  for (const line of text.split('\n')) {
    const m = /^([^:]{1,40}):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = (m[1] as string).trim();
    const value = (m[2] as string).trim();
    if (key.toLowerCase() === 'name') name = value;
    else if (key.toLowerCase() === 'type') type = value;
    else if (key.toLowerCase() === 'also called') aliases = value.split(',').map((s) => s.trim());
    else if (!RESERVED.has(key.toLowerCase())) attrs.push([key, value]);
  }
  return { name, type, aliases, attrs };
}

export interface ContinuityInput {
  draft: SourceBlock;
  canon: SourceBlock[];
  references: SourceBlock[];
  dismissed: string[];
}

export const continuitySchema = z.object({
  issues: z.array(
    z.object({
      type: z.enum(ISSUE_TYPES),
      severity: z.enum(['low', 'medium', 'high']),
      confidence: z.number().min(0).max(1),
      summary: z.string(),
      draftQuote: z.string(),
      refSourceId: z.string(),
      refQuote: z.string(),
      fixReplacement: z.string(),
      fixReason: z.string(),
    }),
  ),
  notEnoughInformation: z.boolean(),
});

export type ContinuityOutput = z.infer<typeof continuitySchema>;
type Issue = ContinuityOutput['issues'][number];

const COLORS = [
  'grey',
  'gray',
  'blue',
  'green',
  'brown',
  'black',
  'hazel',
  'amber',
  'red',
  'white',
  'golden',
  'silver',
];
const STOP = new Set(
  'the a an of to in on at and or with after before from into over is are was were be his her their its that this'.split(
    ' ',
  ),
);
const keywords = (v: string) =>
  (v.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w));

/** Deterministic rule-based checker standing in for the model in tests. */
function mockContinuity(input: ContinuityInput): ContinuityOutput {
  const draft = input.draft.text;
  const sentences = splitSentences(draft);
  const issues: Issue[] = [];
  const add = (i: Issue) => {
    if (!issues.some((x) => x.draftQuote === i.draftQuote && x.type === i.type)) issues.push(i);
  };
  const knownParts = new Set<string>();
  const blocks = input.canon.map((c) => ({ block: c, ...parseCanonBlock(c.text) }));
  for (const b of blocks)
    for (const n of [b.name, ...b.aliases])
      for (const p of n.split(/\s+/)) knownParts.add(p.toLowerCase());

  for (const b of blocks) {
    if (!b.name) continue;
    const first = b.name.split(/\s+/)[0] as string;
    const mentions = sentences.filter((s) => new RegExp(`\\b${first}\\b`).test(s.text));
    // Name drift (characters only)
    for (const part of b.type === 'character'
      ? b.name.split(/\s+/).filter((p) => p.length >= 5)
      : []) {
      for (const s of sentences) {
        for (const w of s.text.match(/\b[A-Z][a-z]{3,}\b/g) ?? []) {
          if (knownParts.has(w.toLowerCase())) continue;
          const d = levenshtein(w.toLowerCase(), part.toLowerCase());
          if (d >= 1 && d <= 2 && Math.abs(w.length - part.length) <= 2) {
            add({
              type: 'name_drift',
              severity: 'low',
              confidence: 0.8,
              summary: `"${w}" looks like a misspelling of ${part}.`,
              draftQuote: s.text,
              refSourceId: b.block.id,
              refQuote: `Name: ${b.name}`,
              fixReplacement: s.text.replace(w, part),
              fixReason: `Restores the canon spelling "${part}".`,
            });
          }
        }
      }
    }
    for (const [key, value] of b.attrs) {
      const k = key.toLowerCase();
      const v = value.toLowerCase();
      // Colour facts, e.g. "Eyes: grey"
      const canonColor = COLORS.find((c) => new RegExp(`\\b${c}\\b`).test(v));
      if (canonColor) {
        for (const s of mentions) {
          const t = s.text.toLowerCase();
          const other = COLORS.find((c) => c !== canonColor && new RegExp(`\\b${c}\\b`).test(t));
          if (other && t.includes(k.replace(/s$/, ''))) {
            add({
              type: 'contradicted_fact',
              severity: 'high',
              confidence: 0.9,
              summary: `${b.name}'s ${k} are ${canonColor} in canon, but the draft says ${other}.`,
              draftQuote: s.text,
              refSourceId: b.block.id,
              refQuote: `${key}: ${value}`,
              fixReplacement: s.text.replace(new RegExp(`\\b${other}\\b`, 'i'), canonColor),
              fixReason: `Matches the canon detail "${key}: ${value}".`,
            });
          }
        }
      }
      // Numeric facts, e.g. "Steps: 112"
      const num = /\b(\d+)\b/.exec(v)?.[1];
      if (num) {
        for (const s of sentences) {
          const t = s.text.toLowerCase();
          const n = /\b(\d+)\b/.exec(t)?.[1];
          if (n && n !== num && t.includes(k.replace(/s$/, ''))) {
            add({
              type: 'contradicted_fact',
              severity: 'medium',
              confidence: 0.75,
              summary: `Canon says ${key.toLowerCase()} is ${num}; the draft says ${n}.`,
              draftQuote: s.text,
              refSourceId: b.block.id,
              refQuote: `${key}: ${value}`,
              fixReplacement: s.text.replace(n, num),
              fixReason: `Uses the canon number from "${key}: ${value}".`,
            });
          }
        }
      }
      // Traits: fears, cannot, never
      if (/^(fears?|cannot|never|afraid of)$/.test(k)) {
        const kw = keywords(value);
        for (const s of mentions) {
          const t = s.text.toLowerCase();
          const hits = kw.filter((w) => t.includes(w));
          if (
            kw.length &&
            hits.length >= Math.min(2, kw.length) &&
            !/(afraid|fear|hesitat|refus|froze|could not|couldn't)/.test(t)
          ) {
            add({
              type: 'character_trait',
              severity: 'medium',
              confidence: 0.7,
              summary: `${b.name} acts against an established trait (${key.toLowerCase()}: ${value}).`,
              draftQuote: s.text,
              refSourceId: b.block.id,
              refQuote: `${key}: ${value}`,
              fixReplacement: `${first} stopped at the edge, unable to make himself go further.`,
              fixReason:
                'Keeps the character consistent with the trait the audience already knows.',
            });
          }
        }
      }
      // Status: dead
      if (k === 'status' && /(dead|died|drowned|deceased|killed)/.test(v)) {
        for (const line of draft.split('\n')) {
          const info = classifyLine(line);
          if (info.speaker && info.speaker.toLowerCase() === first.toLowerCase()) {
            add({
              type: 'timeline',
              severity: 'high',
              confidence: 0.85,
              summary: `${b.name} speaks here, but canon says: ${value}.`,
              draftQuote: line.trim(),
              refSourceId: b.block.id,
              refQuote: `${key}: ${value}`,
              fixReplacement: line
                .trim()
                .replace(new RegExp(`^\\s*${info.speaker}`), 'VOICE ON THE RADIO'),
              fixReason: 'Gives the line to someone who is still alive at this point in the story.',
            });
          }
        }
      }
      // World rules: "Forbidden: boat, after the curfew bell"
      if (k === 'forbidden') {
        const parts = value
          .split(',')
          .map((p) => p.trim().toLowerCase())
          .filter(Boolean);
        for (const s of sentences) {
          const t = s.text.toLowerCase();
          if (parts.length && parts.every((p) => keywords(p).every((w) => t.includes(w)))) {
            add({
              type: 'world_rule',
              severity: 'high',
              confidence: 0.8,
              summary: `This breaks a rule of the world: ${b.name}.`,
              draftQuote: s.text,
              refSourceId: b.block.id,
              refQuote: `${key}: ${value}`,
              fixReplacement: s.text.replace(/after/i, 'before'),
              fixReason: 'Keeps the action inside the rule the story set up.',
            });
          }
        }
      }
    }
  }
  const dismissed = new Set(input.dismissed.map((d) => d.toLowerCase()));
  return {
    issues: issues.filter((i) => !dismissed.has(i.summary.toLowerCase())),
    notEnoughInformation: input.canon.length + input.references.length === 0,
  };
}

export const continuityCheck: PromptTemplate<ContinuityInput, ContinuityOutput> = {
  id: 'continuity-check',
  version: '1.0.0',
  tier: 'deep',
  temperature: 0.1,
  maxTokens: 8000,
  role: 'You are a continuity supervisor for a serialized story. You catch contradictions before the audience does, and you never cry wolf.',
  task: () =>
    'Compare the draft against the canon entries and the earlier reference material. Report every place where the draft contradicts them.',
  rules: [
    'Issue types: contradicted_fact (a stated fact changes), character_trait (a character acts against an established trait), timeline (an impossible order of events, such as a dead character acting), name_drift (a misspelt or changed name), world_rule (a rule of the world is broken), forgotten_promise (an open promise is dropped or contradicted).',
    '`draftQuote` must be copied character for character from the draft. `refQuote` must be copied character for character from the block named by `refSourceId`.',
    EVIDENCE_RULE,
    'Report only real conflicts between two passages. Differences of style, new information that does not conflict, or deliberate mysteries are not issues.',
    '`confidence` is your probability (0 to 1) that the creator will agree it is a mistake. `severity` is how much it would bother the audience.',
    "`fixReplacement` is a corrected version of the draftQuote that keeps the creator's wording as much as possible; `fixReason` is one sentence.",
    'Do not report anything listed under creator-dismissed issues; the creator marked those as intentional.',
    'If there is nothing to compare against, return no issues and set notEnoughInformation to true.',
  ],
  schema: continuitySchema,
  data: (i) => [
    { id: i.draft.id, kind: 'draft', label: i.draft.label, text: i.draft.text },
    ...i.canon.map((c) => ({ id: c.id, kind: 'canon-entry', label: c.label, text: c.text })),
    ...i.references.map((r) => ({
      id: r.id,
      kind: 'earlier-material',
      label: r.label,
      text: r.text,
    })),
    ...(i.dismissed.length
      ? [{ id: 'dismissed', kind: 'creator-dismissed-issues', text: i.dismissed.join('\n') }]
      : []),
  ],
  mock: mockContinuity,
};
