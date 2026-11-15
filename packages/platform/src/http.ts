import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { z } from 'zod';
import type { Capability } from '@kathix/kernel';
import type { Project } from '@kathix/store';
import type { ModuleContext } from './context';

/** An error whose message is safe and helpful to show the creator as-is. */
export class UserError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 503 = 400,
  ) {
    super(message);
  }
}

const CAP_MESSAGES: Record<Capability, string> = {
  'model.text': 'No writing model is connected right now. Open Model Router to reconnect one.',
  'model.structured':
    'The connected model cannot return structured answers right now. Try again in a moment.',
  'model.embeddings': 'Meaning-based search is not available right now.',
  'model.custom.adaption': 'Your Adaption voice model is not reachable right now.',
  'model.local': 'The local model runtime is not answering.',
  'store.ready': 'Your library could not be opened. Restart Kathix.',
};

export function requireCaps(ctx: ModuleContext, caps: Capability[]): void {
  for (const c of caps) if (!ctx.capabilities.has(c)) throw new UserError(CAP_MESSAGES[c], 503);
}

export async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new UserError('The request could not be read.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new UserError(
      first
        ? `Please check ${first.path.join('.') || 'the input'}: ${first.message}`
        : 'Some input is missing.',
    );
  }
  return parsed.data;
}

/** The project named by id, or the hidden Scratchpad when none is open (standalone mode). */
export function projectOrScratch(
  ctx: ModuleContext,
  projectId: string | null | undefined,
): Project {
  if (projectId) {
    const p = ctx.store.getProject(projectId);
    if (!p) throw new UserError('That project could not be found.', 404);
    return p;
  }
  return ctx.store.scratchProject();
}

export function plainError(err: unknown): { message: string; status: number } {
  if (err instanceof UserError) return { message: err.message, status: err.status };
  const msg = err instanceof Error ? err.message : String(err);
  if (
    err instanceof Error &&
    ['RouterError', 'TemplateError', 'EditError'].includes(err.constructor.name)
  ) {
    return { message: msg, status: 503 };
  }
  return { message: 'Something went wrong on our side. Please try again.', status: 500 };
}

export type Send = (event: string, data: unknown) => Promise<void>;

/** Streams a long-running action as server-sent events: `delta`, `reset`, `result`, `error`. */
export function sse(c: Context, run: (send: Send, signal: AbortSignal) => Promise<unknown>) {
  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    stream.onAbort(() => controller.abort());
    const send: Send = (event, data) => stream.writeSSE({ event, data: JSON.stringify(data) });
    try {
      const result = await run(send, controller.signal);
      await send('result', result ?? null);
    } catch (err) {
      if (!controller.signal.aborted) await send('error', { message: plainError(err).message });
    }
  });
}
