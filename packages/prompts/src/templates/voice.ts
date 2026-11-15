import { z } from 'zod';
import type { PromptTemplate } from '../template';

export interface VoiceDescribeInput {
  metrics: string;
  excerpts: string[];
}

export const voiceDescribeSchema = z.object({
  description: z.string(),
  traits: z.array(z.string()),
});

export type VoiceDescribeOutput = z.infer<typeof voiceDescribeSchema>;

export const voiceDescribe: PromptTemplate<VoiceDescribeInput, VoiceDescribeOutput> = {
  id: 'voice-describe',
  version: '1.0.0',
  tier: 'fast',
  temperature: 0.4,
  maxTokens: 800,
  role: "You describe a writer's voice for the writer themself, plainly and kindly.",
  task: () =>
    'Write a two to three sentence description of this voice and list up to five short traits.',
  rules: [
    'Base the description on the measured metrics first; use the excerpts only to name qualities the numbers cannot.',
    'Do not quote the excerpts.',
  ],
  schema: voiceDescribeSchema,
  data: (i) => [
    { id: 'metrics', kind: 'measured-voice-metrics', text: i.metrics },
    ...i.excerpts.map((e, n) => ({ id: `excerpt-${n + 1}`, kind: 'writing-excerpt', text: e })),
  ],
  mock: (i) => {
    const long = /average sentence length: (\d+)/i.exec(i.metrics);
    const avg = long ? Number(long[1]) : 15;
    return avg > 18
      ? {
          description: 'A patient, flowing voice that builds long sentences and lingers on images.',
          traits: ['long sentences', 'lyrical', 'reflective'],
        }
      : {
          description: 'A quick, punchy voice that favours short sentences and direct address.',
          traits: ['short sentences', 'direct', 'energetic'],
        };
  },
};

export interface VoiceRewriteInput {
  profile: string;
  lines: { id: string; text: string; reasons: string[] }[];
  context: string;
}

export const voiceRewriteSchema = z.object({
  rewrites: z.array(z.object({ lineId: z.string(), text: z.string(), reason: z.string() })),
});

export type VoiceRewriteOutput = z.infer<typeof voiceRewriteSchema>;

export const voiceRewrite: PromptTemplate<VoiceRewriteInput, VoiceRewriteOutput> = {
  id: 'voice-rewrite',
  version: '1.0.0',
  tier: 'balanced',
  temperature: 0.6,
  maxTokens: 3000,
  role: 'You help a writer bring drifting lines back into their own voice. You keep their meaning and their facts.',
  task: () =>
    'Rewrite each drifting line so it matches the voice profile. Return one rewrite per line id.',
  rules: [
    'Keep each rewrite close in length to what the profile suggests and keep every fact of the original line.',
    'The reasons given for each line are measured differences from the profile; address them.',
    'Give a one-sentence reason per rewrite.',
    'Never copy sentences from the voice samples.',
  ],
  schema: voiceRewriteSchema,
  data: (i) => [
    { id: 'profile', kind: 'voice-profile', text: i.profile },
    { id: 'context', kind: 'surrounding-draft', text: i.context.slice(0, 3000) },
    ...i.lines.map((l) => ({
      id: l.id,
      kind: 'drifting-line',
      label: l.reasons.join('; '),
      text: l.text,
    })),
  ],
  mock: (i) => ({
    rewrites: i.lines.map((l) => {
      const short = /short sentences|shorter/i.test(l.reasons.join(' '));
      const text = short
        ? l.text
            .split(/,\s+|;\s+|\s+and\s+/)
            .map((p) => p.trim().replace(/[.!?]*$/, '.'))
            .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
            .join(' ')
        : l.text.replace(/\.\s+(\w)/g, (_m, c: string) => `, and ${c.toLowerCase()}`);
      return {
        lineId: l.id,
        text,
        reason: short
          ? 'Breaks the line into the short beats this voice uses.'
          : 'Joins the beats into the longer flow this voice uses.',
      };
    }),
  }),
};
