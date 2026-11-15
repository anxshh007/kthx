import { useMemo, useRef, useState } from 'react';
import { CANON_TYPES, CANON_TYPE_LABELS, type CanonType } from '@kathix/kernel/shared';
import type { CanonEntry, CanonLink, CanonProposal } from '@kathix/store';
import {
  ActionButton,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  FileButton,
  Loading,
  PageHeader,
  Panel,
  Tabs,
  api,
  downloadFrom,
  useLoad,
  useServerEvents,
  useStudio,
  type ModuleUi,
} from '@kathix/ui';
import { manifest } from './manifest';

type Tab = 'entries' | 'review' | 'import' | 'timeline' | 'graph' | 'promises';
type Proposal = CanonProposal & { docTitle: string };
interface Detail {
  entry: CanonEntry;
  links: (CanonLink & { otherId: string; otherName: string; direction: 'in' | 'out' })[];
  mentions: { scriptId: string; title: string; passage: string; at: number }[];
  history: { id: string; change: string; createdAt: string }[];
  sourceTitle: string;
}

const attrsToText = (a: Record<string, string>) =>
  Object.entries(a)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
const textToAttrs = (t: string) =>
  Object.fromEntries(
    t
      .split('\n')
      .map((l) => /^([^:]+):\s*(.*)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [(m[1] as string).trim(), (m[2] as string).trim()]),
  );

function ProposalCard({
  p,
  entries,
  reload,
}: {
  p: Proposal;
  entries: CanonEntry[];
  reload: () => Promise<void>;
}) {
  const { attempt, toast } = useStudio();
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [name, setName] = useState(p.name);
  const [summary, setSummary] = useState(p.summary);
  const [type, setType] = useState<CanonType>(p.type);
  const [attrText, setAttrText] = useState(attrsToText(p.attributes));
  const [target, setTarget] = useState(p.matchEntryId ?? entries[0]?.id ?? '');
  const approve = (edits: object) =>
    attempt(async () => {
      await api.post(`/api/m/canon/proposals/${p.id}/approve`, edits);
      await reload();
    }, `Added “${name}” to the canon`);
  return (
    <article className="panel ai stack" aria-label={`Proposal: ${p.name}`}>
      <div className="row spread">
        <div className="row">
          <Badge tone="ai">{CANON_TYPE_LABELS[p.type]}</Badge>
          <h3>{p.name}</h3>
          {p.matchEntryId && <Badge tone="warm">Already in canon: new detail</Badge>}
        </div>
        <span className="muted small">from {p.docTitle}</span>
      </div>
      {editing ? (
        <div className="stack">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Type">
            <select
              className="select"
              value={type}
              onChange={(e) => setType(e.target.value as CanonType)}
            >
              {CANON_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CANON_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Summary">
            <textarea
              className="textarea"
              style={{ minHeight: 70 }}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </Field>
          <Field label="Details (one “key: value” per line)">
            <textarea
              className="textarea"
              style={{ minHeight: 70 }}
              value={attrText}
              onChange={(e) => setAttrText(e.target.value)}
            />
          </Field>
        </div>
      ) : (
        <>
          {p.summary && <p>{p.summary}</p>}
          {Object.keys(p.attributes).length > 0 && (
            <div className="row">
              {Object.entries(p.attributes).map(([k, v]) => (
                <Badge key={k}>
                  {k}: {v}
                </Badge>
              ))}
            </div>
          )}
        </>
      )}
      <div>
        <span className="muted small">Source passage, exactly as written</span>
        <div className="quote ref">{p.quote}</div>
      </div>
      {merging && (
        <Field label="Merge into">
          <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
            {entries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({CANON_TYPE_LABELS[e.type]})
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="row">
        {editing ? (
          <ActionButton
            kind="primary"
            onAction={() => approve({ name, summary, type, attributes: textToAttrs(attrText) })}
          >
            Approve my edit
          </ActionButton>
        ) : merging ? (
          <ActionButton
            kind="primary"
            disabled={!target}
            onAction={() =>
              attempt(async () => {
                await api.post(`/api/m/canon/proposals/${p.id}/merge`, { targetId: target });
                await reload();
              }, 'Merged into the existing entry')
            }
          >
            Merge
          </ActionButton>
        ) : (
          <ActionButton kind="primary" onAction={() => approve({})}>
            Approve
          </ActionButton>
        )}
        {!editing && !merging && <Button onClick={() => setEditing(true)}>Edit</Button>}
        {!editing && !merging && entries.length > 0 && (
          <Button onClick={() => setMerging(true)}>Merge with existing</Button>
        )}
        {(editing || merging) && (
          <Button
            kind="ghost"
            onClick={() => {
              setEditing(false);
              setMerging(false);
            }}
          >
            Back
          </Button>
        )}
        <ActionButton
          kind="ghost"
          onAction={async () => {
            await attempt(() => api.post(`/api/m/canon/proposals/${p.id}/reject`));
            await reload();
            toast(`Rejected “${p.name}”`, {
              undo: async () => {
                await api.post(`/api/m/canon/proposals/${p.id}/restore`);
                await reload();
              },
            });
          }}
        >
          Reject
        </ActionButton>
      </div>
    </article>
  );
}

function Review({ pid }: { pid: string }) {
  const { attempt, navigate } = useStudio();
  const props = useLoad(
    () => api.get<{ proposals: Proposal[] }>(`/api/m/canon/proposals?projectId=${pid}`),
    [pid],
  );
  const entries = useLoad(
    () => api.get<{ entries: CanonEntry[] }>(`/api/m/canon/entries?projectId=${pid}`),
    [pid],
  );
  const [bulkType, setBulkType] = useState<CanonType>('character');
  useServerEvents(['job'], () => void props.reload());
  const reload = async () => {
    await props.reload();
    await entries.reload();
  };
  if (!props.data || !entries.data) return <Loading />;
  if (!props.data.proposals.length) {
    return (
      <EmptyState
        title="Nothing to review"
        body="Import an episode or notes and Kathix will propose canon entries here."
        action={<Button onClick={() => navigate('/canon?tab=import')}>Import material</Button>}
      />
    );
  }
  const types = [...new Set(props.data.proposals.map((p) => p.type))];
  return (
    <div className="stack">
      <Panel variant="flat">
        <div className="row">
          <span>Approve every pending</span>
          <select
            className="select"
            style={{ width: 200 }}
            value={types.includes(bulkType) ? bulkType : types[0]}
            onChange={(e) => setBulkType(e.target.value as CanonType)}
            aria-label="Type to approve in bulk"
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {CANON_TYPE_LABELS[t]} ({props.data?.proposals.filter((p) => p.type === t).length})
              </option>
            ))}
          </select>
          <ActionButton
            onAction={() =>
              attempt(async () => {
                const r = await api.post<{ approved: number }>(
                  '/api/m/canon/proposals/bulk-approve',
                  { projectId: pid, type: types.includes(bulkType) ? bulkType : types[0] },
                );
                await reload();
                return r;
              }, 'Approved')
            }
          >
            Approve all of this type
          </ActionButton>
        </div>
      </Panel>
      {props.data.proposals.map((p) => (
        <ProposalCard key={p.id} p={p} entries={entries.data?.entries ?? []} reload={reload} />
      ))}
    </div>
  );
}

function ImportTab({ pid }: { pid: string }) {
  const { attempt, has, navigate, toast } = useStudio();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [waiting, setWaiting] = useState<string | null>(null);
  const waitingRef = useRef<string | null>(null);
  const finished = useRef(new Map<string, { status: string; proposals: number }>());
  const settle = (id: string) => {
    const done = finished.current.get(id);
    if (!done || waitingRef.current !== id) return;
    waitingRef.current = null;
    setWaiting(null);
    if (done.status === 'succeeded') {
      toast(`${done.proposals} proposals are ready for review`);
      navigate('/canon?tab=review');
    }
  };
  useServerEvents(['job'], (_e, data) => {
    const job = data as { id: string; status: string; result: { proposals: number } | null };
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) {
      finished.current.set(job.id, { status: job.status, proposals: job.result?.proposals ?? 0 });
      settle(job.id);
    }
  });
  if (!has('model.structured')) {
    return (
      <EmptyState
        title="Importing needs a connected model"
        body="Connect a model in Model Router to read your episodes and propose canon."
        action={<Button onClick={() => navigate('/router')}>Open Model Router</Button>}
      />
    );
  }
  const send = async (file: { name: string; text?: string; base64?: string }, docTitle: string) => {
    const r = await attempt(() =>
      api.post<{ job: { id: string } }>('/api/m/canon/import', {
        projectId: pid,
        title: docTitle,
        file,
      }),
    );
    if (r) {
      waitingRef.current = r.job.id;
      setWaiting(r.job.id);
      toast('Reading in the background. You can keep working.');
      // The job may already have finished before this answer arrived.
      settle(r.job.id);
    }
  };
  return (
    <Panel title="Paste an episode or notes to build your canon">
      <div className="stack">
        <p className="muted small">
          Kathix proposes characters, places, facts and promises. Every proposal quotes the exact
          passage it came from; anything it cannot quote is discarded. Imported text is treated only
          as story material, never as instructions.
        </p>
        <Field label="Title">
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Episode 3 script"
          />
        </Field>
        <Field label="Text">
          <textarea
            className="textarea script"
            style={{ minHeight: 220 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a script, chapter or notes"
          />
        </Field>
        <div className="row">
          <ActionButton
            kind="primary"
            disabled={!text.trim() || waiting !== null}
            busyLabel="Starting"
            onAction={() =>
              send({ name: `${title || 'Pasted text'}.txt`, text }, title || 'Pasted text')
            }
          >
            {waiting ? 'Reading…' : 'Propose canon entries'}
          </ActionButton>
          <FileButton
            label="Upload a file"
            accept=".txt,.md,.docx,.pdf"
            multiple
            onFiles={async (files) => {
              for (const f of files) await send(f, f.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </div>
      </div>
    </Panel>
  );
}

function EntryDetail({
  id,
  pid,
  entries,
  onClose,
  reload,
}: {
  id: string;
  pid: string;
  entries: CanonEntry[];
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const { attempt, navigate, toast, confirm } = useStudio();
  const d = useLoad(() => api.get<Detail>(`/api/m/canon/entries/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState('');
  const [attrText, setAttrText] = useState('');
  const [linkTo, setLinkTo] = useState('');
  const [relation, setRelation] = useState('');
  if (!d.data) return <Loading />;
  const { entry } = d.data;
  return (
    <Panel
      title={
        <div className="row">
          <Badge tone="warm">{CANON_TYPE_LABELS[entry.type]}</Badge>
          <h2>{entry.name}</h2>
        </div>
      }
      actions={
        <Button size="small" kind="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="stack">
        {entry.aliases.length > 0 && (
          <p className="muted small">Also called {entry.aliases.join(', ')}</p>
        )}
        {editing ? (
          <>
            <Field label="Summary">
              <textarea
                className="textarea"
                style={{ minHeight: 70 }}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </Field>
            <Field label="Details (one “key: value” per line)">
              <textarea
                className="textarea"
                style={{ minHeight: 90 }}
                value={attrText}
                onChange={(e) => setAttrText(e.target.value)}
              />
            </Field>
            <div className="row">
              <ActionButton
                kind="primary"
                onAction={() =>
                  attempt(async () => {
                    await api.put(`/api/m/canon/entries/${id}`, {
                      summary,
                      attributes: textToAttrs(attrText),
                    });
                    setEditing(false);
                    await d.reload();
                    await reload();
                  }, 'Saved')
                }
              >
                Save
              </ActionButton>
              <Button kind="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            {entry.summary && <p>{entry.summary}</p>}
            {Object.entries(entry.attributes).map(([k, v]) => (
              <div key={k} className="small">
                <strong>{k}:</strong> {v}
              </div>
            ))}
            {entry.timelineLabel && (
              <div className="small">
                <strong>When:</strong> {entry.timelineLabel}
              </div>
            )}
            {entry.type === 'promise' && (
              <div className="row">
                <Badge tone={entry.status === 'paid' ? 'ok' : 'warm'}>
                  {entry.status === 'paid' ? 'Paid off' : 'Open'}
                </Badge>
                {entry.plantedIn && (
                  <span className="small muted">Planted in {entry.plantedIn}</span>
                )}
              </div>
            )}
          </>
        )}
        <div>
          <span className="muted small">Source: {d.data.sourceTitle}</span>
          <div className="quote ref">{entry.sourceQuote}</div>
        </div>
        <h3>Relationships</h3>
        {d.data.links.map((l) => (
          <div key={l.id} className="row spread small">
            <span>
              {l.direction === 'out'
                ? `${l.relation} → ${l.otherName}`
                : `${l.otherName} → ${l.relation}`}
            </span>
            <Button
              size="small"
              kind="ghost"
              onClick={() =>
                void attempt(async () => {
                  await api.del(`/api/m/canon/links/${l.id}`);
                  await d.reload();
                }, 'Relationship removed')
              }
            >
              Remove
            </Button>
          </div>
        ))}
        <div className="row">
          <input
            className="input"
            style={{ width: 150 }}
            placeholder="sister of"
            value={relation}
            onChange={(e) => setRelation(e.target.value)}
            aria-label="Relationship"
          />
          <select
            className="select"
            style={{ width: 190 }}
            value={linkTo}
            onChange={(e) => setLinkTo(e.target.value)}
            aria-label="Related entry"
          >
            <option value="">Choose an entry</option>
            {entries
              .filter((e) => e.id !== id)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
          <ActionButton
            size="small"
            disabled={!linkTo}
            onAction={() =>
              attempt(async () => {
                await api.post('/api/m/canon/links', {
                  projectId: pid,
                  fromId: id,
                  toId: linkTo,
                  relation,
                });
                setRelation('');
                setLinkTo('');
                await d.reload();
              }, 'Relationship added')
            }
          >
            Add
          </ActionButton>
        </div>
        <h3>Mentioned in scripts</h3>
        {!d.data.mentions.length ? (
          <p className="muted small">No script mentions this yet.</p>
        ) : (
          d.data.mentions.slice(0, 12).map((m, i) => (
            <button
              key={`${m.scriptId}-${i}`}
              className="quote draft small"
              style={{ textAlign: 'left', cursor: 'pointer', color: 'inherit', border: 0 }}
              onClick={() => navigate(`/script?id=${m.scriptId}&at=${m.at}`)}
            >
              <strong>{m.title}</strong>
              {'\n'}
              {m.passage}
            </button>
          ))
        )}
        <h3>History</h3>
        {d.data.history.map((h) => (
          <div key={h.id} className="small muted">
            {new Date(h.createdAt).toLocaleString()} · {h.change}
          </div>
        ))}
        <div className="row">
          {!editing && (
            <Button
              onClick={() => {
                setSummary(entry.summary);
                setAttrText(attrsToText(entry.attributes));
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )}
          {entry.type === 'promise' && (
            <Button
              onClick={() =>
                void attempt(
                  async () => {
                    await api.put(`/api/m/canon/entries/${id}`, {
                      status: entry.status === 'paid' ? 'active' : 'paid',
                    });
                    await d.reload();
                    await reload();
                  },
                  entry.status === 'paid' ? 'Marked as open' : 'Marked as paid off',
                )
              }
            >
              {entry.status === 'paid' ? 'Mark as open again' : 'Mark as paid off'}
            </Button>
          )}
          <Button
            kind="danger"
            onClick={async () => {
              if (
                !(await confirm({
                  title: `Remove ${entry.name}?`,
                  body: 'It disappears from the canon and from continuity checks.',
                  confirmLabel: 'Remove',
                  danger: true,
                }))
              )
                return;
              let undone = false;
              onClose();
              toast(`Removing “${entry.name}”`, {
                undo: () => {
                  undone = true;
                  void reload();
                },
              });
              setTimeout(() => {
                if (!undone) void attempt(() => api.del(`/api/m/canon/entries/${id}`)).then(reload);
              }, 8000);
            }}
          >
            Remove
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function NewEntryDialog({
  pid,
  onClose,
  reload,
}: {
  pid: string;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const { attempt } = useStudio();
  const [type, setType] = useState<CanonType>('character');
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [attrText, setAttrText] = useState('');
  return (
    <Dialog title="Add a canon entry" onClose={onClose}>
      <Field label="Type">
        <select
          className="select"
          value={type}
          onChange={(e) => setType(e.target.value as CanonType)}
        >
          {CANON_TYPES.map((t) => (
            <option key={t} value={t}>
              {CANON_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Summary">
        <textarea
          className="textarea"
          style={{ minHeight: 70 }}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </Field>
      <Field label="Details (one “key: value” per line)">
        <textarea
          className="textarea"
          style={{ minHeight: 70 }}
          value={attrText}
          onChange={(e) => setAttrText(e.target.value)}
        />
      </Field>
      <ActionButton
        kind="primary"
        disabled={!name.trim()}
        onAction={() =>
          attempt(async () => {
            await api.post('/api/m/canon/entries', {
              projectId: pid,
              type,
              name,
              summary,
              attributes: textToAttrs(attrText),
            });
            await reload();
            onClose();
          }, 'Added to the canon')
        }
      >
        Add entry
      </ActionButton>
    </Dialog>
  );
}

function Graph({ pid, onOpen }: { pid: string; onOpen: (id: string) => void }) {
  const g = useLoad(
    () =>
      api.get<{ nodes: { id: string; name: string; type: string }[]; edges: CanonLink[] }>(
        `/api/m/canon/graph?projectId=${pid}`,
      ),
    [pid],
  );
  const layout = useMemo(() => {
    const nodes = g.data?.nodes ?? [];
    const r = Math.max(140, nodes.length * 22);
    const cx = r + 120;
    const cy = r + 50;
    return {
      w: cx * 2,
      h: cy * 2,
      pos: new Map(
        nodes.map((n, i) => [
          n.id,
          {
            x: cx + r * Math.cos((2 * Math.PI * i) / nodes.length - Math.PI / 2),
            y: cy + r * Math.sin((2 * Math.PI * i) / nodes.length - Math.PI / 2),
          },
        ]),
      ),
    };
  }, [g.data]);
  if (!g.data) return <Loading />;
  if (!g.data.nodes.length)
    return (
      <EmptyState
        title="No characters yet"
        body="Approve characters and add relationships to see them connected here."
      />
    );
  return (
    <Panel className="graph" title="Relationships between characters">
      <svg
        viewBox={`0 0 ${layout.w} ${layout.h}`}
        role="img"
        aria-label="Relationship graph of characters"
      >
        {g.data.edges.map((e) => {
          const a = layout.pos.get(e.fromId);
          const b = layout.pos.get(e.toId);
          if (!a || !b) return null;
          return (
            <g key={e.id}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="rgba(255,255,255,0.28)"
                strokeWidth={1.5}
              />
              <text
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2 - 4}
                fill="#c9c3b9"
                fontSize={11}
                textAnchor="middle"
              >
                {e.relation}
              </text>
            </g>
          );
        })}
        {g.data.nodes.map((n) => {
          const p = layout.pos.get(n.id);
          if (!p) return null;
          return (
            <g
              key={n.id}
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer' }}
              onClick={() => onOpen(n.id)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(n.id)}
              aria-label={`Open ${n.name}`}
            >
              <circle cx={p.x} cy={p.y} r={9} fill={n.type === 'faction' ? '#6fc8db' : '#f2a650'} />
              <text x={p.x} y={p.y + 24} fill="#efe9df" fontSize={13} textAnchor="middle">
                {n.name}
              </text>
            </g>
          );
        })}
      </svg>
    </Panel>
  );
}

function Page() {
  const { route, navigate, activeProjectId: pid, project, attempt } = useStudio();
  const tab: Tab = (route.query.get('tab') as Tab | null) ?? 'entries';
  const [selected, setSelected] = useState<string | null>(route.query.get('entry'));
  const [filter, setFilter] = useState<CanonType | 'all'>('all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const entries = useLoad(
    () => api.get<{ entries: CanonEntry[] }>(`/api/m/canon/entries?projectId=${pid}`),
    [pid],
  );
  const proposals = useLoad(
    () => api.get<{ proposals: Proposal[] }>(`/api/m/canon/proposals?projectId=${pid}`),
    [pid, tab],
  );
  const timeline = useLoad(
    () => api.get<{ events: CanonEntry[] }>(`/api/m/canon/timeline?projectId=${pid}`),
    [pid, tab],
  );
  const promises = useLoad(
    () => api.get<{ promises: CanonEntry[] }>(`/api/m/canon/promises?projectId=${pid}`),
    [pid, tab],
  );
  useServerEvents(['job', 'ledger'], () => {
    void proposals.reload();
    void entries.reload();
  });
  const pending = proposals.data?.proposals.length ?? 0;
  const go = (t: Tab) => {
    navigate(`/canon?tab=${t}`, { replace: true });
  };
  const list = (entries.data?.entries ?? []).filter(
    (e) =>
      (filter === 'all' || e.type === filter) &&
      (!q ||
        `${e.name} ${e.summary} ${e.aliases.join(' ')}`.toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <div className="page">
      <PageHeader
        eyebrow={project ? project.name : 'Scratchpad vault (no project open)'}
        title="Canon Vault"
        tagline="Your story bible. Every entry keeps the exact passage it came from."
        primary={
          pending ? (
            <Button kind="primary" onClick={() => go('review')}>
              Review {pending} proposal{pending === 1 ? '' : 's'}
            </Button>
          ) : (
            <Button kind="primary" onClick={() => go('import')}>
              Import material
            </Button>
          )
        }
        menu={[
          { label: 'Add an entry by hand', onSelect: () => setAdding(true) },
          {
            label: 'Export as Markdown',
            onSelect: () =>
              void attempt(() =>
                downloadFrom(`/api/m/canon/export.md?projectId=${pid}`, 'story-bible.md'),
              ),
          },
          {
            label: 'Export as JSON',
            onSelect: () =>
              void attempt(() =>
                downloadFrom(`/api/m/canon/export.json?projectId=${pid}`, 'story-bible.json'),
              ),
          },
        ]}
      />
      <Tabs
        label="Canon Vault sections"
        value={tab}
        onChange={go}
        tabs={[
          { id: 'entries', label: `Entries (${entries.data?.entries.length ?? 0})` },
          { id: 'review', label: `Review (${pending})` },
          { id: 'import', label: 'Import' },
          { id: 'timeline', label: 'Timeline' },
          { id: 'graph', label: 'Relationships' },
          { id: 'promises', label: 'Open promises' },
        ]}
      />
      {tab === 'entries' && (
        <div className={selected ? 'grid two' : 'stack'}>
          <div className="stack">
            <div className="row">
              <input
                className="input"
                style={{ maxWidth: 260 }}
                placeholder="Find an entry"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Find an entry"
              />
              <select
                className="select"
                style={{ width: 200 }}
                value={filter}
                onChange={(e) => setFilter(e.target.value as CanonType | 'all')}
                aria-label="Filter by type"
              >
                <option value="all">All types</option>
                {CANON_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CANON_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            {!entries.data ? (
              <Loading />
            ) : !entries.data.entries.length ? (
              <EmptyState
                title="Your canon is empty"
                body="Paste an episode to build your canon. You approve every entry."
                action={<Button onClick={() => go('import')}>Paste an episode</Button>}
              />
            ) : (
              <div className="list">
                {list.map((e) => (
                  <div
                    key={e.id}
                    className={`list-item clickable ${selected === e.id ? 'selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(e.id)}
                    onKeyDown={(ev) => ev.key === 'Enter' && setSelected(e.id)}
                  >
                    <div className="stack tight">
                      <strong>{e.name}</strong>
                      <span className="muted small">{e.summary.slice(0, 110)}</span>
                    </div>
                    <Badge>{CANON_TYPE_LABELS[e.type]}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
          {selected && (
            <EntryDetail
              key={selected}
              id={selected}
              pid={pid}
              entries={entries.data?.entries ?? []}
              onClose={() => setSelected(null)}
              reload={entries.reload}
            />
          )}
        </div>
      )}
      {tab === 'review' && <Review pid={pid} />}
      {tab === 'import' && <ImportTab pid={pid} />}
      {tab === 'timeline' &&
        (!timeline.data ? (
          <Loading />
        ) : !timeline.data.events.length ? (
          <EmptyState
            title="No timeline events yet"
            body="Timeline events from your imports appear here in in-world order."
          />
        ) : (
          <Panel title="Timeline (in-world order)">
            <div className="timeline">
              {timeline.data.events.map((e) => (
                <div key={e.id} className="timeline-item">
                  <button
                    className="btn ghost small"
                    onClick={() => {
                      setSelected(e.id);
                      go('entries');
                    }}
                  >
                    {e.name}
                  </button>
                  <div className="small muted">{e.timelineLabel || 'Time not stated'}</div>
                  <div className="small">{e.summary}</div>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      {tab === 'graph' && (
        <Graph
          pid={pid}
          onOpen={(id) => {
            setSelected(id);
            go('entries');
          }}
        />
      )}
      {tab === 'promises' &&
        (!promises.data ? (
          <Loading />
        ) : !promises.data.promises.length ? (
          <EmptyState
            title="No open promises"
            body="Setups you plant for the audience appear here until they pay off."
          />
        ) : (
          <div className="list">
            {promises.data.promises.map((p) => (
              <div key={p.id} className="list-item">
                <div className="stack tight">
                  <strong>{p.name}</strong>
                  <span className="small">{p.summary}</span>
                  <span className="muted small">
                    Planted in {p.plantedIn || 'an earlier episode'}
                  </span>
                </div>
                <div className="row">
                  <Badge tone={p.status === 'paid' ? 'ok' : 'warm'}>
                    {p.status === 'paid' ? 'Paid off' : 'Open'}
                  </Badge>
                  <ActionButton
                    size="small"
                    onAction={() =>
                      attempt(async () => {
                        await api.put(`/api/m/canon/entries/${p.id}`, {
                          status: p.status === 'paid' ? 'active' : 'paid',
                        });
                        await promises.reload();
                      })
                    }
                  >
                    {p.status === 'paid' ? 'Reopen' : 'Mark paid off'}
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        ))}
      {adding && (
        <NewEntryDialog pid={pid} onClose={() => setAdding(false)} reload={entries.reload} />
      )}
    </div>
  );
}

const ui: ModuleUi = { manifest, Page };
export default ui;
