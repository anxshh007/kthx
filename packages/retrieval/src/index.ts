import {
  estimateTokens,
  parseScript,
  renderCanonBlock,
  splitParagraphs,
} from '@kathix/kernel/shared';
import type { ModelRouter } from '@kathix/models';
import type { CanonEntry, CanonLink, Chunk, Script, Store } from '@kathix/store';

export interface ChunkDraft {
  label: string;
  start: number;
  end: number;
  text: string;
  ordinal: number;
}

const MAX_CHUNK = 2400;

/** Scripts are chunked by scene; text without scene headings falls back to paragraph groups. */
export function chunkScript(text: string, title: string, ordinal: number): ChunkDraft[] {
  const { scenes } = parseScript(text);
  const pieces: { start: number; end: number; label: string }[] = [];
  if (scenes.length) {
    const first = scenes[0] as { start: number };
    if (first.start > 0 && text.slice(0, first.start).trim())
      pieces.push({ start: 0, end: first.start, label: `${title} · opening` });
    scenes.forEach((s, i) =>
      pieces.push({
        start: s.start,
        end: s.end,
        label: `${title} · ${s.title || `scene ${i + 1}`}`,
      }),
    );
  } else {
    let cur: { start: number; end: number } | null = null;
    for (const p of splitParagraphs(text)) {
      if (cur && p.end - cur.start > MAX_CHUNK) {
        pieces.push({ ...cur, label: `${title} · part ${pieces.length + 1}` });
        cur = null;
      }
      cur = cur ? { start: cur.start, end: p.end } : { start: p.start, end: p.end };
    }
    if (cur) pieces.push({ ...cur, label: `${title} · part ${pieces.length + 1}` });
  }
  const out: ChunkDraft[] = [];
  for (const p of pieces) {
    // Very long scenes are split further so no chunk overwhelms the budget.
    for (let s = p.start; s < p.end; s += MAX_CHUNK) {
      const e = Math.min(p.end, s + MAX_CHUNK);
      const slice = text.slice(s, e);
      if (!slice.trim()) continue;
      out.push({ label: p.label, start: s, end: e, text: slice, ordinal });
    }
  }
  return out;
}

export function indexScript(store: Store, script: Script, text: string): Chunk[] {
  return store.replaceChunks(
    script.projectId,
    'script',
    script.id,
    chunkScript(text, script.title, script.episode ?? 0),
  );
}

export function canonText(entry: CanonEntry): string {
  return renderCanonBlock(entry);
}

export function indexEntry(store: Store, entry: CanonEntry): Chunk[] {
  const text = canonText(entry);
  return store.replaceChunks(entry.projectId, 'canon', entry.id, [
    { label: entry.name, start: 0, end: text.length, text, ordinal: 0 },
  ]);
}

/** Adds embeddings to chunks that lack them, when an embedding model is available. */
export async function embedMissing(
  store: Store,
  router: ModelRouter,
  projectId: string,
  signal?: AbortSignal,
): Promise<number> {
  const missing = store.listChunks(projectId).filter((c) => !c.embedding);
  let done = 0;
  for (let i = 0; i < missing.length; i += 32) {
    const batch = missing.slice(i, i + 32);
    const res = await router.embed(
      batch.map((c) => c.text),
      signal,
    );
    if (!res) return done;
    batch.forEach((c, n) => {
      const v = res.vectors[n];
      if (v) store.setChunkEmbedding(c.id, v);
    });
    done += batch.length;
  }
  return done;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += (a[i] as number) * (b[i] as number);
    na += (a[i] as number) ** 2;
    nb += (b[i] as number) ** 2;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface RetrievedChunk extends Chunk {
  score: number;
  why: string[];
}

export interface RetrieveOptions {
  projectId: string;
  query: string;
  kinds?: Chunk['sourceKind'][];
  limit?: number;
  excludeSourceIds?: string[];
  router?: ModelRouter;
  signal?: AbortSignal;
}

/**
 * Ranks chunks with full-text search, adds embedding similarity when available,
 * then boosts by recency and by canon entries linked to characters present in the query.
 */
export async function retrieve(store: Store, opts: RetrieveOptions): Promise<RetrievedChunk[]> {
  const limit = opts.limit ?? 8;
  const exclude = new Set(opts.excludeSourceIds ?? []);
  const kinds = opts.kinds ? new Set(opts.kinds) : null;
  const keep = (c: Chunk) => !exclude.has(c.sourceId) && (!kinds || kinds.has(c.sourceKind));
  const scored = new Map<string, RetrievedChunk>();
  const fts = store.searchChunks(opts.projectId, opts.query, 60).filter(keep);
  fts.forEach((c, i) => {
    scored.set(c.id, { ...c, score: 1 / (1 + i * 0.35), why: ['matches words in the passage'] });
  });

  const all = store.listChunks(opts.projectId).filter(keep);
  if (opts.router && all.some((c) => c.embedding)) {
    const q = await opts.router.embed([opts.query.slice(0, 4000)], opts.signal);
    const qv = q?.vectors[0];
    if (qv) {
      for (const c of all) {
        if (!c.embedding) continue;
        const sim = cosine(qv, c.embedding);
        if (sim < 0.2) continue;
        const cur = scored.get(c.id);
        if (cur) {
          cur.score += sim;
          cur.why.push('similar in meaning');
        } else scored.set(c.id, { ...c, score: sim * 0.9, why: ['similar in meaning'] });
      }
    }
  }

  // Characters and places named in the query, plus entries linked to them.
  const entries = store.listEntries(opts.projectId);
  const links: CanonLink[] = store.listLinks(opts.projectId);
  const lowerQuery = opts.query.toLowerCase();
  const present = new Set(
    entries
      .filter((e) =>
        [e.name, ...e.aliases].some(
          (n) => n.length > 2 && lowerQuery.includes(n.toLowerCase().split(' ')[0] as string),
        ),
      )
      .map((e) => e.id),
  );
  const linked = new Set<string>();
  for (const l of links) {
    if (present.has(l.fromId)) linked.add(l.toId);
    if (present.has(l.toId)) linked.add(l.fromId);
  }
  const maxOrdinal = Math.max(
    1,
    ...all.filter((c) => c.sourceKind === 'script').map((c) => c.ordinal),
  );
  for (const c of all) {
    if (c.sourceKind === 'canon' && (present.has(c.sourceId) || linked.has(c.sourceId))) {
      const cur = scored.get(c.id) ?? { ...c, score: 0, why: [] };
      cur.score += present.has(c.sourceId) ? 1.2 : 0.5;
      cur.why.push(
        present.has(c.sourceId) ? 'named in this passage' : 'linked to someone in this passage',
      );
      scored.set(c.id, cur);
    }
  }
  for (const c of scored.values()) {
    if (c.sourceKind === 'script') c.score *= 1 + 0.25 * (c.ordinal / maxOrdinal);
  }
  return [...scored.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface BudgetResult<T> {
  included: T[];
  dropped: T[];
  tokens: number;
}

/**
 * Assembles context up to a per-task token limit. Whatever is included is
 * exactly what is sent, so the evidence list shown to the creator is the real context.
 */
export function budget<T extends { text: string }>(items: T[], maxTokens: number): BudgetResult<T> {
  const included: T[] = [];
  const dropped: T[] = [];
  let tokens = 0;
  for (const item of items) {
    const t = estimateTokens(item.text);
    if (tokens + t <= maxTokens) {
      included.push(item);
      tokens += t;
    } else dropped.push(item);
  }
  return { included, dropped, tokens };
}

export const TASK_BUDGETS = {
  cowrite: 6000,
  coach: 3000,
  continuity: 24000,
  draft: 8000,
} as const;
