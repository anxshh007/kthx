import type { Command } from 'commander';
import type { Hono } from 'hono';
import type {
  Capability,
  CapabilityRegistry,
  EventBus,
  JobQueue,
  KathixConfig,
  KathixEvents,
  Logger,
  ModuleManifest,
  SecretStore,
} from '@kathix/kernel';
import type { ModelRouter } from '@kathix/models';
import type { ShowrunnerRun, Store } from '@kathix/store';

export interface AgentStepContext {
  run: ShowrunnerRun;
  projectId: string;
  scriptId: string;
  goal: string;
  outline: string;
  /** The script text as it stands after every approved step so far. */
  workingText: string;
  /** Creator's note when they asked to redo this step. */
  note: string;
  signal: AbortSignal;
  /** Shows the creator what the agent is reading right now. */
  reading(what: string): void;
  addTokens(n: number): void;
}

export interface AgentStepResult {
  summary: string;
  /** Full replacement script text, applied only when the creator approves. */
  proposedText: string | null;
  details: unknown;
}

/** A pipeline step a module offers to the Showrunner agent. */
export interface AgentStep {
  id: string;
  label: string;
  description: string;
  order: number;
  requires: Capability[];
  run(ctx: AgentStepContext): Promise<AgentStepResult>;
}

/** Public contracts modules may offer each other through the context. */
export interface VoiceApi {
  activeProfileId(projectId: string): string | null;
  promptSummary(profileId: string): string | null;
  matchScore(profileId: string, text: string): number | null;
}

export interface CanonApi {
  /** Imports a structured story bible (no model needed); optionally approves every proposal. */
  importBible(
    projectId: string,
    title: string,
    text: string,
    opts: { approve: boolean },
  ): { proposals: number; approved: number };
}

export interface VoiceProfilesApi extends VoiceApi {
  createProfileWithSamples(
    projectId: string,
    name: string,
    samples: { title: string; text: string }[],
    confirmedOwn: boolean,
  ): Promise<string>;
}

export interface ModuleContext {
  config: KathixConfig;
  store: Store;
  secrets: SecretStore;
  router: ModelRouter;
  capabilities: CapabilityRegistry;
  jobs: JobQueue;
  events: EventBus<KathixEvents>;
  logger: Logger;
  agentSteps: Map<string, AgentStep>;
  provide<T>(name: string, api: T): void;
  use<T>(name: string): T | undefined;
}

export interface ServerModule<S = unknown> {
  manifest: ModuleManifest;
  createService(ctx: ModuleContext): S;
  /** Routes are mounted at /api/m/<module id>. */
  routes?(app: Hono, service: S, ctx: ModuleContext): void;
  agentSteps?(service: S, ctx: ModuleContext): AgentStep[];
}

export interface CliModule {
  register(program: Command, getContext: () => Promise<ModuleContext>): void;
}
