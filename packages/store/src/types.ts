import type { AuthorSpan, CanonType, EvidenceRef, ProjectType } from '@kathix/kernel/shared';

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  archived: boolean;
  isSample: boolean;
  isScratch: boolean;
  settings: ProjectSettings;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSettings {
  continuityOnSave?: boolean;
  activeVoiceProfileId?: string | null;
  voiceConditioning?: boolean;
  useAdaptionWriter?: boolean;
}

export interface Script {
  id: string;
  projectId: string;
  title: string;
  episode: number | null;
  currentVersionId: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptVersion {
  id: string;
  scriptId: string;
  seq: number;
  text: string;
  authorship: AuthorSpan[];
  source: 'edit' | 'suggestion' | 'restore' | 'import' | 'agent' | 'fix';
  note: string;
  createdAt: string;
}

export interface SourceDoc {
  id: string;
  projectId: string;
  title: string;
  text: string;
  createdAt: string;
}

export interface CanonEntry {
  id: string;
  projectId: string;
  type: CanonType;
  name: string;
  aliases: string[];
  summary: string;
  attributes: Record<string, string>;
  sourceDocId: string | null;
  sourceQuote: string;
  sourceStart: number | null;
  sourceEnd: number | null;
  timelineOrder: number | null;
  timelineLabel: string;
  plantedIn: string;
  status: 'active' | 'paid';
  createdAt: string;
  updatedAt: string;
}

export interface CanonLink {
  id: string;
  projectId: string;
  fromId: string;
  toId: string;
  relation: string;
  createdAt: string;
}

export interface CanonProposal {
  id: string;
  projectId: string;
  jobId: string | null;
  type: CanonType;
  name: string;
  summary: string;
  attributes: Record<string, string>;
  aliases: string[];
  related: { name: string; relation: string }[];
  sourceDocId: string;
  quote: string;
  start: number;
  end: number;
  timelineOrder: number | null;
  timelineLabel: string;
  status: 'pending' | 'approved' | 'rejected' | 'merged';
  targetEntryId: string | null;
  matchEntryId: string | null;
  createdAt: string;
}

export type IssueType =
  | 'contradicted_fact'
  | 'character_trait'
  | 'timeline'
  | 'name_drift'
  | 'world_rule'
  | 'forgotten_promise';

export interface ContinuityIssue {
  id: string;
  projectId: string;
  scriptId: string | null;
  runId: string;
  type: IssueType;
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  summary: string;
  draftQuote: string;
  draftStart: number;
  draftEnd: number;
  refKind: 'canon' | 'script' | 'reference';
  refId: string;
  refLabel: string;
  refQuote: string;
  fixText: string;
  fixReason: string;
  status: 'open' | 'fixed' | 'intentional' | 'canon_updated';
  fingerprint: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface VoiceProfile {
  id: string;
  projectId: string;
  name: string;
  metrics: unknown;
  description: string;
  traits: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VoiceSample {
  id: string;
  profileId: string;
  title: string;
  text: string;
  confirmedOwn: boolean;
  createdAt: string;
}

export interface Suggestion {
  id: string;
  projectId: string | null;
  scriptId: string | null;
  module: string;
  action: string;
  provider: string;
  model: string;
  originalText: string;
  proposedText: string;
  rangeStart: number;
  rangeEnd: number;
  reason: string;
  evidence: EvidenceRef[];
  status: 'offered' | 'accepted' | 'edited' | 'rejected';
  rejectReason: string;
  finalText: string;
  createdAt: string;
  decidedAt: string | null;
}

export interface LedgerEvent {
  id: string;
  projectId: string | null;
  scriptId: string | null;
  kind: string;
  module: string;
  provider: string;
  model: string;
  summary: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface UsageRecord {
  id: string;
  module: string;
  provider: string;
  model: string;
  tier: string;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  cached: boolean;
  createdAt: string;
}

export interface Chunk {
  id: string;
  projectId: string;
  sourceKind: 'script' | 'canon' | 'doc';
  sourceId: string;
  label: string;
  start: number;
  end: number;
  text: string;
  ordinal: number;
  embedding: number[] | null;
  updatedAt: string;
}

export interface ForgeItem {
  id: string;
  projectId: string;
  scriptId: string | null;
  kind: string;
  text: string;
  payload: Record<string, unknown>;
  shortlisted: boolean;
  batchId: string;
  createdAt: string;
}

export interface ShowrunnerRun {
  id: string;
  projectId: string;
  scriptId: string;
  goal: string;
  outline: string;
  status: 'planning' | 'running' | 'awaiting_approval' | 'completed' | 'stopped' | 'failed';
  stepIndex: number;
  steps: RunStep[];
  log: { at: string; message: string }[];
  workingText: string;
  tokens: number;
  templateName: string;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
}

export interface RunStep {
  stepId: string;
  label: string;
  purpose: string;
  status: 'pending' | 'running' | 'awaiting_approval' | 'approved' | 'skipped' | 'failed';
  summary: string;
  proposedText: string | null;
  details: unknown;
  note: string;
  reading: string;
  error: string | null;
}
