import { diffChars } from 'diff';
import { applyAuthorChange, fitSpans, type AuthorSpan, type Origin } from '@kathix/kernel/shared';
import type { LedgerEvent, ScriptVersion } from '@kathix/store';
import { indexScript } from '@kathix/retrieval';
import type { ModuleContext } from './context';

export function recordLedger(
  ctx: ModuleContext,
  e: Omit<LedgerEvent, 'id' | 'createdAt' | 'provider' | 'model' | 'detail'> &
    Partial<Pick<LedgerEvent, 'provider' | 'model' | 'detail'>>,
): LedgerEvent {
  const ev = ctx.store.addLedger({ provider: '', model: '', detail: {}, ...e });
  ctx.events.emit('ledger.event', { projectId: ev.projectId, kind: ev.kind });
  return ev;
}

export class EditError extends Error {}

/** Saves a full script text with its authorship spans; reindexes for retrieval. */
export function saveScriptText(
  ctx: ModuleContext,
  input: {
    scriptId: string;
    text: string;
    authorship: AuthorSpan[] | null;
    source: ScriptVersion['source'];
    note?: string;
  },
): ScriptVersion {
  const script = ctx.store.getScript(input.scriptId);
  if (!script) throw new EditError('That script no longer exists.');
  const before = ctx.store.currentVersion(input.scriptId);
  const version = ctx.store.saveVersion(
    input.scriptId,
    input.text,
    input.authorship,
    input.source,
    input.note ?? '',
  );
  if (!before || before.id !== version.id) {
    indexScript(ctx.store, script, input.text);
    ctx.store.touchProject(script.projectId);
    ctx.events.emit('script.saved', {
      projectId: script.projectId,
      scriptId: script.id,
      versionId: version.id,
    });
  }
  return version;
}

/** Replaces characters [from, to) of the current text, attributing the new text to `origin`. */
export function replaceRange(
  ctx: ModuleContext,
  input: {
    scriptId: string;
    from: number;
    to: number;
    text: string;
    origin: Origin;
    source: ScriptVersion['source'];
    note?: string;
    expected?: string;
  },
): ScriptVersion {
  const cur = ctx.store.currentVersion(input.scriptId);
  if (!cur) throw new EditError('That script no longer exists.');
  if (input.from < 0 || input.to > cur.text.length || input.from > input.to) {
    throw new EditError('The script changed since this was suggested. Please ask again.');
  }
  if (input.expected !== undefined && cur.text.slice(input.from, input.to) !== input.expected) {
    throw new EditError('That passage has changed since this was suggested. Please ask again.');
  }
  const text = cur.text.slice(0, input.from) + input.text + cur.text.slice(input.to);
  const spans = applyAuthorChange(
    fitSpans(cur.authorship, cur.text.length),
    input.from,
    input.to,
    input.text.length,
    input.origin,
  );
  return saveScriptText(ctx, {
    scriptId: input.scriptId,
    text,
    authorship: spans,
    source: input.source,
    note: input.note,
  });
}

/** Maps authorship across an arbitrary rewrite: unchanged characters keep their origin. */
export function authorshipAfterRewrite(
  spans: AuthorSpan[],
  oldText: string,
  newText: string,
  origin: Origin,
): AuthorSpan[] {
  let cur = fitSpans(spans, oldText.length);
  let pos = 0;
  for (const part of diffChars(oldText, newText)) {
    const len = part.value.length;
    if (part.added) {
      cur = applyAuthorChange(cur, pos, pos, len, origin);
      pos += len;
    } else if (part.removed) {
      cur = applyAuthorChange(cur, pos, pos + len, 0, origin);
    } else {
      pos += len;
    }
  }
  return fitSpans(cur, newText.length);
}

export function replaceWholeText(
  ctx: ModuleContext,
  input: {
    scriptId: string;
    text: string;
    origin: Origin;
    source: ScriptVersion['source'];
    note?: string;
  },
): ScriptVersion {
  const cur = ctx.store.currentVersion(input.scriptId);
  if (!cur) throw new EditError('That script no longer exists.');
  const spans = authorshipAfterRewrite(cur.authorship, cur.text, input.text, input.origin);
  return saveScriptText(ctx, {
    scriptId: input.scriptId,
    text: input.text,
    authorship: spans,
    source: input.source,
    note: input.note,
  });
}

/** Finds a quote in the current text; returns its range, or null if it is no longer there. */
export function findInScript(
  ctx: ModuleContext,
  scriptId: string,
  quote: string,
  near = 0,
): { from: number; to: number } | null {
  const cur = ctx.store.currentVersion(scriptId);
  if (!cur || !quote) return null;
  let best = -1;
  let idx = cur.text.indexOf(quote);
  while (idx >= 0) {
    if (best < 0 || Math.abs(idx - near) < Math.abs(best - near)) best = idx;
    idx = cur.text.indexOf(quote, idx + 1);
  }
  return best >= 0 ? { from: best, to: best + quote.length } : null;
}
