import type { MockResponder } from '@kathix/models';
import type { PromptTemplate } from './template';
import { canonExtract } from './templates/canon';
import { coach, cowrite } from './templates/cowrite';
import { continuityCheck } from './templates/continuity';
import { forgeGenerate, forgeRefine } from './templates/forge';
import { draftFromOutline, showrunnerPlan } from './templates/showrunner';
import { voiceDescribe, voiceRewrite } from './templates/voice';

export * from './template';
export * from './verify';
export * from './templates/canon';
export * from './templates/cowrite';
export * from './templates/continuity';
export * from './templates/voice';
export * from './templates/forge';
export * from './templates/showrunner';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TEMPLATES: PromptTemplate<any, any>[] = [
  canonExtract,
  cowrite,
  coach,
  continuityCheck,
  voiceDescribe,
  voiceRewrite,
  forgeGenerate,
  forgeRefine,
  showrunnerPlan,
  draftFromOutline,
];

/** Deterministic responders for the test provider, one per template. */
export const mockResponders: Record<string, MockResponder> = Object.fromEntries(
  TEMPLATES.map((t) => [t.id, (input: unknown) => t.mock(input)]),
);
