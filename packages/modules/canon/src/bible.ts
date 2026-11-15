import { CANON_TYPES, type CanonType } from '@kathix/kernel/shared';

export interface BibleEntry {
  type: CanonType;
  name: string;
  aliases: string[];
  summary: string;
  attributes: Record<string, string>;
  related: { name: string; relation: string }[];
  timelineLabel: string;
  timelineOrder: number | null;
  plantedIn: string;
  /** The section exactly as written, with its offsets in the document. */
  quote: string;
  start: number;
  end: number;
}

const TYPE_WORDS: Record<string, CanonType> = {
  character: 'character',
  place: 'place',
  location: 'place',
  object: 'object',
  item: 'object',
  faction: 'faction',
  group: 'faction',
  rule: 'rule',
  'world rule': 'rule',
  fact: 'fact',
  event: 'event',
  'timeline event': 'event',
  gag: 'gag',
  'running gag': 'gag',
  promise: 'promise',
  'open promise': 'promise',
};

/**
 * Parses a structured story bible: sections headed `## Type: Name`, with
 * `- Key: value` attribute lines and `Aliases:`, `Related:`, `When:` and
 * `Planted:` lines. Everything else in a section is its summary. No model needed.
 */
export function parseBible(text: string): BibleEntry[] {
  const out: BibleEntry[] = [];
  const heading = /^##\s+([^:\n]+):\s*(.+)$/gm;
  const marks: { index: number; type: string; name: string; headLen: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = heading.exec(text))) {
    marks.push({
      index: m.index,
      type: (m[1] as string).trim().toLowerCase(),
      name: (m[2] as string).trim(),
      headLen: m[0].length,
    });
  }
  marks.forEach((mark, i) => {
    const type =
      TYPE_WORDS[mark.type] ?? (CANON_TYPES as readonly string[]).find((t) => t === mark.type);
    if (!type) return;
    const end = i + 1 < marks.length ? (marks[i + 1] as { index: number }).index : text.length;
    const bodyStart = mark.index + mark.headLen;
    const body = text.slice(bodyStart, end);
    const entry: BibleEntry = {
      type: type as CanonType,
      name: mark.name,
      aliases: [],
      summary: '',
      attributes: {},
      related: [],
      timelineLabel: '',
      timelineOrder: null,
      plantedIn: '',
      quote: '',
      start: 0,
      end: 0,
    };
    const summary: string[] = [];
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const kv = /^(?:[-*]\s*)?([A-Za-z][A-Za-z ]{0,30}):\s*(.+)$/.exec(line);
      const key = kv?.[1]?.trim().toLowerCase();
      const value = kv?.[2]?.trim() ?? '';
      if (kv && key === 'aliases')
        entry.aliases = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      else if (kv && key === 'related') {
        entry.related = value
          .split(';')
          .map((r) => /^(.+?)\s*\((.+)\)\s*$/.exec(r.trim()))
          .filter((r): r is RegExpExecArray => !!r)
          .map((r) => ({ name: (r[1] as string).trim(), relation: (r[2] as string).trim() }));
      } else if (kv && key === 'when') {
        const [label, order] = value.split('|').map((s) => s.trim());
        entry.timelineLabel = label ?? '';
        entry.timelineOrder = order && !Number.isNaN(Number(order)) ? Number(order) : null;
      } else if (kv && key === 'planted') entry.plantedIn = value;
      else if (kv && raw.trimStart().match(/^[-*]/))
        entry.attributes[(kv[1] as string).trim()] = value;
      else summary.push(line);
    }
    entry.summary = summary.join(' ');
    const trimmedStart = bodyStart + (body.length - body.trimStart().length);
    entry.quote = text.slice(trimmedStart, end).trimEnd();
    entry.start = trimmedStart;
    entry.end = trimmedStart + entry.quote.length;
    if (entry.quote) out.push(entry);
  });
  return out;
}
