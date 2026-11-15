import { httpJson, readNdjson } from '../http';
import type { CompletionRequest, CompletionResult, ModelInfo, ProviderAdapter } from '../types';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

/** Local model runtime (Ollama). */
export class OllamaAdapter implements ProviderAdapter {
  readonly kind = 'ollama' as const;
  private baseUrl: string;

  constructor(
    private id: string,
    baseUrl?: string,
  ) {
    this.baseUrl = (baseUrl || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await httpJson(this.id, `${this.baseUrl}/api/tags`, { signal });
    const body = (await res.json()) as { models?: { name: string; modified_at?: string }[] };
    return (body.models ?? []).map((m) => ({
      id: m.name,
      label: m.name,
      created: m.modified_at ? Date.parse(m.modified_at) : undefined,
      kind: /embed/i.test(m.name) ? ('embedding' as const) : ('chat' as const),
    }));
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
      options: { temperature: req.temperature, num_predict: req.maxTokens },
    };
    if (req.json) body.format = req.json.native ? req.json.schema : 'json';
    const res = await httpJson(this.id, `${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const raw of readNdjson(res)) {
      const chunk = raw as {
        message?: { content?: string };
        done?: boolean;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const delta = chunk.message?.content;
      if (delta) {
        text += delta;
        req.onDelta?.(delta);
      }
      if (chunk.done) {
        inputTokens = chunk.prompt_eval_count ?? 0;
        outputTokens = chunk.eval_count ?? 0;
      }
    }
    return { text, inputTokens, outputTokens };
  }

  async embed(texts: string[], model: string, signal?: AbortSignal): Promise<number[][]> {
    const res = await httpJson(this.id, `${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
      signal,
    });
    const body = (await res.json()) as { embeddings: number[][] };
    return body.embeddings;
  }
}
