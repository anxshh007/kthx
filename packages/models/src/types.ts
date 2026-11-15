export type Tier = 'fast' | 'balanced' | 'deep';
export type Priority = 'interactive' | 'background';

export type ProviderKind =
  'anthropic' | 'openai' | 'gemini' | 'openai-compatible' | 'ollama' | 'adaption' | 'mock';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  tier: Tier;
  /** JSON schema for a structured answer; `native` uses the provider's own mode. */
  json?: { schema: Record<string, unknown>; native: boolean };
  signal: AbortSignal;
  onDelta?: (text: string) => void;
  /** Passed to the mock provider so it can answer deterministically in tests. */
  meta?: { templateId: string; input: unknown };
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  created?: number;
  kind: 'chat' | 'embedding';
}

export interface ProviderAdapter {
  readonly kind: ProviderKind;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  embed?(texts: string[], model: string, signal?: AbortSignal): Promise<number[][]>;
}

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl?: string;
  enabled: boolean;
  /** Requests per minute this provider may receive from Kathix. */
  rpm: number;
  /** Where the key comes from: an environment variable or the encrypted settings file. */
  keySource: 'env' | 'secret' | 'none';
  envVar?: string;
}

export interface TierTarget {
  providerId: string;
  model: string;
}

export type TierMap = Record<Tier, TierTarget[]>;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}

export class ProviderDisabledError extends Error {
  constructor(providerId: string) {
    super(`Provider ${providerId} was turned off`);
  }
}
