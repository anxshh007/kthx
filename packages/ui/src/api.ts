export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Kathix could not reach its server. Check that it is still running.', 0);
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg =
      (data as { error?: string } | null)?.error ?? 'Something went wrong. Please try again.';
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T>(url: string, body: unknown = {}) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export interface StreamHandlers {
  onDelta?: (text: string) => void;
  onReset?: () => void;
  onEvent?: (event: string, data: unknown) => void;
  signal?: AbortSignal;
}

/** POSTs and reads a server-sent-events answer; resolves with the `result` event. */
export async function streamPost<R>(
  url: string,
  body: unknown,
  h: StreamHandlers = {},
): Promise<R> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: h.signal,
    });
  } catch (err) {
    if (h.signal?.aborted) throw err;
    throw new ApiError('Kathix could not reach its server. Check that it is still running.', 0);
  }
  if (!res.ok || !res.body) {
    let msg = 'Something went wrong. Please try again.';
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      // keep default
    }
    throw new ApiError(msg, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trimStart();
      }
      const parsed: unknown = data ? JSON.parse(data) : null;
      if (event === 'delta') h.onDelta?.((parsed as { text: string }).text);
      else if (event === 'reset') h.onReset?.();
      else if (event === 'error') throw new ApiError((parsed as { message: string }).message, 500);
      else if (event === 'result') return parsed as R;
      else h.onEvent?.(event, parsed);
    }
  }
  throw new ApiError('The answer was cut off. Please try again.', 0);
}

/** Reads a File as text (plain files) or base64 (docx, pdf) for upload. */
export async function readUpload(
  file: File,
): Promise<{ name: string; text?: string; base64?: string }> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.fountain')) {
    return { name: file.name, text: await file.text() };
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000)
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { name: file.name, base64: btoa(bin) };
}

export function download(filename: string, content: string | Blob, type = 'text/plain'): void {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadFrom(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = 'The export could not be made.';
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      // keep default
    }
    throw new ApiError(msg, res.status);
  }
  download(filename, await res.blob());
}
