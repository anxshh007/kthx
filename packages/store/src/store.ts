import { fitSpans, shortId, type AuthorSpan, type ProjectType } from '@kathix/kernel/shared';
import type { JobRecord, JobStatus, JobStorage } from '@kathix/kernel';
import { Db, json, now, type Row } from './db';
import { migrate } from './migrations';
import type {
  CanonEntry,
  CanonLink,
  CanonProposal,
  Chunk,
  ContinuityIssue,
  ForgeItem,
  LedgerEvent,
  Project,
  ProjectSettings,
  Script,
  ScriptVersion,
  ShowrunnerRun,
  SourceDoc,
  Suggestion,
  UsageRecord,
  VoiceProfile,
  VoiceSample,
} from './types';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const b = (v: unknown) => Number(v) === 1;

const mapProject = (r: Row): Project => ({
  id: s(r.id),
  name: s(r.name),
  type: s(r.type) as ProjectType,
  archived: b(r.archived),
  isSample: b(r.is_sample),
  isScratch: b(r.is_scratch),
  settings: json<ProjectSettings>(r.settings, {}),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

const mapScript = (r: Row): Script => ({
  id: s(r.id),
  projectId: s(r.project_id),
  title: s(r.title),
  episode: n(r.episode),
  currentVersionId: r.current_version_id ? s(r.current_version_id) : null,
  archived: b(r.archived),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

const mapVersion = (r: Row): ScriptVersion => ({
  id: s(r.id),
  scriptId: s(r.script_id),
  seq: Number(r.seq),
  text: s(r.text),
  authorship: json<AuthorSpan[]>(r.authorship, []),
  source: s(r.source) as ScriptVersion['source'],
  note: s(r.note),
  createdAt: s(r.created_at),
});

const mapEntry = (r: Row): CanonEntry => ({
  id: s(r.id),
  projectId: s(r.project_id),
  type: s(r.type) as CanonEntry['type'],
  name: s(r.name),
  aliases: json<string[]>(r.aliases, []),
  summary: s(r.summary),
  attributes: json<Record<string, string>>(r.attributes, {}),
  sourceDocId: r.source_doc_id ? s(r.source_doc_id) : null,
  sourceQuote: s(r.source_quote),
  sourceStart: n(r.source_start),
  sourceEnd: n(r.source_end),
  timelineOrder: n(r.timeline_order),
  timelineLabel: s(r.timeline_label),
  plantedIn: s(r.planted_in),
  status: s(r.status) as CanonEntry['status'],
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

const mapProposal = (r: Row): CanonProposal => ({
  id: s(r.id),
  projectId: s(r.project_id),
  jobId: r.job_id ? s(r.job_id) : null,
  type: s(r.type) as CanonProposal['type'],
  name: s(r.name),
  summary: s(r.summary),
  attributes: json<Record<string, string>>(r.attributes, {}),
  aliases: json<string[]>(r.aliases, []),
  related: json<CanonProposal['related']>(r.related, []),
  sourceDocId: s(r.source_doc_id),
  quote: s(r.quote),
  start: Number(r.start),
  end: Number(r.end),
  timelineOrder: n(r.timeline_order),
  timelineLabel: s(r.timeline_label),
  status: s(r.status) as CanonProposal['status'],
  targetEntryId: r.target_entry_id ? s(r.target_entry_id) : null,
  matchEntryId: r.match_entry_id ? s(r.match_entry_id) : null,
  createdAt: s(r.created_at),
});

const mapIssue = (r: Row): ContinuityIssue => ({
  id: s(r.id),
  projectId: s(r.project_id),
  scriptId: r.script_id ? s(r.script_id) : null,
  runId: s(r.run_id),
  type: s(r.type) as ContinuityIssue['type'],
  severity: s(r.severity) as ContinuityIssue['severity'],
  confidence: Number(r.confidence),
  summary: s(r.summary),
  draftQuote: s(r.draft_quote),
  draftStart: Number(r.draft_start),
  draftEnd: Number(r.draft_end),
  refKind: s(r.ref_kind) as ContinuityIssue['refKind'],
  refId: s(r.ref_id),
  refLabel: s(r.ref_label),
  refQuote: s(r.ref_quote),
  fixText: s(r.fix_text),
  fixReason: s(r.fix_reason),
  status: s(r.status) as ContinuityIssue['status'],
  fingerprint: s(r.fingerprint),
  createdAt: s(r.created_at),
  resolvedAt: r.resolved_at ? s(r.resolved_at) : null,
});

const mapSuggestion = (r: Row): Suggestion => ({
  id: s(r.id),
  projectId: r.project_id ? s(r.project_id) : null,
  scriptId: r.script_id ? s(r.script_id) : null,
  module: s(r.module),
  action: s(r.action),
  provider: s(r.provider),
  model: s(r.model),
  originalText: s(r.original_text),
  proposedText: s(r.proposed_text),
  rangeStart: Number(r.range_start),
  rangeEnd: Number(r.range_end),
  reason: s(r.reason),
  evidence: json(r.evidence, []),
  status: s(r.status) as Suggestion['status'],
  rejectReason: s(r.reject_reason),
  finalText: s(r.final_text),
  createdAt: s(r.created_at),
  decidedAt: r.decided_at ? s(r.decided_at) : null,
});

const mapLedger = (r: Row): LedgerEvent => ({
  id: s(r.id),
  projectId: r.project_id ? s(r.project_id) : null,
  scriptId: r.script_id ? s(r.script_id) : null,
  kind: s(r.kind),
  module: s(r.module),
  provider: s(r.provider),
  model: s(r.model),
  summary: s(r.summary),
  detail: json(r.detail, {}),
  createdAt: s(r.created_at),
});

const mapJob = (r: Row): JobRecord => ({
  id: s(r.id),
  type: s(r.type),
  projectId: r.project_id ? s(r.project_id) : null,
  status: s(r.status) as JobStatus,
  priority: s(r.priority) as JobRecord['priority'],
  label: s(r.label),
  input: json(r.input, null),
  state: json(r.state, null),
  progress: Number(r.progress),
  message: s(r.message),
  result: json(r.result, null),
  error: r.error ? s(r.error) : null,
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

const mapRun = (r: Row): ShowrunnerRun => ({
  id: s(r.id),
  projectId: s(r.project_id),
  scriptId: s(r.script_id),
  goal: s(r.goal),
  outline: s(r.outline),
  status: s(r.status) as ShowrunnerRun['status'],
  stepIndex: Number(r.step_index),
  steps: json(r.steps, []),
  log: json(r.log, []),
  workingText: s(r.working_text),
  tokens: Number(r.tokens),
  templateName: s(r.template_name),
  startedAt: s(r.started_at),
  updatedAt: s(r.updated_at),
  elapsedMs: Number(r.elapsed_ms),
});

const mapChunk = (r: Row): Chunk => ({
  id: s(r.id),
  projectId: s(r.project_id),
  sourceKind: s(r.source_kind) as Chunk['sourceKind'],
  sourceId: s(r.source_id),
  label: s(r.label),
  start: Number(r.start),
  end: Number(r.end),
  text: s(r.text),
  ordinal: Number(r.ordinal),
  embedding: json<number[] | null>(r.embedding, null),
  updatedAt: s(r.updated_at),
});

/** Builds an FTS5 query that matches any meaningful word of free text. */
export function ftsQuery(text: string): string {
  const STOP = new Set(
    'the a an and or but of to in on at for with from by is are was were be been it its this that as he she they we you i his her their our your not no so if then than there here into out up down over under'.split(
      ' ',
    ),
  );
  const terms = [
    ...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((t) => !STOP.has(t))),
  ].slice(0, 40);
  return terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

export class Store {
  readonly db: Db;

  constructor(file: string) {
    this.db = new Db(file);
    migrate(this.db);
  }

  close(): void {
    this.db.close();
  }

  /** Real write probe for the `store.ready` capability. */
  probe(): boolean {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'probe.lastWrite',
      now(),
    );
    return this.db.get('SELECT value FROM settings WHERE key = ?', 'probe.lastWrite') !== null;
  }

  // ---------- settings ----------
  getSetting<T>(key: string, fallback: T): T {
    const r = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
    return r ? json<T>(r.value, fallback) : fallback;
  }

  setSetting(key: string, value: unknown): void {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value),
    );
  }

  // ---------- projects ----------
  createProject(input: {
    name: string;
    type: ProjectType;
    isSample?: boolean;
    isScratch?: boolean;
  }): Project {
    const id = shortId();
    const t = now();
    this.db.run(
      'INSERT INTO projects (id, name, type, is_sample, is_scratch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      input.name,
      input.type,
      input.isSample ?? false,
      input.isScratch ?? false,
      t,
      t,
    );
    return this.getProject(id) as Project;
  }

  getProject(id: string): Project | null {
    const r = this.db.get('SELECT * FROM projects WHERE id = ?', id);
    return r ? mapProject(r) : null;
  }

  listProjects(opts: { includeArchived?: boolean } = {}): Project[] {
    return this.db
      .all(
        `SELECT * FROM projects WHERE is_scratch = 0 ${opts.includeArchived ? '' : 'AND archived = 0'} ORDER BY updated_at DESC`,
      )
      .map(mapProject);
  }

  scratchProject(): Project {
    const r = this.db.get('SELECT * FROM projects WHERE is_scratch = 1 LIMIT 1');
    if (r) return mapProject(r);
    return this.createProject({ name: 'Scratchpad', type: 'video', isScratch: true });
  }

  updateProject(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'type' | 'archived' | 'settings'>>,
  ): Project | null {
    const p = this.getProject(id);
    if (!p) return null;
    const next = { ...p, ...patch, settings: { ...p.settings, ...(patch.settings ?? {}) } };
    this.db.run(
      'UPDATE projects SET name = ?, type = ?, archived = ?, settings = ?, updated_at = ? WHERE id = ?',
      next.name,
      next.type,
      next.archived,
      JSON.stringify(next.settings),
      now(),
      id,
    );
    return this.getProject(id);
  }

  touchProject(id: string): void {
    this.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', now(), id);
  }

  deleteProject(id: string): void {
    this.db.tx(() => {
      this.db.run('DELETE FROM chunks_fts WHERE project_id = ?', id);
      this.db.run('DELETE FROM chunks WHERE project_id = ?', id);
      this.db.run('DELETE FROM suggestions WHERE project_id = ?', id);
      this.db.run('DELETE FROM ledger_events WHERE project_id = ?', id);
      this.db.run('DELETE FROM continuity_dismissals WHERE project_id = ?', id);
      this.db.run('DELETE FROM projects WHERE id = ?', id);
    });
  }

  // ---------- scripts ----------
  createScript(input: {
    projectId: string;
    title: string;
    episode?: number | null;
    text?: string;
    authorship?: AuthorSpan[];
    source?: ScriptVersion['source'];
  }): Script {
    const id = shortId();
    const t = now();
    this.db.tx(() => {
      this.db.run(
        'INSERT INTO scripts (id, project_id, title, episode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        input.projectId,
        input.title,
        input.episode ?? null,
        t,
        t,
      );
      this.saveVersion(
        id,
        input.text ?? '',
        input.authorship ?? null,
        input.source ?? 'edit',
        'Created',
      );
    });
    this.touchProject(input.projectId);
    return this.getScript(id) as Script;
  }

  getScript(id: string): Script | null {
    const r = this.db.get('SELECT * FROM scripts WHERE id = ?', id);
    return r ? mapScript(r) : null;
  }

  listScripts(projectId: string, opts: { includeArchived?: boolean } = {}): Script[] {
    return this.db
      .all(
        `SELECT * FROM scripts WHERE project_id = ? ${opts.includeArchived ? '' : 'AND archived = 0'} ORDER BY COALESCE(episode, 1e9), created_at`,
        projectId,
      )
      .map(mapScript);
  }

  updateScript(
    id: string,
    patch: Partial<Pick<Script, 'title' | 'episode' | 'archived'>>,
  ): Script | null {
    const cur = this.getScript(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.db.run(
      'UPDATE scripts SET title = ?, episode = ?, archived = ?, updated_at = ? WHERE id = ?',
      next.title,
      next.episode,
      next.archived,
      now(),
      id,
    );
    return this.getScript(id);
  }

  deleteScript(id: string): void {
    this.db.tx(() => {
      for (const c of this.db.all<{ id: string }>(
        "SELECT id FROM chunks WHERE source_kind = 'script' AND source_id = ?",
        id,
      )) {
        this.db.run('DELETE FROM chunks_fts WHERE chunk_id = ?', c.id);
      }
      this.db.run("DELETE FROM chunks WHERE source_kind = 'script' AND source_id = ?", id);
      this.db.run('DELETE FROM scripts WHERE id = ?', id);
    });
  }

  currentVersion(scriptId: string): ScriptVersion | null {
    const r = this.db.get(
      'SELECT v.* FROM script_versions v JOIN scripts s ON s.current_version_id = v.id WHERE s.id = ?',
      scriptId,
    );
    return r ? mapVersion(r) : null;
  }

  getVersion(id: string): ScriptVersion | null {
    const r = this.db.get('SELECT * FROM script_versions WHERE id = ?', id);
    return r ? mapVersion(r) : null;
  }

  listVersions(scriptId: string): Omit<ScriptVersion, 'text' | 'authorship'>[] {
    return this.db
      .all(
        'SELECT id, script_id, seq, source, note, created_at, length(text) AS len FROM script_versions WHERE script_id = ? ORDER BY seq DESC',
        scriptId,
      )
      .map((r) => ({
        id: s(r.id),
        scriptId: s(r.script_id),
        seq: Number(r.seq),
        source: s(r.source) as ScriptVersion['source'],
        note: s(r.note),
        createdAt: s(r.created_at),
        length: Number(r.len),
      }));
  }

  /**
   * Every change to a script's text creates a new version; nothing is overwritten.
   * Returns the existing current version when nothing changed.
   */
  saveVersion(
    scriptId: string,
    text: string,
    authorship: AuthorSpan[] | null,
    source: ScriptVersion['source'],
    note = '',
  ): ScriptVersion {
    return this.db.tx(() => {
      const cur = this.currentVersion(scriptId);
      const spans = fitSpans(authorship ?? cur?.authorship ?? null, text.length);
      if (cur && cur.text === text && JSON.stringify(cur.authorship) === JSON.stringify(spans)) {
        return cur;
      }
      const seqRow = this.db.get<{ m: number | null }>(
        'SELECT MAX(seq) AS m FROM script_versions WHERE script_id = ?',
        scriptId,
      );
      const id = shortId();
      const t = now();
      this.db.run(
        'INSERT INTO script_versions (id, script_id, seq, text, authorship, source, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        scriptId,
        (seqRow?.m ?? 0) + 1,
        text,
        JSON.stringify(spans),
        source,
        note,
        t,
      );
      this.db.run(
        'UPDATE scripts SET current_version_id = ?, updated_at = ? WHERE id = ?',
        id,
        t,
        scriptId,
      );
      return this.getVersion(id) as ScriptVersion;
    });
  }

  // ---------- source documents ----------
  addDoc(projectId: string, title: string, text: string): SourceDoc {
    const id = shortId();
    this.db.run(
      'INSERT INTO source_docs (id, project_id, title, text, created_at) VALUES (?, ?, ?, ?, ?)',
      id,
      projectId,
      title,
      text,
      now(),
    );
    return this.getDoc(id) as SourceDoc;
  }

  getDoc(id: string): SourceDoc | null {
    const r = this.db.get('SELECT * FROM source_docs WHERE id = ?', id);
    return r
      ? {
          id: s(r.id),
          projectId: s(r.project_id),
          title: s(r.title),
          text: s(r.text),
          createdAt: s(r.created_at),
        }
      : null;
  }

  listDocs(projectId: string): Omit<SourceDoc, 'text'>[] {
    return this.db
      .all(
        'SELECT id, project_id, title, created_at FROM source_docs WHERE project_id = ? ORDER BY created_at',
        projectId,
      )
      .map((r) => ({
        id: s(r.id),
        projectId: s(r.project_id),
        title: s(r.title),
        createdAt: s(r.created_at),
      }));
  }

  // ---------- canon ----------
  createEntry(
    input: Omit<CanonEntry, 'id' | 'createdAt' | 'updatedAt' | 'status'> & {
      status?: CanonEntry['status'];
    },
  ): CanonEntry {
    const id = shortId();
    const t = now();
    this.db.run(
      `INSERT INTO canon_entries (id, project_id, type, name, aliases, summary, attributes, source_doc_id, source_quote,
        source_start, source_end, timeline_order, timeline_label, planted_in, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.projectId,
      input.type,
      input.name,
      JSON.stringify(input.aliases),
      input.summary,
      JSON.stringify(input.attributes),
      input.sourceDocId,
      input.sourceQuote,
      input.sourceStart,
      input.sourceEnd,
      input.timelineOrder,
      input.timelineLabel,
      input.plantedIn,
      input.status ?? 'active',
      t,
      t,
    );
    const entry = this.getEntry(id) as CanonEntry;
    this.addEntryHistory(id, 'Created', entry);
    return entry;
  }

  getEntry(id: string): CanonEntry | null {
    const r = this.db.get('SELECT * FROM canon_entries WHERE id = ?', id);
    return r ? mapEntry(r) : null;
  }

  listEntries(projectId: string): CanonEntry[] {
    return this.db
      .all(
        'SELECT * FROM canon_entries WHERE project_id = ? ORDER BY type, name COLLATE NOCASE',
        projectId,
      )
      .map(mapEntry);
  }

  updateEntry(id: string, patch: Partial<CanonEntry>, change: string): CanonEntry | null {
    const cur = this.getEntry(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.db.run(
      `UPDATE canon_entries SET type = ?, name = ?, aliases = ?, summary = ?, attributes = ?, timeline_order = ?,
        timeline_label = ?, planted_in = ?, status = ?, updated_at = ? WHERE id = ?`,
      next.type,
      next.name,
      JSON.stringify(next.aliases),
      next.summary,
      JSON.stringify(next.attributes),
      next.timelineOrder,
      next.timelineLabel,
      next.plantedIn,
      next.status,
      now(),
      id,
    );
    const updated = this.getEntry(id) as CanonEntry;
    this.addEntryHistory(id, change, updated);
    return updated;
  }

  deleteEntry(id: string): void {
    this.db.tx(() => {
      for (const c of this.db.all<{ id: string }>(
        "SELECT id FROM chunks WHERE source_kind = 'canon' AND source_id = ?",
        id,
      )) {
        this.db.run('DELETE FROM chunks_fts WHERE chunk_id = ?', c.id);
      }
      this.db.run("DELETE FROM chunks WHERE source_kind = 'canon' AND source_id = ?", id);
      this.db.run('DELETE FROM canon_entries WHERE id = ?', id);
    });
  }

  private addEntryHistory(entryId: string, change: string, snapshot: CanonEntry): void {
    this.db.run(
      'INSERT INTO canon_history (id, entry_id, change, snapshot, created_at) VALUES (?, ?, ?, ?, ?)',
      shortId(),
      entryId,
      change,
      JSON.stringify(snapshot),
      now(),
    );
  }

  entryHistory(
    entryId: string,
  ): { id: string; change: string; snapshot: CanonEntry; createdAt: string }[] {
    return this.db
      .all(
        'SELECT * FROM canon_history WHERE entry_id = ? ORDER BY created_at DESC, rowid DESC',
        entryId,
      )
      .map((r) => ({
        id: s(r.id),
        change: s(r.change),
        snapshot: json<CanonEntry>(r.snapshot, {} as CanonEntry),
        createdAt: s(r.created_at),
      }));
  }

  addLink(projectId: string, fromId: string, toId: string, relation: string): CanonLink {
    const existing = this.db.get(
      'SELECT * FROM canon_links WHERE from_id = ? AND to_id = ? AND relation = ?',
      fromId,
      toId,
      relation,
    );
    const id = existing ? s(existing.id) : shortId();
    if (!existing) {
      this.db.run(
        'INSERT INTO canon_links (id, project_id, from_id, to_id, relation, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        projectId,
        fromId,
        toId,
        relation,
        now(),
      );
    }
    return this.listLinks(projectId).find((l) => l.id === id) as CanonLink;
  }

  removeLink(id: string): void {
    this.db.run('DELETE FROM canon_links WHERE id = ?', id);
  }

  listLinks(projectId: string): CanonLink[] {
    return this.db.all('SELECT * FROM canon_links WHERE project_id = ?', projectId).map((r) => ({
      id: s(r.id),
      projectId: s(r.project_id),
      fromId: s(r.from_id),
      toId: s(r.to_id),
      relation: s(r.relation),
      createdAt: s(r.created_at),
    }));
  }

  addProposal(
    input: Omit<CanonProposal, 'id' | 'createdAt' | 'status' | 'targetEntryId'>,
  ): CanonProposal {
    const id = shortId();
    this.db.run(
      `INSERT INTO canon_proposals (id, project_id, job_id, type, name, summary, attributes, aliases, related,
        source_doc_id, quote, start, end, timeline_order, timeline_label, match_entry_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.projectId,
      input.jobId,
      input.type,
      input.name,
      input.summary,
      JSON.stringify(input.attributes),
      JSON.stringify(input.aliases),
      JSON.stringify(input.related),
      input.sourceDocId,
      input.quote,
      input.start,
      input.end,
      input.timelineOrder,
      input.timelineLabel,
      input.matchEntryId,
      now(),
    );
    return this.getProposal(id) as CanonProposal;
  }

  getProposal(id: string): CanonProposal | null {
    const r = this.db.get('SELECT * FROM canon_proposals WHERE id = ?', id);
    return r ? mapProposal(r) : null;
  }

  listProposals(
    projectId: string,
    status: CanonProposal['status'] | 'all' = 'pending',
  ): CanonProposal[] {
    return status === 'all'
      ? this.db
          .all('SELECT * FROM canon_proposals WHERE project_id = ? ORDER BY rowid', projectId)
          .map(mapProposal)
      : this.db
          .all(
            'SELECT * FROM canon_proposals WHERE project_id = ? AND status = ? ORDER BY rowid',
            projectId,
            status,
          )
          .map(mapProposal);
  }

  setProposalStatus(
    id: string,
    status: CanonProposal['status'],
    targetEntryId: string | null = null,
  ): void {
    this.db.run(
      'UPDATE canon_proposals SET status = ?, target_entry_id = ? WHERE id = ?',
      status,
      targetEntryId,
      id,
    );
  }

  updateProposal(
    id: string,
    patch: Partial<Pick<CanonProposal, 'name' | 'summary' | 'type' | 'attributes'>>,
  ): CanonProposal | null {
    const cur = this.getProposal(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.db.run(
      'UPDATE canon_proposals SET name = ?, summary = ?, type = ?, attributes = ? WHERE id = ?',
      next.name,
      next.summary,
      next.type,
      JSON.stringify(next.attributes),
      id,
    );
    return this.getProposal(id);
  }

  // ---------- continuity ----------
  addIssue(
    input: Omit<ContinuityIssue, 'id' | 'createdAt' | 'resolvedAt' | 'status'>,
  ): ContinuityIssue {
    const id = shortId();
    this.db.run(
      `INSERT INTO continuity_issues (id, project_id, script_id, run_id, type, severity, confidence, summary,
        draft_quote, draft_start, draft_end, ref_kind, ref_id, ref_label, ref_quote, fix_text, fix_reason,
        fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.projectId,
      input.scriptId,
      input.runId,
      input.type,
      input.severity,
      input.confidence,
      input.summary,
      input.draftQuote,
      input.draftStart,
      input.draftEnd,
      input.refKind,
      input.refId,
      input.refLabel,
      input.refQuote,
      input.fixText,
      input.fixReason,
      input.fingerprint,
      now(),
    );
    return this.getIssue(id) as ContinuityIssue;
  }

  getIssue(id: string): ContinuityIssue | null {
    const r = this.db.get('SELECT * FROM continuity_issues WHERE id = ?', id);
    return r ? mapIssue(r) : null;
  }

  listIssues(filter: {
    projectId: string;
    scriptId?: string;
    status?: ContinuityIssue['status'];
  }): ContinuityIssue[] {
    const rows = this.db.all(
      `SELECT * FROM continuity_issues WHERE project_id = ? ${filter.scriptId ? 'AND script_id = ?' : 'AND ? IS NULL'}
       ${filter.status ? 'AND status = ?' : 'AND ? IS NULL'} ORDER BY created_at DESC, rowid`,
      filter.projectId,
      filter.scriptId ?? null,
      filter.status ?? null,
    );
    return rows.map(mapIssue);
  }

  setIssueStatus(id: string, status: ContinuityIssue['status']): void {
    this.db.run(
      'UPDATE continuity_issues SET status = ?, resolved_at = ? WHERE id = ?',
      status,
      status === 'open' ? null : now(),
      id,
    );
  }

  /** Open issues from older runs of the same script are superseded by a new run. */
  supersedeOpenIssues(scriptId: string, keepRunId: string): void {
    this.db.run(
      "DELETE FROM continuity_issues WHERE script_id = ? AND status = 'open' AND run_id <> ?",
      scriptId,
      keepRunId,
    );
  }

  addDismissal(projectId: string, fingerprint: string, summary: string): void {
    this.db.run(
      'INSERT OR IGNORE INTO continuity_dismissals (project_id, fingerprint, summary, created_at) VALUES (?, ?, ?, ?)',
      projectId,
      fingerprint,
      summary,
      now(),
    );
  }

  removeDismissal(projectId: string, fingerprint: string): void {
    this.db.run(
      'DELETE FROM continuity_dismissals WHERE project_id = ? AND fingerprint = ?',
      projectId,
      fingerprint,
    );
  }

  listDismissals(projectId: string): { fingerprint: string; summary: string }[] {
    return this.db
      .all('SELECT fingerprint, summary FROM continuity_dismissals WHERE project_id = ?', projectId)
      .map((r) => ({ fingerprint: s(r.fingerprint), summary: s(r.summary) }));
  }

  issueHistory(
    projectId: string,
  ): { scriptId: string; runId: string; at: string; open: number; total: number }[] {
    return this.db
      .all(
        `SELECT script_id, run_id, MIN(created_at) AS at, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
          COUNT(*) AS total FROM continuity_issues WHERE project_id = ? AND script_id IS NOT NULL
          GROUP BY script_id, run_id ORDER BY at`,
        projectId,
      )
      .map((r) => ({
        scriptId: s(r.script_id),
        runId: s(r.run_id),
        at: s(r.at),
        open: Number(r.open),
        total: Number(r.total),
      }));
  }

  // ---------- voice ----------
  createProfile(projectId: string, name: string): VoiceProfile {
    const id = shortId();
    const t = now();
    this.db.run(
      'INSERT INTO voice_profiles (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      id,
      projectId,
      name,
      t,
      t,
    );
    return this.getProfile(id) as VoiceProfile;
  }

  getProfile(id: string): VoiceProfile | null {
    const r = this.db.get('SELECT * FROM voice_profiles WHERE id = ?', id);
    return r
      ? {
          id: s(r.id),
          projectId: s(r.project_id),
          name: s(r.name),
          metrics: json(r.metrics, null),
          description: s(r.description),
          traits: json<string[]>(r.traits, []),
          createdAt: s(r.created_at),
          updatedAt: s(r.updated_at),
        }
      : null;
  }

  listProfiles(projectId: string): VoiceProfile[] {
    return this.db
      .all<{ id: string }>(
        'SELECT id FROM voice_profiles WHERE project_id = ? ORDER BY created_at',
        projectId,
      )
      .map((r) => this.getProfile(r.id) as VoiceProfile);
  }

  updateProfile(
    id: string,
    patch: Partial<Pick<VoiceProfile, 'name' | 'metrics' | 'description' | 'traits'>>,
  ): VoiceProfile | null {
    const cur = this.getProfile(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.db.run(
      'UPDATE voice_profiles SET name = ?, metrics = ?, description = ?, traits = ?, updated_at = ? WHERE id = ?',
      next.name,
      JSON.stringify(next.metrics),
      next.description,
      JSON.stringify(next.traits),
      now(),
      id,
    );
    return this.getProfile(id);
  }

  deleteProfile(id: string): void {
    this.db.run('DELETE FROM voice_profiles WHERE id = ?', id);
  }

  addSample(profileId: string, title: string, text: string, confirmedOwn: boolean): VoiceSample {
    const id = shortId();
    this.db.run(
      'INSERT INTO voice_samples (id, profile_id, title, text, confirmed_own, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      profileId,
      title,
      text,
      confirmedOwn,
      now(),
    );
    return this.listSamples(profileId).find((x) => x.id === id) as VoiceSample;
  }

  listSamples(profileId: string): VoiceSample[] {
    return this.db
      .all('SELECT * FROM voice_samples WHERE profile_id = ? ORDER BY created_at, rowid', profileId)
      .map((r) => ({
        id: s(r.id),
        profileId: s(r.profile_id),
        title: s(r.title),
        text: s(r.text),
        confirmedOwn: b(r.confirmed_own),
        createdAt: s(r.created_at),
      }));
  }

  deleteSample(id: string): void {
    this.db.run('DELETE FROM voice_samples WHERE id = ?', id);
  }

  // ---------- suggestions ----------
  addSuggestion(
    input: Omit<
      Suggestion,
      'id' | 'createdAt' | 'decidedAt' | 'status' | 'rejectReason' | 'finalText'
    >,
  ): Suggestion {
    const id = shortId();
    this.db.run(
      `INSERT INTO suggestions (id, project_id, script_id, module, action, provider, model, original_text, proposed_text,
        range_start, range_end, reason, evidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.projectId,
      input.scriptId,
      input.module,
      input.action,
      input.provider,
      input.model,
      input.originalText,
      input.proposedText,
      input.rangeStart,
      input.rangeEnd,
      input.reason,
      JSON.stringify(input.evidence),
      now(),
    );
    return this.getSuggestion(id) as Suggestion;
  }

  getSuggestion(id: string): Suggestion | null {
    const r = this.db.get('SELECT * FROM suggestions WHERE id = ?', id);
    return r ? mapSuggestion(r) : null;
  }

  listSuggestions(filter: {
    scriptId?: string;
    projectId?: string;
    status?: Suggestion['status'];
  }): Suggestion[] {
    return this.db
      .all(
        `SELECT * FROM suggestions WHERE (? IS NULL OR script_id = ?) AND (? IS NULL OR project_id = ?)
         AND (? IS NULL OR status = ?) ORDER BY created_at DESC, rowid DESC LIMIT 500`,
        filter.scriptId ?? null,
        filter.scriptId ?? null,
        filter.projectId ?? null,
        filter.projectId ?? null,
        filter.status ?? null,
        filter.status ?? null,
      )
      .map(mapSuggestion);
  }

  decideSuggestion(
    id: string,
    status: Suggestion['status'],
    finalText: string,
    rejectReason = '',
  ): Suggestion | null {
    this.db.run(
      'UPDATE suggestions SET status = ?, final_text = ?, reject_reason = ?, decided_at = ? WHERE id = ?',
      status,
      finalText,
      rejectReason,
      now(),
      id,
    );
    return this.getSuggestion(id);
  }

  // ---------- ledger ----------
  addLedger(input: Omit<LedgerEvent, 'id' | 'createdAt'>): LedgerEvent {
    const id = shortId();
    this.db.run(
      `INSERT INTO ledger_events (id, project_id, script_id, kind, module, provider, model, summary, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.projectId,
      input.scriptId,
      input.kind,
      input.module,
      input.provider,
      input.model,
      input.summary,
      JSON.stringify(input.detail),
      now(),
    );
    return mapLedger(this.db.get('SELECT * FROM ledger_events WHERE id = ?', id) as Row);
  }

  listLedger(filter: {
    projectId?: string | null;
    scriptId?: string;
    limit?: number;
  }): LedgerEvent[] {
    return this.db
      .all(
        `SELECT * FROM ledger_events WHERE (? IS NULL OR project_id = ?) AND (? IS NULL OR script_id = ?)
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        filter.projectId ?? null,
        filter.projectId ?? null,
        filter.scriptId ?? null,
        filter.scriptId ?? null,
        filter.limit ?? 200,
      )
      .map(mapLedger);
  }

  // ---------- jobs ----------
  readonly jobs: JobStorage & { list(limit?: number): JobRecord[] } = {
    insert: (job) => {
      this.db.run(
        `INSERT INTO jobs (id, type, project_id, status, priority, label, input, state, progress, message, result, error,
          created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        job.id,
        job.type,
        job.projectId,
        job.status,
        job.priority,
        job.label,
        JSON.stringify(job.input),
        JSON.stringify(job.state),
        job.progress,
        job.message,
        JSON.stringify(job.result),
        job.error,
        job.createdAt,
        job.updatedAt,
      );
    },
    update: (id, patch) => {
      const cur = this.jobs.get(id);
      if (!cur) return;
      const next = { ...cur, ...patch };
      this.db.run(
        `UPDATE jobs SET status = ?, state = ?, progress = ?, message = ?, result = ?, error = ?, updated_at = ? WHERE id = ?`,
        next.status,
        JSON.stringify(next.state),
        next.progress,
        next.message,
        JSON.stringify(next.result),
        next.error,
        next.updatedAt,
        id,
      );
    },
    get: (id) => {
      const r = this.db.get('SELECT * FROM jobs WHERE id = ?', id);
      return r ? mapJob(r) : null;
    },
    listByStatus: (statuses) =>
      this.db
        .all(
          `SELECT * FROM jobs WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at`,
          ...statuses,
        )
        .map(mapJob),
    list: (limit = 30) =>
      this.db
        .all('SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC LIMIT ?', limit)
        .map(mapJob),
  };

  // ---------- usage & cache ----------
  addUsage(input: Omit<UsageRecord, 'id' | 'createdAt'>): void {
    this.db.run(
      `INSERT INTO usage_records (id, module, provider, model, tier, input_tokens, output_tokens, cost, cached, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      shortId(),
      input.module,
      input.provider,
      input.model,
      input.tier,
      input.inputTokens,
      input.outputTokens,
      input.cost,
      input.cached,
      now(),
    );
  }

  usageSummary(): {
    byModule: {
      module: string;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      cost: number | null;
      cached: number;
    }[];
    byDay: {
      day: string;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      cost: number | null;
    }[];
    byProvider: {
      provider: string;
      model: string;
      calls: number;
      inputTokens: number;
      outputTokens: number;
    }[];
  } {
    const mapAgg = (r: Row) => ({
      calls: Number(r.calls),
      inputTokens: Number(r.inp ?? 0),
      outputTokens: Number(r.outp ?? 0),
      cost: r.cost === null || r.cost === undefined ? null : Number(r.cost),
    });
    return {
      byModule: this.db
        .all(
          `SELECT module, COUNT(*) calls, SUM(input_tokens) inp, SUM(output_tokens) outp, SUM(cost) cost,
            SUM(cached) cached FROM usage_records GROUP BY module ORDER BY calls DESC`,
        )
        .map((r) => ({ module: s(r.module), cached: Number(r.cached ?? 0), ...mapAgg(r) })),
      byDay: this.db
        .all(
          `SELECT substr(created_at, 1, 10) day, COUNT(*) calls, SUM(input_tokens) inp, SUM(output_tokens) outp,
            SUM(cost) cost FROM usage_records GROUP BY day ORDER BY day DESC LIMIT 30`,
        )
        .map((r) => ({ day: s(r.day), ...mapAgg(r) })),
      byProvider: this.db
        .all(
          `SELECT provider, model, COUNT(*) calls, SUM(input_tokens) inp, SUM(output_tokens) outp FROM usage_records
           WHERE cached = 0 GROUP BY provider, model ORDER BY calls DESC`,
        )
        .map((r) => ({
          provider: s(r.provider),
          model: s(r.model),
          calls: Number(r.calls),
          inputTokens: Number(r.inp ?? 0),
          outputTokens: Number(r.outp ?? 0),
        })),
    };
  }

  cacheGet(key: string): string | null {
    return (
      this.db.get<{ value: string }>('SELECT value FROM response_cache WHERE key = ?', key)
        ?.value ?? null
    );
  }

  cachePut(key: string, value: string): void {
    this.db.run(
      'INSERT INTO response_cache (key, value, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
      now(),
    );
  }

  // ---------- showrunner runs ----------
  createRun(
    input: Pick<ShowrunnerRun, 'projectId' | 'scriptId' | 'goal' | 'outline' | 'templateName'>,
  ): ShowrunnerRun {
    const id = shortId();
    const t = now();
    this.db.run(
      `INSERT INTO showrunner_runs (id, project_id, script_id, goal, outline, status, template_name, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'planning', ?, ?, ?)`,
      id,
      input.projectId,
      input.scriptId,
      input.goal,
      input.outline,
      input.templateName,
      t,
      t,
    );
    return this.getRun(id) as ShowrunnerRun;
  }

  getRun(id: string): ShowrunnerRun | null {
    const r = this.db.get('SELECT * FROM showrunner_runs WHERE id = ?', id);
    return r ? mapRun(r) : null;
  }

  listRuns(projectId: string): ShowrunnerRun[] {
    return this.db
      .all(
        'SELECT * FROM showrunner_runs WHERE project_id = ? ORDER BY started_at DESC, rowid DESC',
        projectId,
      )
      .map(mapRun);
  }

  updateRun(id: string, patch: Partial<ShowrunnerRun>): ShowrunnerRun | null {
    const cur = this.getRun(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.db.run(
      `UPDATE showrunner_runs SET status = ?, step_index = ?, steps = ?, log = ?, working_text = ?, tokens = ?,
        template_name = ?, elapsed_ms = ?, updated_at = ? WHERE id = ?`,
      next.status,
      next.stepIndex,
      JSON.stringify(next.steps),
      JSON.stringify(next.log),
      next.workingText,
      next.tokens,
      next.templateName,
      next.elapsedMs,
      now(),
      id,
    );
    return this.getRun(id);
  }

  // ---------- forge ----------
  addForgeItem(input: Omit<ForgeItem, 'id' | 'createdAt' | 'shortlisted'>): ForgeItem {
    const id = shortId();
    this.db.run(
      `INSERT INTO forge_items (id, project_id, script_id, kind, text, payload, batch_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.projectId,
      input.scriptId,
      input.kind,
      input.text,
      JSON.stringify(input.payload),
      input.batchId,
      now(),
    );
    return this.getForgeItem(id) as ForgeItem;
  }

  getForgeItem(id: string): ForgeItem | null {
    const r = this.db.get('SELECT * FROM forge_items WHERE id = ?', id);
    return r
      ? {
          id: s(r.id),
          projectId: s(r.project_id),
          scriptId: r.script_id ? s(r.script_id) : null,
          kind: s(r.kind),
          text: s(r.text),
          payload: json(r.payload, {}),
          shortlisted: b(r.shortlisted),
          batchId: s(r.batch_id),
          createdAt: s(r.created_at),
        }
      : null;
  }

  listForgeItems(
    projectId: string,
    opts: { shortlistedOnly?: boolean; scriptId?: string } = {},
  ): ForgeItem[] {
    return this.db
      .all<{ id: string }>(
        `SELECT id FROM forge_items WHERE project_id = ? ${opts.shortlistedOnly ? 'AND shortlisted = 1' : ''}
         AND (? IS NULL OR script_id = ?) ORDER BY created_at DESC, rowid DESC LIMIT 200`,
        projectId,
        opts.scriptId ?? null,
        opts.scriptId ?? null,
      )
      .map((r) => this.getForgeItem(r.id) as ForgeItem);
  }

  setShortlisted(id: string, on: boolean): void {
    this.db.run('UPDATE forge_items SET shortlisted = ? WHERE id = ?', on, id);
  }

  // ---------- chunks (retrieval index) ----------
  replaceChunks(
    projectId: string,
    sourceKind: Chunk['sourceKind'],
    sourceId: string,
    chunks: Pick<Chunk, 'label' | 'start' | 'end' | 'text' | 'ordinal'>[],
  ): Chunk[] {
    return this.db.tx(() => {
      for (const c of this.db.all<{ id: string }>(
        'SELECT id FROM chunks WHERE source_kind = ? AND source_id = ?',
        sourceKind,
        sourceId,
      )) {
        this.db.run('DELETE FROM chunks_fts WHERE chunk_id = ?', c.id);
      }
      this.db.run(
        'DELETE FROM chunks WHERE source_kind = ? AND source_id = ?',
        sourceKind,
        sourceId,
      );
      const t = now();
      for (const c of chunks) {
        const id = shortId();
        this.db.run(
          `INSERT INTO chunks (id, project_id, source_kind, source_id, label, start, end, text, ordinal, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          projectId,
          sourceKind,
          sourceId,
          c.label,
          c.start,
          c.end,
          c.text,
          c.ordinal,
          t,
        );
        this.db.run(
          'INSERT INTO chunks_fts (text, label, chunk_id, project_id) VALUES (?, ?, ?, ?)',
          c.text,
          c.label,
          id,
          projectId,
        );
      }
      return this.listChunks(projectId, { sourceKind, sourceId });
    });
  }

  listChunks(
    projectId: string,
    opts: { sourceKind?: Chunk['sourceKind']; sourceId?: string } = {},
  ): Chunk[] {
    return this.db
      .all(
        `SELECT * FROM chunks WHERE project_id = ? AND (? IS NULL OR source_kind = ?) AND (? IS NULL OR source_id = ?)
         ORDER BY ordinal, start`,
        projectId,
        opts.sourceKind ?? null,
        opts.sourceKind ?? null,
        opts.sourceId ?? null,
        opts.sourceId ?? null,
      )
      .map(mapChunk);
  }

  setChunkEmbedding(id: string, embedding: number[]): void {
    this.db.run('UPDATE chunks SET embedding = ? WHERE id = ?', JSON.stringify(embedding), id);
  }

  /** Full-text search; lower `rank` is better (bm25). */
  searchChunks(
    projectId: string,
    query: string,
    limit = 30,
  ): (Chunk & { rank: number; snippet: string })[] {
    const q = ftsQuery(query);
    if (!q) return [];
    const rows = this.db.all(
      `SELECT c.*, bm25(chunks_fts) AS rank, snippet(chunks_fts, 0, '', '', '…', 14) AS snip
       FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.chunk_id
       WHERE chunks_fts MATCH ? AND chunks_fts.project_id = ? ORDER BY rank LIMIT ?`,
      q,
      projectId,
      limit,
    );
    return rows.map((r) => ({ ...mapChunk(r), rank: Number(r.rank), snippet: s(r.snip) }));
  }
}
