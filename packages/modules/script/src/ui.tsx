import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CANON_TYPE_LABELS,
  scriptStats,
  type CanonType,
  type ScriptStats,
} from '@kathix/kernel/shared';
import type { Project, Script, ScriptVersion, Suggestion, VoiceProfile } from '@kathix/store';
import {
  ActionButton,
  Badge,
  Button,
  Dialog,
  DiffView,
  EmptyState,
  Field,
  Loading,
  PageHeader,
  Panel,
  SuggestionCard,
  Switch,
  api,
  downloadFrom,
  streamPost,
  useLoad,
  useStudio,
  type ModuleUi,
} from '@kathix/ui';
import { ScriptEditor, refreshAiMarks, type EditorHandle } from './editor';
import { manifest } from './manifest';

interface Detail {
  script: Script;
  project: Project;
  version: ScriptVersion | null;
  stats: ScriptStats;
}
interface ContextEntry {
  id: string;
  name: string;
  type: CanonType;
  summary: string;
  attributes: Record<string, string>;
  why: string[];
}
interface VersionRow {
  id: string;
  seq: number;
  source: string;
  note: string;
  createdAt: string;
}

const ACTIONS: { id: string; label: string; needsSelection: boolean }[] = [
  { id: 'continue', label: 'Continue', needsSelection: false },
  { id: 'rewrite', label: 'Rewrite', needsSelection: true },
  { id: 'tighten', label: 'Tighten', needsSelection: true },
  { id: 'expand', label: 'Expand', needsSelection: true },
  { id: 'alternatives', label: 'Three alternatives', needsSelection: true },
  { id: 'punchup', label: 'Punch up dialogue', needsSelection: true },
];

function NewScriptDialog({ onClose }: { onClose: () => void }) {
  const { attempt, navigate, activeProjectId } = useStudio();
  const [title, setTitle] = useState('');
  const [episode, setEpisode] = useState('');
  const [text, setText] = useState('');
  return (
    <Dialog title="Start a new script" onClose={onClose}>
      <Field label="Title">
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Episode 5: ..."
        />
      </Field>
      <Field label="Episode number (optional)">
        <input
          className="input"
          type="number"
          min={1}
          value={episode}
          onChange={(e) => setEpisode(e.target.value)}
        />
      </Field>
      <Field label="Starting text (optional)">
        <textarea
          className="textarea script"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste an existing draft, or leave empty"
        />
      </Field>
      <ActionButton
        kind="primary"
        disabled={!title.trim()}
        onAction={async () => {
          const r = await attempt(() =>
            api.post<{ script: Script }>('/api/m/script/scripts', {
              projectId: activeProjectId,
              title,
              episode: episode ? Number(episode) : null,
              text,
            }),
          );
          if (r) navigate(`/script?id=${r.script.id}`);
        }}
      >
        Create script
      </ActionButton>
    </Dialog>
  );
}

function VersionsDialog({
  scriptId,
  currentText,
  onClose,
  onRestored,
}: {
  scriptId: string;
  currentText: string;
  onClose: () => void;
  onRestored: (v: ScriptVersion) => void;
}) {
  const { attempt, toast } = useStudio();
  const list = useLoad(
    () => api.get<{ versions: VersionRow[] }>(`/api/m/script/scripts/${scriptId}/versions`),
    [scriptId],
  );
  const [picked, setPicked] = useState<ScriptVersion | null>(null);
  return (
    <Dialog title="Version history" onClose={onClose} wide>
      <div className="grid two">
        <div className="list" style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {(list.data?.versions ?? []).map((v) => (
            <div
              key={v.id}
              className={`list-item clickable ${picked?.id === v.id ? 'selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() =>
                void attempt(async () =>
                  setPicked(
                    (
                      await api.get<{ version: ScriptVersion }>(
                        `/api/m/script/scripts/${scriptId}/versions/${v.id}`,
                      )
                    ).version,
                  ),
                )
              }
            >
              <div className="stack tight">
                <strong>Version {v.seq}</strong>
                <span className="muted small">
                  {new Date(v.createdAt).toLocaleString()} · {v.note || v.source}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="stack">
          {!picked ? (
            <p className="muted">Choose a version to compare it with the current text.</p>
          ) : (
            <>
              <p className="small muted">Changes from version {picked.seq} to now</p>
              <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
                <DiffView before={picked.text} after={currentText} />
              </div>
              <ActionButton
                kind="primary"
                onAction={async () => {
                  const r = await attempt(() =>
                    api.post<{ version: ScriptVersion }>(
                      `/api/m/script/scripts/${scriptId}/versions/${picked.id}/restore`,
                    ),
                  );
                  if (r) {
                    onRestored(r.version);
                    toast(`Restored version ${picked.seq}. The previous text is kept in history.`);
                    onClose();
                  }
                }}
              >
                Restore version {picked.seq}
              </ActionButton>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function CoWriter({
  scriptId,
  selection,
  flush,
  onApplied,
  hasCanon,
  project,
}: {
  scriptId: string;
  selection: { from: number; to: number };
  flush: () => Promise<void>;
  onApplied: (v: ScriptVersion, from: number, len: number) => void;
  hasCanon: boolean;
  project: Project;
}) {
  const { attempt, toast, has, reloadProjects } = useStudio();
  const [coachMode, setCoachMode] = useState(false);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [note, setNote] = useState('');
  const [tone, setTone] = useState('');
  const [notEnough, setNotEnough] = useState(false);
  const [coach, setCoach] = useState<{
    questions: { question: string; quote: string }[];
    weakBeats: { quote: string; why: string }[];
  } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const profiles = useLoad(
    () =>
      api
        .get<{ profiles: VoiceProfile[] }>(`/api/m/voice/profiles?projectId=${project.id}`)
        .catch(() => ({ profiles: [] })),
    [project.id],
  );
  const hasSelection = selection.to > selection.from;

  const run = async (action: string, instruction = '') => {
    await flush();
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setSuggestions([]);
    setNotEnough(false);
    setStreaming('');
    const res = await attempt(() =>
      streamPost<{ suggestions: Suggestion[]; notEnoughInformation: boolean }>(
        `/api/m/script/scripts/${scriptId}/suggest`,
        { action, instruction, from: selection.from, to: selection.to, count: 3 },
        {
          signal: ctrl.signal,
          onDelta: (t) => setStreaming(t),
          onReset: () => setStreaming(''),
        },
      ),
    );
    setStreaming(null);
    if (res) {
      setSuggestions(res.suggestions);
      setNotEnough(res.notEnoughInformation);
    }
  };

  const setSetting = (settings: Partial<Project['settings']>) =>
    attempt(async () => {
      await api.put(`/api/m/home/projects/${project.id}`, { settings });
      await reloadProjects();
    });

  if (!has('model.structured')) return null;
  return (
    <Panel title="Co-writer" variant="flat">
      <div className="stack">
        <Switch
          label="Coach mode: questions only, no writing"
          checked={coachMode}
          onChange={(v) => {
            setCoachMode(v);
            setSuggestions([]);
            setCoach(null);
          }}
        />
        {(profiles.data?.profiles.length ?? 0) > 0 && !project.isScratch && (
          <div className="stack tight">
            <Switch
              label="Write in my voice"
              checked={Boolean(project.settings.voiceConditioning)}
              onChange={(v) =>
                void setSetting({
                  voiceConditioning: v,
                  activeVoiceProfileId:
                    project.settings.activeVoiceProfileId ?? profiles.data?.profiles[0]?.id ?? null,
                })
              }
            />
            {project.settings.voiceConditioning && (
              <select
                className="select"
                aria-label="Voice profile"
                value={project.settings.activeVoiceProfileId ?? ''}
                onChange={(e) => void setSetting({ activeVoiceProfileId: e.target.value })}
              >
                {profiles.data?.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {has('model.custom.adaption') && !project.isScratch && (
          <Switch
            label="Write with my Adaption voice model"
            checked={Boolean(project.settings.useAdaptionWriter)}
            onChange={(v) => void setSetting({ useAdaptionWriter: v })}
          />
        )}
        {coachMode ? (
          <>
            <p className="muted small">
              The coach reads {hasSelection ? 'your selection' : 'the scene around your cursor'} and
              asks questions. It writes nothing.
            </p>
            <ActionButton
              kind="ai"
              busyLabel="Reading"
              onAction={async () => {
                await flush();
                const r = await attempt(() =>
                  api.post<typeof coach>(`/api/m/script/scripts/${scriptId}/coach`, selection),
                );
                if (r) setCoach(r);
              }}
            >
              Ask the coach
            </ActionButton>
            {coach && (
              <div className="stack">
                {coach.questions.map((q, i) => (
                  <div key={i} className="panel ai stack tight">
                    <strong>{q.question}</strong>
                    <span className="quote small">{q.quote}</span>
                  </div>
                ))}
                {coach.weakBeats.map((w, i) => (
                  <div key={`w${i}`} className="panel ai stack tight">
                    <Badge tone="medium">Weak beat</Badge>
                    <span className="quote small">{w.quote}</span>
                    <span className="small">{w.why}</span>
                  </div>
                ))}
                {!coach.questions.length && !coach.weakBeats.length && (
                  <p className="muted small">The coach had no questions about this passage.</p>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="muted small">
              {hasSelection
                ? `${selection.to - selection.from} characters selected.`
                : 'Select a passage to rewrite it, or place the cursor to continue.'}
            </p>
            <div className="row">
              {ACTIONS.filter((a) => !a.needsSelection || hasSelection).map((a) => (
                <ActionButton
                  key={a.id}
                  kind="ai"
                  size="small"
                  disabled={streaming !== null}
                  onAction={() => run(a.id)}
                >
                  {a.label}
                </ActionButton>
              ))}
            </div>
            {hasSelection && (
              <div className="row">
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 120 }}
                  placeholder="Tone, e.g. warmer"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  aria-label="Tone to change to"
                />
                <ActionButton
                  kind="ai"
                  size="small"
                  disabled={!tone.trim() || streaming !== null}
                  onAction={() => run('tone', tone)}
                >
                  Change tone
                </ActionButton>
              </div>
            )}
            <div className="row">
              <input
                className="input"
                style={{ flex: 1, minWidth: 120 }}
                placeholder="Tell the co-writer what to do"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Instruction for the co-writer"
              />
              <ActionButton
                kind="ai"
                size="small"
                disabled={!note.trim() || streaming !== null}
                onAction={() => run('instruction', note)}
              >
                Ask
              </ActionButton>
            </div>
          </>
        )}
        {streaming !== null && (
          <div className="panel ai stack tight" aria-live="polite">
            <span className="muted small">Writing a suggestion…</span>
            <div className="streaming">{streaming}</div>
            <Button
              size="small"
              kind="ghost"
              onClick={() => {
                abort.current?.abort();
                setStreaming(null);
              }}
            >
              Stop
            </Button>
          </div>
        )}
        {notEnough && (
          <p className="small" role="status">
            The co-writer said your script and canon do not give it enough to go on; treat this as a
            rough attempt.
          </p>
        )}
        {suggestions.map((s) => (
          <SuggestionCard
            key={s.id}
            suggestion={s}
            emptyEvidence={
              hasCanon
                ? 'This suggestion relied on no canon entries.'
                : 'Your canon is empty, so this suggestion uses only your script.'
            }
            onAccept={async (finalText, edited) => {
              const r = await attempt(() =>
                api.post<{ version: ScriptVersion }>(`/api/m/script/suggestions/${s.id}/accept`, {
                  finalText,
                  edited,
                }),
              );
              if (r) {
                onApplied(r.version, s.rangeStart, finalText.length);
                setSuggestions([]);
                toast(
                  edited
                    ? 'Your edited version is in the script'
                    : 'Suggestion added to the script',
                );
              }
            }}
            onReject={async (reason) => {
              const r = await attempt(() =>
                api.post(`/api/m/script/suggestions/${s.id}/reject`, { reason }),
              );
              if (r) setSuggestions((list) => list.filter((x) => x.id !== s.id));
            }}
          />
        ))}
      </div>
    </Panel>
  );
}

function StudioView({ id }: { id: string }) {
  const { attempt, navigate, route, toast, confirm, has } = useStudio();
  const detail = useLoad(() => api.get<Detail>(`/api/m/script/scripts/${id}`), [id]);
  const handle = useRef<EditorHandle | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [stats, setStats] = useState<ScriptStats | null>(null);
  const [selection, setSelection] = useState({ from: 0, to: 0 });
  const [context, setContext] = useState<ContextEntry[]>([]);
  const [showAi, setShowAi] = useState(true);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePromise = useRef<Promise<void> | null>(null);
  const project = detail.data?.project;

  const save = useCallback(async () => {
    if (!handle.current) return;
    const text = handle.current.view.state.doc.toString();
    const authorship = handle.current.getSpans();
    setSaveState('saving');
    try {
      await api.put(`/api/m/script/scripts/${id}/text`, { text, authorship });
      setSaveState('saved');
    } catch (err) {
      setSaveState('unsaved');
      toast(err instanceof Error ? `Not saved yet: ${err.message}` : 'Not saved yet.', {
        error: true,
      });
    }
  }, [id, toast]);

  const flush = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      savePromise.current = save();
    }
    await savePromise.current;
  }, [save]);

  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        void save();
      }
    },
    [save],
  );

  useEffect(() => {
    if (detail.data) setStats(detail.data.stats);
  }, [detail.data]);

  const onChange = () => {
    setSaveState('unsaved');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      savePromise.current = save();
    }, 700);
    if (statsTimer.current) clearTimeout(statsTimer.current);
    statsTimer.current = setTimeout(
      () =>
        project &&
        handle.current &&
        setStats(scriptStats(handle.current.view.state.doc.toString(), project.type)),
      400,
    );
  };

  // Selection state and canon context update shortly after the cursor settles, not on every keystroke.
  const onSelection = (from: number, to: number) => {
    if (selTimer.current) clearTimeout(selTimer.current);
    selTimer.current = setTimeout(() => setSelection({ from, to }), 120);
    if (ctxTimer.current) clearTimeout(ctxTimer.current);
    ctxTimer.current = setTimeout(async () => {
      await flush();
      try {
        setContext(
          (
            await api.get<{ entries: ContextEntry[] }>(
              `/api/m/script/scripts/${id}/context?from=${from}&to=${to}`,
            )
          ).entries,
        );
      } catch {
        setContext([]);
      }
    }, 650);
  };

  const onReady = (h: EditorHandle) => {
    handle.current = h;
    const at = Number(route.query.get('at'));
    if (route.query.has('at') && !Number.isNaN(at)) {
      const line = h.view.state.doc.lineAt(Math.min(at, h.view.state.doc.length));
      h.flash(line.from, line.to);
    }
  };

  if (detail.error)
    return (
      <EmptyState
        title="This script could not be opened"
        body={detail.error}
        action={<Button onClick={() => navigate('/script')}>Back to scripts</Button>}
      />
    );
  if (!detail.data || !project) return <Loading />;
  const d = detail.data;
  const reloadFromVersion = (v: ScriptVersion, flashFrom?: number, flashLen?: number) => {
    handle.current?.load(v.text, v.authorship);
    setStats(scriptStats(v.text, project.type));
    setSaveState('saved');
    if (handle.current && flashFrom !== undefined && flashLen)
      handle.current.flash(flashFrom, flashFrom + flashLen);
  };
  const exportAs = (format: string, ext: string) =>
    void attempt(() =>
      downloadFrom(
        `/api/m/script/scripts/${id}/export?format=${format}`,
        `${d.script.title}.${ext}`,
      ),
    );
  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <PageHeader
        eyebrow={project.isScratch ? 'Scratchpad (no project open)' : project.name}
        title={d.script.title}
        tagline={
          stats ? (
            <span>
              {stats.words} words · {stats.scenes} scenes · about {stats.runtimeMinutes} min{' '}
              {stats.runtimeLabel} ·{' '}
              <span role="status">
                {saveState === 'saved'
                  ? 'Saved'
                  : saveState === 'saving'
                    ? 'Saving…'
                    : 'Unsaved changes'}
              </span>
            </span>
          ) : undefined
        }
        primary={
          has('model.structured') ? (
            <Button
              kind="primary"
              onClick={async () => {
                await flush();
                navigate(`/continuity?script=${id}`);
              }}
            >
              Check continuity
            </Button>
          ) : undefined
        }
        menu={[
          {
            label: 'Version history',
            onSelect: async () => {
              await flush();
              setVersionsOpen(true);
            },
          },
          ...(has('store.ready')
            ? [
                {
                  label: 'Check voice match',
                  onSelect: async () => {
                    await flush();
                    navigate(`/voice?script=${id}`);
                  },
                },
              ]
            : []),
          {
            label: 'Show authorship',
            onSelect: async () => {
              await flush();
              navigate(`/ledger?script=${id}`);
            },
          },
          {
            label: 'Rename',
            onSelect: () => {
              setTitle(d.script.title);
              setRenaming(true);
            },
          },
          {
            label: 'Export as Markdown',
            onSelect: async () => {
              await flush();
              exportAs('md', 'md');
            },
          },
          {
            label: 'Export as plain text',
            onSelect: async () => {
              await flush();
              exportAs('txt', 'txt');
            },
          },
          {
            label: 'Export as Word (.docx)',
            onSelect: async () => {
              await flush();
              exportAs('docx', 'docx');
            },
          },
          {
            label: 'Delete script',
            danger: true,
            onSelect: async () => {
              if (
                !(await confirm({
                  title: `Delete ${d.script.title}?`,
                  body: 'The script and its version history are removed.',
                  confirmLabel: 'Delete',
                  danger: true,
                }))
              )
                return;
              await flush();
              let undone = false;
              navigate('/script');
              toast(`Deleting “${d.script.title}”`, {
                undo: () => {
                  undone = true;
                  navigate(`/script?id=${id}`);
                },
              });
              setTimeout(() => {
                if (!undone) void attempt(() => api.del(`/api/m/script/scripts/${id}`));
              }, 8000);
            },
          },
        ]}
      />
      <div className="editor-wrap">
        <ScriptEditor
          initialText={d.version?.text ?? ''}
          initialSpans={d.version?.authorship ?? []}
          showAi={showAi}
          onChange={onChange}
          onSelection={onSelection}
          onReady={onReady}
        />
        <aside className="side" aria-label="Writing tools">
          <Panel variant="flat">
            <Switch
              label="Highlight AI-written text"
              checked={showAi}
              onChange={(v) => {
                setShowAi(v);
                if (handle.current)
                  setTimeout(() => handle.current && refreshAiMarks(handle.current, v), 0);
              }}
            />
          </Panel>
          <CoWriter
            scriptId={id}
            selection={selection}
            flush={flush}
            hasCanon={context.length > 0}
            project={project}
            onApplied={(v, from, len) => reloadFromVersion(v, from, len)}
          />
          <Panel title="Canon for this passage" variant="flat">
            {!context.length ? (
              <p className="muted small">
                Entries relevant to the paragraph you are writing appear here as you move the
                cursor.
              </p>
            ) : (
              <div className="stack">
                {context.map((c) => (
                  <button
                    key={c.id}
                    className="quote ref small"
                    style={{ textAlign: 'left', cursor: 'pointer', color: 'inherit', border: 0 }}
                    onClick={() => navigate(`/canon?entry=${c.id}`)}
                  >
                    <strong>{c.name}</strong>{' '}
                    <span className="muted">· {CANON_TYPE_LABELS[c.type]}</span>
                    {'\n'}
                    {c.summary}
                    {Object.entries(c.attributes)
                      .slice(0, 3)
                      .map(([k, v]) => `\n${k}: ${v}`)
                      .join('')}
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </aside>
      </div>
      {versionsOpen && handle.current && (
        <VersionsDialog
          scriptId={id}
          currentText={handle.current.view.state.doc.toString()}
          onClose={() => setVersionsOpen(false)}
          onRestored={(v) => reloadFromVersion(v)}
        />
      )}
      {renaming && (
        <Dialog title="Rename script" onClose={() => setRenaming(false)}>
          <Field label="Title">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <ActionButton
            kind="primary"
            disabled={!title.trim()}
            onAction={() =>
              attempt(async () => {
                await api.put(`/api/m/script/scripts/${id}`, { title: title.trim() });
                await detail.reload();
                setRenaming(false);
              }, 'Renamed')
            }
          >
            Save
          </ActionButton>
        </Dialog>
      )}
    </div>
  );
}

function ScriptList() {
  const { activeProjectId, project, navigate } = useStudio();
  const list = useLoad(
    () =>
      api.get<{ scripts: (Script & { stats: ScriptStats })[] }>(
        `/api/m/script/scripts?projectId=${activeProjectId}`,
      ),
    [activeProjectId],
  );
  return (
    <div className="page">
      <PageHeader
        eyebrow={project ? project.name : 'Scratchpad (no project open)'}
        title="Script Studio"
        tagline="Your co-writer proposes; nothing enters a script unless you accept it."
        primary={
          <Button kind="primary" onClick={() => navigate('/script?new=1')}>
            Start a new script
          </Button>
        }
      />
      {!list.data ? (
        <Loading />
      ) : !list.data.scripts.length ? (
        <EmptyState
          title="No scripts here yet"
          body="Start a script, or paste an existing draft to keep working on it."
          action={<Button onClick={() => navigate('/script?new=1')}>Start a new script</Button>}
        />
      ) : (
        <div className="list">
          {list.data.scripts.map((s) => (
            <div
              key={s.id}
              className="list-item clickable"
              role="link"
              tabIndex={0}
              onClick={() => navigate(`/script?id=${s.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/script?id=${s.id}`)}
            >
              <div className="stack tight">
                <strong>{s.title}</strong>
                <span className="muted small">
                  {s.stats.words} words · {s.stats.scenes} scenes · {s.stats.runtimeMinutes} min
                </span>
              </div>
              <span className="muted small">
                Edited {new Date(s.updatedAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Page() {
  const { route, navigate } = useStudio();
  const id = route.query.get('id');
  return (
    <>
      {id ? <StudioView key={id} id={id} /> : <ScriptList />}
      {route.query.get('new') === '1' && (
        <NewScriptDialog onClose={() => navigate('/script', { replace: true })} />
      )}
    </>
  );
}

const ui: ModuleUi = { manifest, Page };
export default ui;
