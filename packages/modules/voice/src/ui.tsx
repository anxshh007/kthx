import { useEffect, useState } from 'react';
import type { Script, ScriptVersion, VoiceProfile } from '@kathix/store';
import {
  ActionButton,
  Badge,
  Button,
  DiffView,
  EmptyState,
  Field,
  FileButton,
  Loading,
  Meter,
  PageHeader,
  Panel,
  Tabs,
  api,
  downloadFrom,
  useLoad,
  useStudio,
  type ModuleUi,
} from '@kathix/ui';
import { manifest } from './manifest';
import type { DriftLine, MatchBreakdown, VoiceMetrics } from './metrics';

type Profile = VoiceProfile & { samples: { id: string; title: string; words: number }[] };
type MatchResult = MatchBreakdown & { lines: DriftLine[]; driftCount: number; draftWords: number };
interface Rewrite {
  index: number;
  original: string;
  text: string;
  reason: string;
}

function MetricsView({ m }: { m: VoiceMetrics }) {
  return (
    <div className="grid three">
      <div className="stat">
        <span className="value">{m.sentenceLength.mean}</span>
        <span className="label">words per sentence (±{m.sentenceLength.sd})</span>
      </div>
      <div className="stat">
        <span className="value">{m.pointOfView.dominant}</span>
        <span className="label">point of view</span>
      </div>
      <div className="stat">
        <span className="value">{m.readingGrade}</span>
        <span className="label">reading grade</span>
      </div>
      <div className="stat">
        <span className="value">{m.vocabularyRichness}</span>
        <span className="label">vocabulary richness</span>
      </div>
      <div className="stat">
        <span className="value">{Math.round(m.pacing.shortSentenceShare * 100)}%</span>
        <span className="label">short sentences</span>
      </div>
      <div className="stat">
        <span className="value">{m.contractionsPer1000}</span>
        <span className="label">contractions per 1000 words</span>
      </div>
      <Panel variant="flat" title="Sentence lengths">
        {m.sentenceLength.histogram.map((h) => (
          <div key={h.label} className="row small" style={{ flexWrap: 'nowrap' }}>
            <span style={{ width: 48 }}>{h.label}</span>
            <div style={{ flex: 1 }}>
              <Meter value={h.share * 100} label={`${h.label} word sentences`} />
            </div>
            <span style={{ width: 36 }}>{Math.round(h.share * 100)}%</span>
          </div>
        ))}
      </Panel>
      <Panel variant="flat" title="Punctuation per 1000 words">
        {Object.entries(m.punctuationPer1000).map(([k, v]) => (
          <div key={k} className="row spread small">
            <span>{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </Panel>
      <Panel variant="flat" title="Signature phrases">
        {m.signaturePhrases.length ? (
          m.signaturePhrases.map((s) => (
            <Badge key={s.phrase}>
              {s.phrase} ×{s.count}
            </Badge>
          ))
        ) : (
          <span className="muted small">None recurring yet.</span>
        )}
      </Panel>
    </div>
  );
}

function Results({
  r,
  rewrites,
  onRewrite,
  onAccept,
}: {
  r: MatchResult;
  rewrites: Rewrite[] | null;
  onRewrite?: () => Promise<unknown>;
  onAccept: (rw: Rewrite) => Promise<unknown>;
}) {
  const { has } = useStudio();
  return (
    <div className="stack">
      <Panel>
        <div className="row spread">
          <div className="stat">
            <span className="value">{r.score}/100</span>
            <span className="label">voice match</span>
          </div>
          <Badge tone={r.driftCount ? 'medium' : 'ok'}>
            {r.driftCount} drifting line{r.driftCount === 1 ? '' : 's'}
          </Badge>
        </div>
        <table className="data" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Feature</th>
              <th>You</th>
              <th>This draft</th>
              <th>Match</th>
            </tr>
          </thead>
          <tbody>
            {r.features.map((f) => (
              <tr key={f.label}>
                <td>{f.label}</td>
                <td>{f.profile}</td>
                <td>{f.draft}</td>
                <td style={{ width: 120 }}>
                  <Meter value={f.similarity * 100} label={`${f.label} match`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel
        title="Line by line"
        actions={
          onRewrite && r.driftCount > 0 && has('model.structured') ? (
            <ActionButton kind="ai" busyLabel="Writing rewrites" onAction={onRewrite}>
              Suggest rewrites for drifting lines
            </ActionButton>
          ) : undefined
        }
      >
        <div className="stack tight">
          {r.lines.map((l) => {
            const rw = rewrites?.find((x) => x.index === l.index);
            return (
              <div key={l.index} className="stack tight">
                <div className={`drift-line ${l.drift ? 'drift' : 'ok'}`}>
                  {l.text}
                  {l.drift && (
                    <div
                      className="small"
                      style={{ color: 'var(--danger)', fontFamily: 'var(--ui-font)' }}
                    >
                      {l.reasons.join('; ')}
                    </div>
                  )}
                </div>
                {rw && (
                  <div className="panel ai stack tight">
                    <Badge tone="ai">Suggested rewrite</Badge>
                    <DiffView before={rw.original} after={rw.text} />
                    <span className="small">
                      <strong>Why: </strong>
                      {rw.reason}
                    </span>
                    <div className="row">
                      <ActionButton kind="primary" size="small" onAction={() => onAccept(rw)}>
                        Accept rewrite
                      </ActionButton>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {rewrites && !rewrites.length && (
          <p className="muted small">The model kept every line as it was.</p>
        )}
      </Panel>
    </div>
  );
}

function ProjectMatch({ projectId }: { projectId: string }) {
  const { route, attempt, toast, navigate } = useStudio();
  const profiles = useLoad(
    () => api.get<{ profiles: Profile[] }>(`/api/m/voice/profiles?projectId=${projectId}`),
    [projectId],
  );
  const scripts = useLoad(
    () => api.get<{ scripts: Script[] }>(`/api/m/script/scripts?projectId=${projectId}`),
    [projectId],
  );
  const [profileId, setProfileId] = useState('');
  const [scriptId, setScriptId] = useState(route.query.get('script') ?? '');
  const [text, setText] = useState('');
  const [result, setResult] = useState<MatchResult | null>(null);
  const [rewrites, setRewrites] = useState<Rewrite[] | null>(null);
  useEffect(() => {
    if (!profileId && profiles.data?.profiles[0])
      setProfileId(
        profiles.data.profiles.find((p) => p.metrics)?.id ?? profiles.data.profiles[0].id,
      );
  }, [profiles.data]);
  useEffect(() => {
    if (!scriptId) return;
    void api
      .get<{ version: ScriptVersion | null }>(`/api/m/script/scripts/${scriptId}`)
      .then((d) => setText(d.version?.text ?? ''))
      .catch(() => setText(''));
  }, [scriptId]);
  if (!profiles.data || !scripts.data) return <Loading />;
  if (!profiles.data.profiles.length) {
    return (
      <EmptyState
        title="No voice profile yet"
        body="Add samples of your own past writing to build one."
        action={
          <Button onClick={() => navigate('/voice?tab=profiles')}>Create a voice profile</Button>
        }
      />
    );
  }
  const score = async () => {
    const r = await attempt(() =>
      api.post<MatchResult>(`/api/m/voice/profiles/${profileId}/match`, { text }),
    );
    if (r) {
      setResult(r);
      setRewrites(null);
    }
  };
  return (
    <div className="stack">
      <Panel variant="flat">
        <div className="grid two">
          <Field label="Voice profile">
            <select
              className="select"
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
            >
              {profiles.data.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.metrics ? '' : ' (no samples yet)'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Draft">
            <select
              className="select"
              value={scriptId}
              onChange={(e) => setScriptId(e.target.value)}
            >
              <option value="">Paste a draft below</option>
              {scripts.data.scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <textarea
          className="textarea script"
          style={{ minHeight: 160, marginTop: 12 }}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setScriptId('');
          }}
          aria-label="Draft text"
          placeholder="Paste any draft to score it against your voice"
        />
        <div className="row" style={{ marginTop: 12 }}>
          <ActionButton kind="primary" disabled={!text.trim() || !profileId} onAction={score}>
            Score this draft
          </ActionButton>
        </div>
      </Panel>
      {result && (
        <Results
          r={result}
          rewrites={rewrites}
          onRewrite={async () => {
            const r = await attempt(() =>
              api.post<{ rewrites: Rewrite[] }>('/api/m/voice/rewrites', {
                profileId,
                samples: null,
                text,
              }),
            );
            if (r) setRewrites(r.rewrites);
          }}
          onAccept={async (rw) => {
            if (scriptId) {
              const r = await attempt(() =>
                api.post<{ version: ScriptVersion }>('/api/m/voice/rewrites/accept', {
                  scriptId,
                  original: rw.original,
                  text: rw.text,
                  edited: false,
                }),
              );
              if (!r) return;
              setText(r.version.text);
            } else setText((t) => t.replace(rw.original, rw.text));
            setRewrites((l) => (l ?? []).filter((x) => x.index !== rw.index));
            toast('Rewrite accepted');
          }}
        />
      )}
    </div>
  );
}

function Standalone() {
  const { attempt } = useStudio();
  const [samples, setSamples] = useState('');
  const [own, setOwn] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<(MatchResult & { profileMetrics: VoiceMetrics }) | null>(
    null,
  );
  const [rewrites, setRewrites] = useState<Rewrite[] | null>(null);
  return (
    <div className="stack">
      <div className="grid two">
        <Field label="Samples of your own past writing">
          <textarea
            className="textarea script"
            style={{ minHeight: 200 }}
            value={samples}
            onChange={(e) => setSamples(e.target.value)}
          />
        </Field>
        <Field label="Draft to score">
          <textarea
            className="textarea script"
            style={{ minHeight: 200 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} /> These
        samples are my own writing. Kathix never reproduces them beyond short phrases.
      </label>
      <div className="row">
        <ActionButton
          kind="primary"
          disabled={!own || !samples.trim() || !text.trim()}
          onAction={async () => {
            const r = await attempt(() =>
              api.post<MatchResult & { profileMetrics: VoiceMetrics }>(
                '/api/m/voice/standalone/match',
                { samples, text, confirmedOwn: own },
              ),
            );
            if (r) {
              setResult(r);
              setRewrites(null);
            }
          }}
        >
          Score my draft
        </ActionButton>
      </div>
      {result && (
        <>
          <Panel title="Your measured voice" variant="flat">
            <MetricsView m={result.profileMetrics} />
          </Panel>
          <Results
            r={result}
            rewrites={rewrites}
            onRewrite={async () => {
              const r = await attempt(() =>
                api.post<{ rewrites: Rewrite[] }>('/api/m/voice/rewrites', {
                  profileId: null,
                  samples,
                  text,
                }),
              );
              if (r) setRewrites(r.rewrites);
            }}
            onAccept={async (rw) => {
              setText((t) => t.replace(rw.original, rw.text));
              setRewrites((l) => (l ?? []).filter((x) => x.index !== rw.index));
            }}
          />
        </>
      )}
    </div>
  );
}

function Profiles({ projectId }: { projectId: string }) {
  const { attempt, toast, confirm } = useStudio();
  const list = useLoad(
    () => api.get<{ profiles: Profile[] }>(`/api/m/voice/profiles?projectId=${projectId}`),
    [projectId],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [sample, setSample] = useState('');
  const [sampleTitle, setSampleTitle] = useState('');
  const [own, setOwn] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = (list.data?.profiles ?? [])
    .filter((p) => !hidden.has(p.id))
    .map((p) => ({ ...p, samples: p.samples.filter((x) => !hidden.has(x.id)) }));
  const current = visible.find((p) => p.id === (selected ?? visible[0]?.id));
  if (!list.data) return <Loading />;
  const addSamples = async (samples: { title: string; text: string }[]) => {
    if (!current) return;
    const r = await attempt(
      () => api.post(`/api/m/voice/profiles/${current.id}/samples`, { samples, confirmedOwn: own }),
      'Samples added; profile updated',
    );
    if (r) {
      setSample('');
      setSampleTitle('');
      await list.reload();
    }
  };
  return (
    <div className="grid two">
      <div className="stack">
        <Panel title="Profiles" variant="flat">
          <div className="list">
            {visible.map((p) => (
              <div
                key={p.id}
                className={`list-item clickable ${current?.id === p.id ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(p.id)}
                onKeyDown={(e) => e.key === 'Enter' && setSelected(p.id)}
              >
                <strong>{p.name}</strong>
                <span className="muted small">{p.samples.length} samples</span>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Narrator, or a recurring character"
              aria-label="New profile name"
            />
            <ActionButton
              disabled={!name.trim()}
              onAction={async () => {
                const r = await attempt(() =>
                  api.post<{ profile: VoiceProfile }>('/api/m/voice/profiles', { projectId, name }),
                );
                if (r) {
                  setName('');
                  setSelected(r.profile.id);
                  await list.reload();
                }
              }}
            >
              Create profile
            </ActionButton>
          </div>
        </Panel>
        {current && (
          <Panel title={`Add samples to ${current.name}`} variant="flat">
            <div className="stack">
              <Field label="Title">
                <input
                  className="input"
                  value={sampleTitle}
                  onChange={(e) => setSampleTitle(e.target.value)}
                  placeholder="Old episode narration"
                />
              </Field>
              <Field label="Your past writing">
                <textarea
                  className="textarea script"
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                />
              </Field>
              <label className="check">
                <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} /> I
                confirm these samples are my own writing.
              </label>
              <div className="row">
                <ActionButton
                  kind="primary"
                  disabled={!own || !sample.trim()}
                  onAction={() => addSamples([{ title: sampleTitle, text: sample }])}
                >
                  Add sample
                </ActionButton>
                {own && (
                  <FileButton
                    label="Upload samples"
                    accept=".txt,.md"
                    multiple
                    onFiles={(files) =>
                      addSamples(files.map((f) => ({ title: f.name, text: f.text ?? '' })))
                    }
                  />
                )}
              </div>
            </div>
          </Panel>
        )}
      </div>
      {current ? (
        <Panel
          title={current.name}
          actions={
            <>
              {current.metrics !== null && (
                <Button
                  size="small"
                  onClick={() =>
                    void attempt(() =>
                      downloadFrom(
                        `/api/m/voice/profiles/${current.id}/dataset.jsonl`,
                        `${current.name} voice dataset.jsonl`,
                      ),
                    )
                  }
                >
                  Export training dataset
                </Button>
              )}
              <Button
                size="small"
                kind="ghost"
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: `Delete ${current.name}?`,
                      body: 'The profile and its samples are removed.',
                      confirmLabel: 'Delete',
                      danger: true,
                    }))
                  )
                    return;
                  const id = current.id;
                  let undone = false;
                  setHidden((h) => new Set(h).add(id));
                  setSelected(null);
                  toast(`Deleting ${current.name}`, {
                    undo: () => {
                      undone = true;
                      setHidden((h) => {
                        const n = new Set(h);
                        n.delete(id);
                        return n;
                      });
                    },
                  });
                  setTimeout(() => {
                    if (!undone)
                      void attempt(() => api.del(`/api/m/voice/profiles/${id}`)).then(() =>
                        list.reload(),
                      );
                  }, 8000);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <div className="stack">
            {current.description && (
              <div className="panel ai stack tight">
                <Badge tone="ai">Description written by AI from your measurements</Badge>
                <p>{current.description}</p>
                <div className="row">
                  {current.traits.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
              </div>
            )}
            {current.metrics ? (
              <MetricsView m={current.metrics as VoiceMetrics} />
            ) : (
              <p className="muted">Add samples to measure this voice.</p>
            )}
            <h3>Samples</h3>
            {current.samples.map((s) => (
              <div key={s.id} className="row spread small">
                <span>
                  {s.title} · {s.words} words
                </span>
                <Button
                  size="small"
                  kind="ghost"
                  onClick={() => {
                    const pid = current.id;
                    let undone = false;
                    setHidden((h) => new Set(h).add(s.id));
                    toast(`Removing ${s.title}`, {
                      undo: () => {
                        undone = true;
                        setHidden((h) => {
                          const n = new Set(h);
                          n.delete(s.id);
                          return n;
                        });
                      },
                    });
                    setTimeout(() => {
                      if (!undone)
                        void attempt(() =>
                          api.del(`/api/m/voice/profiles/${pid}/samples/${s.id}`),
                        ).then(() => list.reload());
                    }, 8000);
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
            <p className="muted small">
              The training dataset is a JSONL file of instruction and response pairs built only from
              these samples, ready to train a custom voice model (for example on Adaption).
            </p>
          </div>
        </Panel>
      ) : (
        <EmptyState
          title="No profile selected"
          body="Create a profile, then add samples of your own writing."
        />
      )}
    </div>
  );
}

function Page() {
  const { project, route, navigate } = useStudio();
  const tab = (route.query.get('tab') as 'match' | 'profiles' | null) ?? 'match';
  return (
    <div className="page">
      <PageHeader
        eyebrow={project ? project.name : 'No project open'}
        title="Voice Mirror"
        tagline="Your voice, measured in code from your own samples. Drift is flagged line by line."
      />
      {project ? (
        <>
          <Tabs
            label="Voice Mirror sections"
            value={tab}
            onChange={(t) => {
              navigate(`/voice?tab=${t}`, { replace: true });
            }}
            tabs={[
              { id: 'match', label: 'Voice match' },
              { id: 'profiles', label: 'Profiles and samples' },
            ]}
          />
          {tab === 'match' ? (
            <ProjectMatch projectId={project.id} />
          ) : (
            <Profiles projectId={project.id} />
          )}
        </>
      ) : (
        <Standalone />
      )}
    </div>
  );
}

const ui: ModuleUi = { manifest, Page };
export default ui;
