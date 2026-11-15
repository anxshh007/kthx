import type { CompletionRequest, CompletionResult, ModelInfo, ProviderAdapter } from '../types';
import { ProviderError } from '../types';

export type MockResponder = (input: unknown) => unknown;

/** Deterministic hashed bag-of-words vectors: similar texts get similar vectors. */
export function mockEmbedding(text: string, dims = 64): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[Math.abs(h) % dims]! += 1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

/**
 * Test-only provider. Answers come from each prompt template's own
 * deterministic responder, so tests exercise the real parsing, verification
 * and UI paths without a network. Enabled only by KATHIX_MOCK_PROVIDER=1.
 */
export class MockAdapter implements ProviderAdapter {
  readonly kind = 'mock' as const;
  latencyMs = 0;
  failWith: string | null = null;

  constructor(
    private id: string,
    private responders: Record<string, MockResponder>,
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: 'mock-small', label: 'Mock small', kind: 'chat' },
      { id: 'mock-standard', label: 'Mock standard', kind: 'chat' },
      { id: 'mock-large', label: 'Mock large', kind: 'chat' },
      { id: 'mock-embed', label: 'Mock embeddings', kind: 'embedding' },
    ];
  }

  private async wait(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
        },
        { once: true },
      );
    });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (this.failWith) throw new ProviderError(this.failWith, this.id, true, 503);
    let text: string;
    const responder = req.meta ? this.responders[req.meta.templateId] : undefined;
    if (responder) {
      const out = responder(req.meta?.input);
      text = typeof out === 'string' ? out : JSON.stringify(out);
    } else {
      text = req.json ? '{"ok":true}' : 'OK';
    }
    const pieces = text.match(/[\s\S]{1,40}/g) ?? [''];
    const per = this.latencyMs / Math.max(1, pieces.length);
    for (const p of pieces) {
      if (req.signal.aborted)
        throw req.signal.reason instanceof Error ? req.signal.reason : new Error('Aborted');
      await this.wait(per, req.signal);
      req.onDelta?.(p);
    }
    const promptChars = req.messages.reduce((n, m) => n + m.content.length, 0);
    return {
      text,
      inputTokens: Math.ceil(promptChars / 4),
      outputTokens: Math.ceil(text.length / 4),
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => mockEmbedding(t));
  }
}
