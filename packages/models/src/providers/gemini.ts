import { httpJson, readSse } from '../http';
import type { CompletionRequest, CompletionResult, ModelInfo, ProviderAdapter } from '../types';

export class GeminiAdapter implements ProviderAdapter {
  readonly kind = 'gemini' as const;
  private baseUrl: string;

  constructor(
    private id: string,
    private apiKey: string,
    baseUrl?: string,
  ) {
    this.baseUrl = (baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(
      /\/+$/,
      '',
    );
  }

  private headers() {
    return { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await httpJson(this.id, `${this.baseUrl}/models?pageSize=1000`, {
      headers: this.headers(),
      signal,
    });
    const body = (await res.json()) as {
      models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
    };
    const out: ModelInfo[] = [];
    for (const m of body.models ?? []) {
      const methods = m.supportedGenerationMethods ?? [];
      const id = m.name.replace(/^models\//, '');
      if (methods.includes('generateContent')) {
        out.push({ id, label: m.displayName || id, kind: 'chat' });
      } else if (methods.includes('embedContent')) {
        out.push({ id, label: m.displayName || id, kind: 'embedding' });
      }
    }
    return out.sort((a, b) => b.id.localeCompare(a.id));
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: req.maxTokens,
      temperature: req.temperature,
    };
    if (req.json) generationConfig.responseMimeType = 'application/json';
    if (req.json?.native) generationConfig.responseJsonSchema = req.json.schema;
    const body = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
      generationConfig,
    };
    const res = await httpJson(
      this.id,
      `${this.baseUrl}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`,
      { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: req.signal },
    );
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const { data } of readSse(res)) {
      const chunk = JSON.parse(data) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.text && !part.thought) {
          text += part.text;
          req.onDelta?.(part.text);
        }
      }
      if (chunk.usageMetadata) {
        inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
      }
    }
    return { text, inputTokens, outputTokens };
  }

  async embed(texts: string[], model: string, signal?: AbortSignal): Promise<number[][]> {
    const res = await httpJson(
      this.id,
      `${this.baseUrl}/models/${encodeURIComponent(model)}:batchEmbedContents`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          requests: texts.map((t) => ({
            model: `models/${model}`,
            content: { parts: [{ text: t }] },
          })),
        }),
        signal,
      },
    );
    const body = (await res.json()) as { embeddings: { values: number[] }[] };
    return body.embeddings.map((e) => e.values);
  }
}
