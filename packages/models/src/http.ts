import { ProviderError } from './types';

/** Reads a server-sent-events body, yielding `{event, data}` per message. */
export async function* readSse(
  res: Response,
): AsyncGenerator<{ event: string; data: string }, void, unknown> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '');
      let event = 'message';
      const data: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length) yield { event, data: data.join('\n') };
    }
  }
}

/** Reads newline-delimited JSON. */
export async function* readNdjson(res: Response): AsyncGenerator<unknown, void, unknown> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer.trim());
}

export async function httpJson(
  providerId: string,
  url: string,
  init: RequestInit & { signal?: AbortSignal },
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (init.signal?.aborted) throw err;
    throw new ProviderError(
      `Could not reach ${providerId}: ${err instanceof Error ? err.message : String(err)}`,
      providerId,
      true,
    );
  }
  if (!res.ok) {
    let detail: string;
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      detail = '';
    }
    throw new ProviderError(
      `${providerId} answered ${res.status}${detail ? `: ${detail}` : ''}`,
      providerId,
      res.status === 429 || res.status >= 500 || res.status === 408,
      res.status,
    );
  }
  return res;
}
