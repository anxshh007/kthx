import { z } from 'zod';
import { splitSentences } from '@kathix/kernel/shared';
import { EVIDENCE_RULE, type PromptTemplate } from '../template';

export const COWRITE_ACTIONS = [
  'continue',
  'rewrite',
  'tighten',
  'expand',
  'tone',
  'alternatives',
  'punchup',
  'instruction',
] as const;

export type CowriteAction = (typeof COWRITE_ACTIONS)[number];

export interface SourceBlock {
  id: string;
  label: string;
  text: string;
}

export interface CowriteInput {
  action: CowriteAction;
  instruction: string;
  projectType: string;
  before: string;
  selection: string;
  after: string;
  canon: SourceBlock[];
  passages: SourceBlock[];
  voice: string | null;
  rejectNotes: string[];
  count: number;
}

const evidence = z.array(z.object({ sourceId: z.string(), quote: z.string() }));

export const cowriteSchema = z.object({
  suggestions: z.array(z.object({ text: z.string(), reason: z.string(), evidence })),
  notEnoughInformation: z.boolean(),
});

export type CowriteOutput = z.infer<typeof cowriteSchema>;

const ACTION_TASK: Record<CowriteAction, string> = {
  continue: 'Write the next few lines that continue the script from the cursor.',
  rewrite: 'Rewrite the selected passage so it reads better while keeping its meaning and facts.',
  tighten: 'Tighten the selected passage: cut filler and repetition, keep every story beat.',
  expand: 'Expand the selected passage with sensory detail and beats that fit the scene.',
  tone: 'Rewrite the selected passage in the tone the creator asks for.',
  alternatives: 'Offer three distinct alternative versions of the selected passage.',
  punchup:
    'Punch up the dialogue in the selected passage: sharper lines, more character, same intent.',
  instruction: "Follow the creator's instruction for the selected passage or the cursor position.",
};

const FILLER = /\b(very|really|just|quite|rather|somewhat|actually|basically|that)\s+/gi;

function mockCowrite(i: CowriteInput): CowriteOutput {
  const base = i.selection || i.before.slice(-240);
  const firstCanon = i.canon[0];
  const ev = firstCanon
    ? [
        {
          sourceId: firstCanon.id,
          quote: (splitSentences(firstCanon.text)[0]?.text ?? firstCanon.text).slice(0, 80),
        },
      ]
    : [];
  const one = (text: string, reason: string) => ({ text, reason, evidence: ev });
  switch (i.action) {
    case 'tighten':
      return {
        suggestions: [
          one(
            base
              .replace(FILLER, '')
              .replace(/\s{2,}/g, ' ')
              .trim(),
            'Cuts filler words so the beat lands faster.',
          ),
        ],
        notEnoughInformation: false,
      };
    case 'expand':
      return {
        suggestions: [
          one(
            `${base.trim()} The lamp hissed, and for a moment nobody moved.`,
            'Adds a sensory beat to hold the moment.',
          ),
        ],
        notEnoughInformation: false,
      };
    case 'alternatives':
      return {
        suggestions: [
          one(base.trim().replace(/\.$/, '!'), 'A more urgent reading of the same line.'),
          one(`Quietly: ${base.trim()}`, 'A hushed reading that raises tension.'),
          one(
            base.trim().split(' ').reverse().slice(0, 3).reverse().join(' '),
            'A clipped version that leaves space.',
          ),
        ].slice(0, Math.max(1, i.count)),
        notEnoughInformation: false,
      };
    case 'continue': {
      const who = firstCanon ? firstCanon.label.split(' ')[0] : 'Someone';
      return {
        suggestions: [
          one(
            `\n${who} looked toward the water and said nothing for a long while.`,
            'Continues the scene with a quiet beat before the next turn.',
          ),
        ],
        notEnoughInformation: false,
      };
    }
    case 'punchup':
      return {
        suggestions: [one(base.trim().replace(/\?$/, '?!'), 'Gives the line more bite.')],
        notEnoughInformation: false,
      };
    case 'tone':
      return {
        suggestions: [
          one(
            base
              .trim()
              .toLowerCase()
              .replace(/^./, (c) => c.toUpperCase()),
            `Shifts the tone toward "${i.instruction || 'softer'}".`,
          ),
        ],
        notEnoughInformation: false,
      };
    case 'rewrite':
    case 'instruction':
      return {
        suggestions: [
          one(
            base.trim().replace(/\s+and\s+/, ', and '),
            i.instruction
              ? `Follows the note: ${i.instruction}`
              : 'Smooths the rhythm of the passage.',
          ),
        ],
        notEnoughInformation: false,
      };
  }
}

export const cowrite: PromptTemplate<CowriteInput, CowriteOutput> = {
  id: 'cowrite',
  version: '1.0.0',
  tier: 'balanced',
  temperature: 0.7,
  maxTokens: 3000,
  role: "You are a co-writer working inside a creator's own script. You propose text; the creator decides. Match their format, characters and established canon.",
  task: (i) =>
    `${ACTION_TASK[i.action]}${i.instruction ? ` Creator's note: "${i.instruction}".` : ''} Return ${i.action === 'alternatives' ? Math.max(2, i.count) : 1} suggestion(s).`,
  rules: [
    'Each suggestion `text` is the exact replacement for the selected passage (or, with no selection, the text to insert at the cursor). Keep the script format: scene headings, SPEAKER: lines and [notes].',
    'Give a one-sentence `reason` for each suggestion, written to the creator.',
    'List the canon entries and past passages you relied on as `evidence`. Leave evidence empty if you relied on none.',
    EVIDENCE_RULE,
    'Never contradict the canon blocks. If the canon or script does not give enough to write well, set notEnoughInformation to true and still offer your best attempt.',
    'If a voice profile is given, write in that voice. Do not copy whole sentences from voice samples.',
    'If the creator rejected earlier attempts, the rejection notes explain why; avoid repeating those problems.',
  ],
  schema: cowriteSchema,
  streamField: 'text',
  data: (i) => [
    {
      id: 'before',
      kind: 'script-before-selection',
      text: i.before.slice(-3000) || '(start of script)',
    },
    {
      id: 'selection',
      kind: 'selected-passage',
      text: i.selection || '(cursor position, nothing selected)',
    },
    {
      id: 'after',
      kind: 'script-after-selection',
      text: i.after.slice(0, 1200) || '(end of script)',
    },
    ...i.canon.map((c) => ({ id: c.id, kind: 'canon-entry', label: c.label, text: c.text })),
    ...i.passages.map((p) => ({ id: p.id, kind: 'past-passage', label: p.label, text: p.text })),
    ...(i.voice ? [{ id: 'voice', kind: 'voice-profile', text: i.voice }] : []),
    ...(i.rejectNotes.length
      ? [{ id: 'rejections', kind: 'creator-rejection-notes', text: i.rejectNotes.join('\n') }]
      : []),
  ],
  mock: mockCowrite,
};

export interface CoachInput {
  projectType: string;
  text: string;
  canon: SourceBlock[];
}

export const coachSchema = z.object({
  questions: z.array(z.object({ question: z.string(), quote: z.string() })),
  weakBeats: z.array(z.object({ quote: z.string(), why: z.string() })),
});

export type CoachOutput = z.infer<typeof coachSchema>;

export const coach: PromptTemplate<CoachInput, CoachOutput> = {
  id: 'coach',
  version: '1.0.0',
  tier: 'balanced',
  temperature: 0.5,
  maxTokens: 2000,
  role: 'You are a script editor in coach mode. You write no script text. You ask the creator sharp questions and point out weak beats so they can fix them in their own words.',
  task: () => 'Read the passage and return up to four questions and up to three weak beats.',
  rules: [
    'Every question and weak beat must anchor to a `quote` copied character for character from the passage.',
    'Never suggest replacement lines or write dialogue. Questions only, and short explanations of why a beat is weak.',
    'Use the canon only to notice when the passage leaves something unclear or unmotivated.',
  ],
  schema: coachSchema,
  data: (i) => [
    { id: 'passage', kind: 'script-passage', text: i.text },
    ...i.canon.map((c) => ({ id: c.id, kind: 'canon-entry', label: c.label, text: c.text })),
  ],
  mock: (i) => {
    const sentences = splitSentences(i.text).filter((s) => s.text.length > 12);
    return {
      questions: sentences.slice(0, 2).map((s) => ({
        question: 'What does the listener need to feel at this moment?',
        quote: s.text,
      })),
      weakBeats: sentences
        .slice(2, 3)
        .map((s) => ({ quote: s.text, why: 'This beat restates what the scene already showed.' })),
    };
  },
};
