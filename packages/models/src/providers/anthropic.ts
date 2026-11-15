import Anthropic from '@anthropic-ai/sdk';
import type { CompletionRequest, CompletionResult, ModelInfo, ProviderAdapter } from '../types';
import { ProviderError } from '../types';

const EFFORT = { fast: 'low', balanced: 'medium', deep: 'high' } as const;

export class AnthropicAdapter implements ProviderAdapter {
  readonly kind = 'anthropic' as const;
  private client: Anthropic;
  private effortUnsupported = new Set<string>();

  constructor(
    private id: string,
    apiKey: string,
    baseUrl?: string,
  ) {
    // Key and base URL are always explicit so ambient shell variables never leak in.
    this.client = new Anthropic({
      apiKey,
      baseURL: baseUrl || 'https://api.anthropic.com',
      maxRetries: 0,
    });
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    try {
      for await (const m of this.client.models.list({ limit: 100 }, { signal })) {
        out.push({
          id: m.id,
          label: m.display_name || m.id,
          created: Date.parse(m.created_at) || undefined,
          kind: 'chat',
        });
      }
    } catch (err) {
      throw this.wrap(err);
    }
    return out;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    const outputConfig: Anthropic.OutputConfig = {};
    if (!this.effortUnsupported.has(req.model)) outputConfig.effort = EFFORT[req.tier];
    if (req.json?.native) outputConfig.format = { type: 'json_schema', schema: req.json.schema };
    try {
      const stream = this.client.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          ...(system ? { system } : {}),
          messages,
          ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
        },
        { signal: req.signal },
      );
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          req.onDelta?.(event.delta.text);
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') {
        throw new ProviderError('The model declined this request', this.id, false);
      }
      const text = final.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      return {
        text,
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
      };
    } catch (err) {
      if (
        err instanceof Anthropic.BadRequestError &&
        /effort/i.test(err.message) &&
        !this.effortUnsupported.has(req.model)
      ) {
        this.effortUnsupported.add(req.model);
        return this.complete(req);
      }
      throw this.wrap(err);
    }
  }

  private wrap(err: unknown): Error {
    if (err instanceof ProviderError) return err;
    if (err instanceof Anthropic.APIUserAbortError) return err;
    if (err instanceof Anthropic.APIError) {
      const status = typeof err.status === 'number' ? err.status : undefined;
      return new ProviderError(
        `Anthropic answered ${status ?? 'with an error'}: ${err.message}`,
        this.id,
        status === undefined || status === 429 || status >= 500,
        status,
      );
    }
    return new ProviderError(err instanceof Error ? err.message : String(err), this.id, true);
  }
}
