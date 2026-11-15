import type { Db } from './db';

export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0, is_sample INTEGER NOT NULL DEFAULT 0,
  is_scratch INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE scripts (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, episode INTEGER, current_version_id TEXT,
  archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX scripts_project ON scripts(project_id);
CREATE TABLE script_versions (
  id TEXT PRIMARY KEY, script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, text TEXT NOT NULL, authorship TEXT NOT NULL, source TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX versions_script ON script_versions(script_id, seq);
CREATE TABLE source_docs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE canon_entries (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '', attributes TEXT NOT NULL DEFAULT '{}',
  source_doc_id TEXT, source_quote TEXT NOT NULL, source_start INTEGER, source_end INTEGER,
  timeline_order REAL, timeline_label TEXT NOT NULL DEFAULT '', planted_in TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX canon_project ON canon_entries(project_id, type);
CREATE TABLE canon_history (
  id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES canon_entries(id) ON DELETE CASCADE,
  change TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE canon_links (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL REFERENCES canon_entries(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES canon_entries(id) ON DELETE CASCADE,
  relation TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE canon_proposals (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id TEXT, type TEXT NOT NULL, name TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
  attributes TEXT NOT NULL DEFAULT '{}', aliases TEXT NOT NULL DEFAULT '[]',
  related TEXT NOT NULL DEFAULT '[]', source_doc_id TEXT NOT NULL, quote TEXT NOT NULL,
  start INTEGER NOT NULL, end INTEGER NOT NULL, timeline_order REAL,
  timeline_label TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
  target_entry_id TEXT, match_entry_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX proposals_project ON canon_proposals(project_id, status);
CREATE TABLE continuity_issues (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  script_id TEXT, run_id TEXT NOT NULL, type TEXT NOT NULL, severity TEXT NOT NULL,
  confidence REAL NOT NULL, summary TEXT NOT NULL, draft_quote TEXT NOT NULL,
  draft_start INTEGER NOT NULL, draft_end INTEGER NOT NULL, ref_kind TEXT NOT NULL,
  ref_id TEXT NOT NULL, ref_label TEXT NOT NULL, ref_quote TEXT NOT NULL,
  fix_text TEXT NOT NULL DEFAULT '', fix_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE INDEX issues_script ON continuity_issues(script_id, status);
CREATE TABLE continuity_dismissals (
  project_id TEXT NOT NULL, fingerprint TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, PRIMARY KEY (project_id, fingerprint)
);
CREATE TABLE voice_profiles (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, metrics TEXT NOT NULL DEFAULT 'null', description TEXT NOT NULL DEFAULT '',
  traits TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE voice_samples (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL, text TEXT NOT NULL, confirmed_own INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE suggestions (
  id TEXT PRIMARY KEY, project_id TEXT, script_id TEXT, module TEXT NOT NULL, action TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
  original_text TEXT NOT NULL, proposed_text TEXT NOT NULL,
  range_start INTEGER NOT NULL, range_end INTEGER NOT NULL, reason TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'offered',
  reject_reason TEXT NOT NULL DEFAULT '', final_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, decided_at TEXT
);
CREATE INDEX suggestions_script ON suggestions(script_id, status);
CREATE TABLE ledger_events (
  id TEXT PRIMARY KEY, project_id TEXT, script_id TEXT, kind TEXT NOT NULL, module TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX ledger_project ON ledger_events(project_id, created_at);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, project_id TEXT, status TEXT NOT NULL,
  priority TEXT NOT NULL, label TEXT NOT NULL, input TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'null',
  progress REAL NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT 'null',
  error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX jobs_status ON jobs(status);
CREATE TABLE usage_records (
  id TEXT PRIMARY KEY, module TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  tier TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  cost REAL, cached INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE response_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE showrunner_runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  script_id TEXT NOT NULL, goal TEXT NOT NULL, outline TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL, step_index INTEGER NOT NULL DEFAULT 0, steps TEXT NOT NULL DEFAULT '[]',
  log TEXT NOT NULL DEFAULT '[]', working_text TEXT NOT NULL DEFAULT '', tokens INTEGER NOT NULL DEFAULT 0,
  template_name TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE forge_items (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  script_id TEXT, kind TEXT NOT NULL, text TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
  shortlisted INTEGER NOT NULL DEFAULT 0, batch_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE chunks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_kind TEXT NOT NULL, source_id TEXT NOT NULL,
  label TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, text TEXT NOT NULL,
  ordinal REAL NOT NULL DEFAULT 0, embedding TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX chunks_source ON chunks(source_kind, source_id);
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text, label, chunk_id UNINDEXED, project_id UNINDEXED, tokenize = 'porter unicode61'
);
`,
  },
];

export function migrate(db: Db): number[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const applied = new Set(
    db.all<{ id: number }>('SELECT id FROM schema_migrations').map((r) => r.id),
  );
  const ran: number[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.tx(() => {
      db.exec(m.sql);
      db.run(
        'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
        m.id,
        m.name,
        new Date().toISOString(),
      );
    });
    ran.push(m.id);
  }
  return ran;
}
