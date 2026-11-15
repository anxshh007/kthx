export interface TextSpan {
  text: string;
  start: number;
  end: number;
}

const QUOTE_MAP: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '—': '-',
  '–': '-',
  '…': '...',
};

/**
 * Normalises typography and whitespace while keeping a map from every
 * normalised character back to its offset in the original string.
 */
function normalizeWithMap(input: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let lastSpace = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;
    if (/\s/.test(ch)) {
      if (!lastSpace && text.length > 0) {
        text += ' ';
        map.push(i);
      }
      lastSpace = true;
      continue;
    }
    lastSpace = false;
    const rep = QUOTE_MAP[ch] ?? ch;
    for (const r of rep) {
      text += r.toLowerCase();
      map.push(i);
    }
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}

/**
 * Finds `quote` inside `source`. Exact match first; then a match that only
 * differs in whitespace, letter case or typographic quotes/dashes.
 * Returns offsets into the original source, or null when the quote is not there.
 */
export function locateQuote(
  source: string,
  quote: string,
  fromIndex = 0,
): { start: number; end: number } | null {
  const q = quote.trim();
  if (q.length < 3) return null;
  const exact = source.indexOf(q, fromIndex);
  if (exact >= 0) return { start: exact, end: exact + q.length };
  const src = normalizeWithMap(source);
  const nq = normalizeWithMap(q).text;
  if (!nq) return null;
  let searchFrom = 0;
  if (fromIndex > 0) {
    searchFrom = src.map.findIndex((m) => m >= fromIndex);
    if (searchFrom < 0) return null;
  }
  const idx = src.text.indexOf(nq, searchFrom);
  if (idx < 0) return null;
  const start = src.map[idx] as number;
  const endChar = src.map[idx + nq.length - 1] as number;
  return { start, end: endChar + 1 };
}

export function splitSentences(text: string): TextSpan[] {
  const out: TextSpan[] = [];
  const re = /[^.!?\n]+(?:[.!?]+["')\]”’]*|\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const start = m.index + lead;
    out.push({ text: trimmed, start, end: start + trimmed.length });
  }
  return out;
}

export function splitParagraphs(text: string): TextSpan[] {
  const out: TextSpan[] = [];
  const re = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const trimmed = m[0].trim();
    if (!trimmed) continue;
    const start = m.index + (m[0].length - m[0].trimStart().length);
    out.push({ text: trimmed, start, end: start + trimmed.length });
  }
  return out;
}

export function words(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) ?? [];
}

export function wordCount(text: string): number {
  return words(text).length;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(
        Math.min(
          (prev[j] as number) + 1,
          (cur[j - 1] as number) + 1,
          (prev[j - 1] as number) + cost,
        ),
      );
    }
    prev = cur;
  }
  return prev[b.length] as number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateWords(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

export function shortId(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 14);
}
