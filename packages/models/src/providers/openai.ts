import { httpJson, readSse } from '../http';
import type { CompletionRequest, CompletionResult, ModelInfo, ProviderAdapter } from '../types';

const NON_CHAT =
  /(embed|whisper|tts|dall-e|moderation|image|audio|realtime|transcribe|search|davinci|babbage|computer-use|sora)/i;

/** OpenAI and any OpenAI-compatible Chat Completions endpoint. */
export class OpenAIAdapter implements ProviderAdapter {
  readonly kind: 'openai' | 'openai-compatible';

  constructor(
    private id: string,
    private apiKey: string,
    private baseUrl: string,
    official: boolean,
  ) {
    this.kind = official ? 'openai' : 'openai-compatible';
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await httpJson(this.id, `${this.baseUrl}/models`, {
      headers: this.headers(),
      signal,
    });
    const body = (await res.json()) as { data?: { id: string; created?: number }[] };
    return (body.data ?? [])
      .map((m) => ({
        id: m.id,
        label: m.id,
        created: m.created ? m.created * 1000 : undefined,
        kind: /embed/i.test(m.id) ? ('embedding' as const) : ('chat' as const),
      }))
      .filter((m) => m.kind === 'embedding' || !NON_CHAT.test(m.id));
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const official = this.kind === 'openai';
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
      stream_options: { include_usage: true },
      [official ? 'max_completion_tokens' : 'max_tokens']: req.maxTokens,
    };
    if (!official) body.temperature = req.temperature;
    if (req.json?.native) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'output', schema: req.json.schema, strict: false },
      };
    } else if (req.json && official) {
      body.response_format = { type: 'json_object' };
    }
    const res = await httpJson(this.id, `${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: req.signal,
    });
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const { data } of readSse(res)) {
      if (data === '[DONE]') break;
      const chunk = JSON.parse(data) as {
        choices?: { delta?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      };
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        req.onDelta?.(delta);
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
    }
    return { text, inputTokens, outputTokens: outputTokens || Math.ceil(text.length / 4) };
  }

  async embed(texts: string[], model: string, signal?: AbortSignal): Promise<number[][]> {
    const res = await httpJson(this.id, `${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model, input: texts }),
      signal,
    });
    const body = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
