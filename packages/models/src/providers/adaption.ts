import { httpJson, readSse } from '../http';
import type { CompletionRequest, CompletionResult, ModelInfo, ProviderAdapter } from '../types';

export const DEFAULT_ADAPTION_URL = 'https://api.prod.adaptionlabs.ai';

interface AdaptionResponse {
  output_text?: string;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  status?: string;
  error?: { message?: string } | null;
}

function textOf(r: AdaptionResponse): string {
  if (typeof r.output_text === 'string') return r.output_text;
  return (r.output ?? [])
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
}

/**
 * Adaption custom-model adapter (Responses API, `POST /api/v1/responses`).
 * Streaming event names are parsed defensively; if a stream yields no text the
 * adapter repeats the call without streaming and reads `output_text`.
 */
export class AdaptionAdapter implements ProviderAdapter {
  readonly kind = 'adaption' as const;
  private baseUrl: string;

  constructor(
    private id: string,
    private apiKey: string,
    baseUrl?: string,
  ) {
    this.baseUrl = (baseUrl || DEFAULT_ADAPTION_URL).replace(/\/+$/, '');
  }

  private headers() {
    return { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await httpJson(this.id, `${this.baseUrl}/api/v1/models`, {
      headers: this.headers(),
      signal,
    });
    const body = (await res.json()) as {
      data?: { id: string; display_name?: string; created?: number }[];
    };
    return (body.data ?? []).map((m) => ({
      id: m.id,
      label: m.display_name || m.id,
      created: m.created ? m.created * 1000 : undefined,
      kind: 'chat' as const,
    }));
  }

  private body(req: CompletionRequest, stream: boolean) {
    const instructions = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    return JSON.stringify({
      model: req.model,
      ...(instructions ? { instructions } : {}),
      input: req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content })),
      max_output_tokens: req.maxTokens,
      temperature: req.temperature,
      stream,
    });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await httpJson(this.id, `${this.baseUrl}/api/v1/responses`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(req, true),
      signal: req.signal,
    });
    let text = '';
    let final: AdaptionResponse | null = null;
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/event-stream')) {
      for await (const { event, data } of readSse(res)) {
        if (data === '[DONE]') break;
        let parsed: { type?: string; delta?: unknown; response?: AdaptionResponse };
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        const kind = parsed.type ?? event;
        if (kind.endsWith('output_text.delta') && typeof parsed.delta === 'string') {
          text += parsed.delta;
          req.onDelta?.(parsed.delta);
        } else if (kind.endsWith('completed') && parsed.response) {
          final = parsed.response;
        }
      }
    } else {
      final = (await res.json()) as AdaptionResponse;
    }
    if (!text && final) {
      text = textOf(final);
      if (text) req.onDelta?.(text);
    }
    if (!text) {
      const again = await httpJson(this.id, `${this.baseUrl}/api/v1/responses`, {
        method: 'POST',
        headers: this.headers(),
        body: this.body(req, false),
        signal: req.signal,
      });
      final = (await again.json()) as AdaptionResponse;
      text = textOf(final);
      if (text) req.onDelta?.(text);
    }
    return {
      text,
      inputTokens: final?.usage?.input_tokens ?? 0,
      outputTokens: final?.usage?.output_tokens ?? Math.ceil(text.length / 4),
    };
  }
}
