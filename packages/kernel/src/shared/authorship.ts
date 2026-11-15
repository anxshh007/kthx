import type { Origin } from './types';

/** Run-length authorship: consecutive characters with the same origin. */
export interface AuthorSpan {
  len: number;
  origin: Origin;
}

export interface AuthorRange {
  start: number;
  end: number;
  origin: Origin;
}

export function spanLength(spans: AuthorSpan[]): number {
  return spans.reduce((n, s) => n + s.len, 0);
}

export function compactSpans(spans: AuthorSpan[]): AuthorSpan[] {
  const out: AuthorSpan[] = [];
  for (const s of spans) {
    if (s.len <= 0) continue;
    const last = out[out.length - 1];
    if (last && last.origin === s.origin) last.len += s.len;
    else out.push({ len: s.len, origin: s.origin });
  }
  return out;
}

/** Ensures spans cover exactly `textLength` characters; extra text is attributed to the creator. */
export function fitSpans(spans: AuthorSpan[] | null | undefined, textLength: number): AuthorSpan[] {
  const out: AuthorSpan[] = [];
  let used = 0;
  for (const s of spans ?? []) {
    if (used >= textLength) break;
    const len = Math.min(s.len, textLength - used);
    out.push({ len, origin: s.origin });
    used += len;
  }
  if (used < textLength) out.push({ len: textLength - used, origin: 'human' });
  return compactSpans(out);
}

/**
 * Replaces characters [from, to) with `insertLen` characters of `origin`.
 * Text outside the change keeps its origin.
 */
export function applyAuthorChange(
  spans: AuthorSpan[],
  from: number,
  to: number,
  insertLen: number,
  origin: Origin,
): AuthorSpan[] {
  const before: AuthorSpan[] = [];
  const after: AuthorSpan[] = [];
  let pos = 0;
  for (const s of spans) {
    const start = pos;
    const end = pos + s.len;
    pos = end;
    if (start < from) before.push({ len: Math.min(end, from) - start, origin: s.origin });
    if (end > to) after.push({ len: end - Math.max(start, to), origin: s.origin });
  }
  return compactSpans([...before, { len: insertLen, origin }, ...after]);
}

export function spansToRanges(spans: AuthorSpan[]): AuthorRange[] {
  const out: AuthorRange[] = [];
  let pos = 0;
  for (const s of spans) {
    out.push({ start: pos, end: pos + s.len, origin: s.origin });
    pos += s.len;
  }
  return out;
}

export interface AuthorshipShare {
  total: number;
  human: number;
  ai: number;
  aiEdited: number;
  humanPercent: number;
}

/** Character-level share; whitespace counts like any other character. */
export function authorshipShare(spans: AuthorSpan[]): AuthorshipShare {
  let human = 0;
  let ai = 0;
  let aiEdited = 0;
  for (const s of spans) {
    if (s.origin === 'human') human += s.len;
    else if (s.origin === 'ai') ai += s.len;
    else aiEdited += s.len;
  }
  const total = human + ai + aiEdited;
  return {
    total,
    human,
    ai,
    aiEdited,
    humanPercent: total === 0 ? 100 : Math.round((human / total) * 1000) / 10,
  };
}
