import { locateQuote, type EvidenceRef } from '@kathix/kernel/shared';

export interface EvidenceSource {
  id: string;
  kind: EvidenceRef['sourceKind'];
  label: string;
  text: string;
  /** Offset of `text` inside the original document, so evidence points at the real place. */
  offset?: number;
}

/**
 * Keeps only evidence whose quote really exists in the named source, and
 * returns the exact original span. Anything unverified is dropped before the
 * creator sees it.
 */
export function verifyEvidence(
  items: { sourceId: string; quote: string }[],
  sources: EvidenceSource[],
): EvidenceRef[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out: EvidenceRef[] = [];
  for (const item of items) {
    const src = byId.get(item.sourceId);
    if (!src) continue;
    const loc = locateQuote(src.text, item.quote);
    if (!loc) continue;
    const off = src.offset ?? 0;
    if (out.some((e) => e.sourceId === src.id && e.start === loc.start + off)) continue;
    out.push({
      sourceKind: src.kind,
      sourceId: src.id,
      label: src.label,
      quote: src.text.slice(loc.start, loc.end),
      start: loc.start + off,
      end: loc.end + off,
    });
  }
  return out;
}

/** Locates one quote; returns the verbatim original text and offsets, or null. */
export function verifyQuote(
  text: string,
  quote: string,
): { quote: string; start: number; end: number } | null {
  const loc = locateQuote(text, quote);
  return loc ? { quote: text.slice(loc.start, loc.end), start: loc.start, end: loc.end } : null;
}
