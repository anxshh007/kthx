import { z } from 'zod';
import { CANON_TYPES, classifyLine, splitSentences, type CanonType } from '@kathix/kernel/shared';
import { EVIDENCE_RULE, type PromptTemplate } from '../template';

export interface CanonExtractInput {
  docId: string;
  title: string;
  text: string;
  projectType: string;
  existingNames: string[];
}

const entrySchema = z.object({
  type: z.enum(CANON_TYPES),
  name: z.string().min(1),
  summary: z.string(),
  attributes: z.array(z.object({ key: z.string(), value: z.string() })),
  aliases: z.array(z.string()),
  quote: z.string(),
  related: z.array(z.object({ name: z.string(), relation: z.string() })),
  timelineLabel: z.string(),
  timelineOrder: z.number().nullable(),
});

export const canonExtractSchema = z.object({
  entries: z.array(entrySchema),
  notEnoughInformation: z.boolean(),
});

export type CanonExtractOutput = z.infer<typeof canonExtractSchema>;

const STOP_NAMES = new Set(
  'The A An And But Then When Where What Who Why How It He She They We You I His Her Their Our Your This That These Those There Here Yes No Not Now Still Just Only Even Every Each Some Any All One Two Three Four Five Episode Scene Chapter Night Day Morning Evening Later Meanwhile Inside Outside INT EXT SFX Okay Oh Well'.split(
    ' ',
  ),
);

/** Deterministic test answer: recurring capitalised names become proposals. */
function mockExtract(input: CanonExtractInput): CanonExtractOutput {
  const counts = new Map<string, number>();
  const speakers = new Set<string>();
  for (const line of input.text.split('\n')) {
    const info = classifyLine(line);
    if (info.speaker) speakers.add(info.speaker);
  }
  const re = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input.text))) {
    const name = m[1] as string;
    const first = name.split(/\s+/)[0] as string;
    if (STOP_NAMES.has(first)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const sentences = splitSentences(input.text);
  const entries: CanonExtractOutput['entries'] = [];
  const existing = new Set(input.existingNames.map((n) => n.toLowerCase()));
  for (const [name, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    if (count < 2 || entries.length >= 12) continue;
    if (entries.some((e) => e.name.includes(name) || name.includes(e.name))) continue;
    const sentence = sentences.find((s) => s.text.includes(name));
    if (!sentence) continue;
    const isSpeaker = [...speakers].some(
      (s) => s.toLowerCase() === name.split(' ')[0]?.toLowerCase(),
    );
    const placeWords =
      /(Harbou?r|Street|Tower|Island|Market|Lighthouse|Quay|Bay|Hill|Hall|Inn|House|Point|Rock|Cove)/;
    const type: CanonType = isSpeaker ? 'character' : placeWords.test(name) ? 'place' : 'character';
    entries.push({
      type,
      name,
      summary: existing.has(name.toLowerCase())
        ? `Mentioned again in ${input.title}.`
        : `Appears in ${input.title}.`,
      attributes: [],
      aliases: [],
      quote: sentence.text,
      related: [],
      timelineLabel: '',
      timelineOrder: null,
    });
  }
  return { entries, notEnoughInformation: entries.length === 0 };
}

export const canonExtract: PromptTemplate<CanonExtractInput, CanonExtractOutput> = {
  id: 'canon-extract',
  version: '1.0.0',
  tier: 'balanced',
  temperature: 0.2,
  maxTokens: 6000,
  role: 'You are a meticulous story-bible editor helping a creator catalogue the canon of their own serialized work.',
  task: (i) =>
    `Read the ${i.projectType} material titled "${i.title}" and propose canon entries: characters, places, objects, factions, rules of the world, facts, timeline events, running gags, and open promises to the audience (setups not yet paid off).`,
  rules: [
    'Propose only what the material states. Never invent traits, history or relationships.',
    'Each entry needs a `quote`: one short passage (one or two sentences) copied character for character from the material that supports the entry.',
    EVIDENCE_RULE,
    'Use `attributes` for concrete details (for example eyes, age, role, status, fears, location); keys are short nouns, values are copied facts.',
    'Use `related` for relationships between named entries, with a short relation such as "sister of" or "works at".',
    'For timeline events give `timelineLabel` (in-world time as written) and `timelineOrder` (a number that orders events; null when unknown).',
    'Entries listed as already known may still be proposed when the material adds new detail; use the same name.',
    'If the material holds no canon at all, return an empty list and set notEnoughInformation to true.',
  ],
  schema: canonExtractSchema,
  data: (i) => [
    { id: 'known', kind: 'known-canon-names', text: i.existingNames.join(', ') || '(none yet)' },
    { id: i.docId, kind: 'creator-material', label: i.title, text: i.text },
  ],
  mock: mockExtract,
};
