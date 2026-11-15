import { z } from 'zod';
import { splitParagraphs } from '@kathix/kernel/shared';
import { EVIDENCE_RULE, type PromptTemplate } from '../template';
import type { SourceBlock } from './cowrite';

export interface PlanInput {
  goal: string;
  steps: { id: string; label: string; description: string }[];
  hasOutline: boolean;
  hasScriptText: boolean;
}

export const planSchema = z.object({
  steps: z.array(z.object({ stepId: z.string(), purpose: z.string() })),
  note: z.string(),
});

export type PlanOutput = z.infer<typeof planSchema>;

export const showrunnerPlan: PromptTemplate<PlanInput, PlanOutput> = {
  id: 'showrunner-plan',
  version: '1.0.0',
  tier: 'deep',
  temperature: 0.2,
  maxTokens: 1500,
  role: "You are a showrunner planning a creator's production pipeline. You may only use the tools listed as available.",
  task: (i) => `Plan the steps needed to reach the creator's goal: "${i.goal}".`,
  rules: [
    'Use only step ids from the available-steps block, in a sensible production order. Use a step at most once.',
    'Skip drafting when there is no outline and the script already has text; include drafting when there is an outline.',
    'Give each step a one-sentence purpose tied to the goal. Keep `note` to one sentence for the creator.',
  ],
  schema: planSchema,
  data: (i) => [
    {
      id: 'available-steps',
      kind: 'available-steps',
      text: i.steps.map((s) => `${s.id}: ${s.label}. ${s.description}`).join('\n'),
    },
    {
      id: 'state',
      kind: 'project-state',
      text: `Outline provided: ${i.hasOutline ? 'yes' : 'no'}. Script already has text: ${i.hasScriptText ? 'yes' : 'no'}.`,
    },
  ],
  mock: (i) => ({
    steps: i.steps
      .filter((s) => !(s.id.endsWith('.draft') && !i.hasOutline))
      .map((s) => ({ stepId: s.id, purpose: `${s.label} for this episode.` })),
    note: 'Each step waits for your approval before anything changes.',
  }),
};

export interface DraftInput {
  projectType: string;
  title: string;
  outline: string;
  existing: string;
  canon: SourceBlock[];
  voice: string | null;
  note: string;
}

export const draftSchema = z.object({
  script: z.string(),
  reason: z.string(),
  evidence: z.array(z.object({ sourceId: z.string(), quote: z.string() })),
});

export type DraftOutput = z.infer<typeof draftSchema>;

export const draftFromOutline: PromptTemplate<DraftInput, DraftOutput> = {
  id: 'draft-from-outline',
  version: '1.0.0',
  tier: 'balanced',
  temperature: 0.7,
  maxTokens: 12000,
  role: "You draft a script from the creator's own outline, as a starting point they will revise.",
  task: (i) =>
    `Draft "${i.title}" as a ${i.projectType} script that follows the outline beat by beat.`,
  rules: [
    'Use the script format: scene headings (SCENE or INT./EXT.), SPEAKER: dialogue lines, and [bracketed notes] for sound or direction.',
    'Follow the outline order. Do not add plot beats the outline does not imply.',
    'Stay consistent with every canon entry; list the entries you relied on as evidence.',
    EVIDENCE_RULE,
    'If a revision note is given, apply it to the existing draft instead of starting over.',
    'If a voice profile is given, write narration in that voice.',
  ],
  schema: draftSchema,
  streamField: 'script',
  data: (i) => [
    { id: 'outline', kind: 'creator-outline', text: i.outline },
    ...(i.existing ? [{ id: 'existing', kind: 'existing-draft', text: i.existing }] : []),
    ...(i.note ? [{ id: 'note', kind: 'revision-note', text: i.note }] : []),
    ...i.canon.map((c) => ({ id: c.id, kind: 'canon-entry', label: c.label, text: c.text })),
    ...(i.voice ? [{ id: 'voice', kind: 'voice-profile', text: i.voice }] : []),
  ],
  mock: (i) => {
    const beats = splitParagraphs(i.outline)
      .flatMap((p) => p.text.split('\n'))
      .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean);
    const lines = [`SCENE 1 - ${i.title.toUpperCase()}`, ''];
    beats.forEach((b, n) => {
      if (n > 0 && n % 3 === 0) lines.push('', `SCENE ${n / 3 + 1}`, '');
      lines.push(`NARRATOR: ${b.replace(/\.$/, '')}.`);
    });
    if (i.note) lines.push('', `[Revised: ${i.note}]`);
    const c = i.canon[0];
    return {
      script: lines.join('\n'),
      reason: 'Turns each outline beat into a narrated line in order.',
      evidence: c ? [{ sourceId: c.id, quote: c.text.split('\n')[0] ?? '' }] : [],
    };
  },
};
