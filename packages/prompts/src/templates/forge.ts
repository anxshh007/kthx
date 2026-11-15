import { z } from 'zod';
import { splitSentences, words } from '@kathix/kernel/shared';
import type { PromptTemplate } from '../template';

export const FORGE_KINDS = ['hook', 'title', 'thumbnail', 'description'] as const;
export type ForgeKind = (typeof FORGE_KINDS)[number];

export const FORGE_KIND_LABELS: Record<ForgeKind, string> = {
  hook: 'Opening hook',
  title: 'Title',
  thumbnail: 'Thumbnail text',
  description: 'One-line description',
};

export interface ForgeInput {
  kind: ForgeKind;
  platform: string;
  audience: string;
  tone: string;
  maxChars: number;
  count: number;
  script: string;
  voice: string | null;
}

const score = z.object({ score: z.number().min(0).max(10), reason: z.string() });

export const forgeOptionSchema = z.object({
  text: z.string(),
  claims: z.array(z.object({ claim: z.string(), scriptQuote: z.string() })),
  clarity: score,
  curiosity: score,
  honesty: score,
});

export const forgeSchema = z.object({ options: z.array(forgeOptionSchema) });
export type ForgeOutput = z.infer<typeof forgeSchema>;
export type ForgeOption = z.infer<typeof forgeOptionSchema>;

const forgeRules = [
  'Every option must fit within the character limit given in the task, counting spaces.',
  'List every promise or factual claim the option makes in `claims`. For each, copy into `scriptQuote` the passage of the script (character for character) that delivers it, or leave scriptQuote empty if the script does not deliver it.',
  'Score clarity (is it instantly understood), curiosity (does it make people want to watch or read) and honesty (does the script deliver what it promises) from 0 to 10, each with a one-sentence reason.',
  'Prefer options the script fully pays off. Never promise twists, reveals or stakes the script lacks.',
];

function mockOptions(i: ForgeInput, n: number): ForgeOutput {
  const sentences = splitSentences(i.script).filter((s) => words(s.text).length >= 4);
  const options: ForgeOption[] = [];
  for (let k = 0; k < n; k++) {
    const s = sentences[k % Math.max(1, sentences.length)];
    const base = s ? words(s.text).slice(0, 6).join(' ') : 'A new episode';
    const honest = k !== n - 1;
    const text = (honest ? base : `${base}: the secret nobody survives`).slice(0, i.maxChars);
    options.push({
      text,
      claims: honest
        ? [{ claim: base, scriptQuote: s?.text ?? '' }]
        : [
            { claim: base, scriptQuote: s?.text ?? '' },
            { claim: 'a secret nobody survives', scriptQuote: '' },
          ],
      clarity: { score: 7, reason: 'Names the situation directly.' },
      curiosity: {
        score: honest ? 6 : 9,
        reason: honest ? 'Raises a question the episode answers.' : 'Teases a deadly secret.',
      },
      honesty: {
        score: honest ? 9 : 3,
        reason: honest ? 'The script delivers this.' : 'The script never shows such a secret.',
      },
    });
  }
  return { options };
}

export const forgeGenerate: PromptTemplate<ForgeInput, ForgeOutput> = {
  id: 'forge-generate',
  version: '1.0.0',
  tier: 'balanced',
  temperature: 0.8,
  maxTokens: 3000,
  role: "You are a packaging editor for a creator's episode. You write hooks, titles and descriptions that are compelling and true to the episode.",
  task: (i) =>
    `Write ${i.count} distinct ${i.kind} options for ${i.platform}, aimed at ${i.audience || "the creator's audience"}, in a ${i.tone || 'natural'} tone. Hard limit: ${i.maxChars} characters each.`,
  rules: [...forgeRules, 'If a voice profile is given, the options should sound like that voice.'],
  schema: forgeSchema,
  data: (i) => [
    { id: 'script', kind: 'episode-script', text: i.script.slice(0, 40000) },
    ...(i.voice ? [{ id: 'voice', kind: 'voice-profile', text: i.voice }] : []),
  ],
  mock: (i) => mockOptions(i, i.count),
};

export interface ForgeRefineInput extends ForgeInput {
  favourite: string;
  note: string;
}

export const forgeRefine: PromptTemplate<ForgeRefineInput, ForgeOutput> = {
  id: 'forge-refine',
  version: '1.0.0',
  tier: 'fast',
  temperature: 0.7,
  maxTokens: 1500,
  role: forgeGenerate.role,
  task: (i) =>
    `Refine the creator's favourite ${i.kind} option into 3 improved variants for ${i.platform}. Creator's note: "${i.note || 'make it sharper'}". Hard limit: ${i.maxChars} characters each.`,
  rules: forgeRules,
  schema: forgeSchema,
  data: (i) => [
    { id: 'favourite', kind: 'favourite-option', text: i.favourite },
    { id: 'script', kind: 'episode-script', text: i.script.slice(0, 40000) },
  ],
  mock: (i) => {
    const out = mockOptions(i, 3);
    out.options = out.options.map((o, k) => ({
      ...o,
      text: `${i.favourite}${k ? ` (${k + 1})` : ''}`.slice(0, i.maxChars),
    }));
    return out;
  },
};
