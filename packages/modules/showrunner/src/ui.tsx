import { useEffect, useState } from 'react';
import type { RunStep, Script, ShowrunnerRun } from '@kathix/store';
import {
  ActionButton,
  Badge,
  Button,
  DiffView,
  EmptyState,
  Field,
  Loading,
  Meter,
  PageHeader,
  Panel,
  api,
  useLoad,
  useServerEvents,
  useStudio,
  type ModuleUi,
} from '@kathix/ui';
import { manifest } from './manifest';

const STATUS: Record<
  RunStep['status'],
  { label: string; tone?: 'warm' | 'ai' | 'high' | 'medium' | 'ok' }
> = {
  pending: { label: 'Waiting' },
  running: { label: 'Working', tone: 'ai' },
  awaiting_approval: { label: 'Needs your decision', tone: 'warm' },
  approved: { label: 'Approved', tone: 'ok' },
  skipped: { label: 'Skipped' },
  failed: { label: 'Failed', tone: 'high' },
};

function elapsed(run: ShowrunnerRun, now: number): string {
  const live = run.status === 'running' ? now - Date.parse(run.updatedAt) : 0;
  const s = Math.round((run.elapsedMs + Math.max(0, live)) / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function StepDetails({ details }: { details: unknown }) {
  const d = details as {
    issues?: { summary: string; draftQuote: string; refLabel: string; refQuote: string }[];
    titles?: string[];
    hooks?: string[];
    score?: number;
    fixes?: { quote: string; replacement: string; reason: string }[];
  } | null;
  if (!d) return null;
  return (
    <div className="stack tight">
      {d.issues?.map((i, n) => (
        <div key={n} className="grid two">
          <div className="quote draft small">{i.draftQuote}</div>
          <div className="quote ref small">
            <strong>{i.refLabel}: </strong>
            {i.refQuote}
          </div>
        </div>
      ))}
      {d.fixes &&
        d.fixes.length > 0 &&
        !d.issues &&
        d.fixes.map((f, n) => <DiffView key={n} before={f.quote} after={f.replacement} />)}
      {d.titles && (
        <div className="stack tight">
          <strong className="small">Titles</strong>
          {d.titles.map((t) => (
            <span key={t} className="small">
              • {t}
            </span>
          ))}
        </div>
      )}
      {d.hooks && (
        <div className="stack tight">
          <strong className="small">Hooks</strong>
          {d.hooks.map((t) => (
            <span key={t} className="small">
              • {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RunView({ id }: { id: string }) {
  const { attempt, navigate, toast } = useStudio();
  const r = useLoad(() => api.get<{ run: ShowrunnerRun }>(`/api/m/showrunner/runs/${id}`), [id]);
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [tplName, setTplName] = useState('');
  useServerEvents(['showrunner', 'job'], () => void r.reload());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!r.data) return <Loading />;
  const run = r.data.run;
  const step = run.steps[run.stepIndex];
  const act = (path: string, payload: object = {}, msg?: string) =>
    attempt(async () => {
      await api.post(`/api/m/showrunner/runs/${id}/${path}`, payload);
      setEditing(null);
      setNote('');
      await r.reload();
    }, msg);
  const done = run.steps.filter((s) => s.status === 'approved' || s.status === 'skipped').length;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Showrunner run"
        title={run.goal}
        tagline={`Status: ${run.status.replace('_', ' ')} · ${run.tokens} tokens used · ${elapsed(run, now)} elapsed`}
        primary={
          run.status === 'awaiting_approval' && step ? (
            <ActionButton
              kind="primary"
              onAction={() => act('approve', { text: editing }, `Approved: ${step.label}`)}
            >
              {editing !== null ? 'Approve my edit' : `Approve: ${step.label}`}
            </ActionButton>
          ) : undefined
        }
        menu={[
          { label: 'Open the script', onSelect: () => navigate(`/script?id=${run.scriptId}`) },
          { label: 'Back to all runs', onSelect: () => navigate('/showrunner') },
          ...(run.status !== 'completed' && run.status !== 'stopped'
            ? [
                {
                  label: 'Stop the run',
                  danger: true,
                  onSelect: () => void act('stop', {}, 'Run stopped'),
                },
              ]
            : []),
        ]}
      />
      <Panel>
        <div className="stack tight">
          <Meter value={(done / Math.max(1, run.steps.length)) * 100} label="Run progress" />
          <span className="small muted">
            {done} of {run.steps.length || '…'} steps decided
          </span>
        </div>
      </Panel>
      <div className="grid two">
        <Panel title="Plan" variant="flat">
          {!run.steps.length ? (
            <Loading label="Planning from the modules you have available" />
          ) : (
            <ol className="stack" style={{ paddingLeft: 18, margin: 0 }}>
              {run.steps.map((s, i) => (
                <li key={`${s.stepId}-${i}`}>
                  <div className="row spread">
                    <strong>{s.label}</strong>
                    <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                  </div>
                  <div className="small muted">{s.purpose}</div>
                  {s.status === 'running' && s.reading && (
                    <div className="small" style={{ color: 'var(--cool)' }}>
                      Reading {s.reading}…
                    </div>
                  )}
                  {s.summary && s.status !== 'awaiting_approval' && (
                    <div className="small">{s.summary}</div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <div className="stack">
          {run.status === 'awaiting_approval' && step && (
            <Panel variant="ai" title={`Checkpoint: ${step.label}`}>
              <div className="stack">
                <p>{step.summary}</p>
                <StepDetails details={step.details} />
                {step.proposedText !== null && (
                  <>
                    <span className="small muted">
                      Proposed change to the script (nothing is applied until you approve)
                    </span>
                    {editing !== null ? (
                      <textarea
                        className="textarea script"
                        style={{ minHeight: 260 }}
                        value={editing}
                        onChange={(e) => setEditing(e.target.value)}
                        aria-label="Edit before approving"
                      />
                    ) : (
                      <div style={{ maxHeight: 340, overflow: 'auto' }}>
                        {run.workingText.length + step.proposedText.length < 60000 ? (
                          <DiffView before={run.workingText} after={step.proposedText} />
                        ) : (
                          <div className="quote ai">{step.proposedText}</div>
                        )}
                      </div>
                    )}
                  </>
                )}
                <div className="row">
                  {step.proposedText !== null && editing === null && (
                    <Button onClick={() => setEditing(step.proposedText)}>
                      Edit, then approve
                    </Button>
                  )}
                  <ActionButton
                    kind="ghost"
                    onAction={() => act('skip', {}, `Skipped: ${step.label}`)}
                  >
                    Skip this step
                  </ActionButton>
                </div>
                <div className="row">
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    placeholder="Redo with a note, e.g. more tension in scene 2"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    aria-label="Note for redoing this step"
                  />
                  <ActionButton
                    disabled={!note.trim()}
                    onAction={() => act('redo', { note }, 'Redoing the step with your note')}
                  >
                    Redo with note
                  </ActionButton>
                </div>
              </div>
            </Panel>
          )}
          {run.status === 'failed' && step && (
            <Panel title={`${step.label} could not finish`}>
              <p>{step.error}</p>
              <div className="row" style={{ marginTop: 10 }}>
                <ActionButton
                  kind="primary"
                  onAction={() => act('redo', { note: '' }, 'Trying the step again')}
                >
                  Try again
                </ActionButton>
                <ActionButton kind="ghost" onAction={() => act('skip', {}, 'Skipped')}>
                  Skip this step
                </ActionButton>
              </div>
            </Panel>
          )}
          {run.status === 'completed' && (
            <Panel title="Run complete">
              <p className="small">The script now contains only the changes you approved.</p>
              <div className="row" style={{ marginTop: 10 }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="Template name, e.g. Episode pipeline"
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  aria-label="Template name"
                />
                <ActionButton
                  disabled={!tplName.trim()}
                  onAction={() =>
                    attempt(async () => {
                      await api.post(`/api/m/showrunner/runs/${id}/template`, { name: tplName });
                      await r.reload();
                      toast('Saved. Replay it on your next episode.');
                    })
                  }
                >
                  Save as template
                </ActionButton>
              </div>
            </Panel>
          )}
          <Panel title="Log" variant="flat">
            <div className="stack tight" style={{ maxHeight: 280, overflow: 'auto' }}>
              {[...run.log].reverse().map((l, i) => (
                <div key={i} className="small">
                  <span className="muted">{new Date(l.at).toLocaleTimeString()}</span> {l.message}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function StartForm() {
  const { activeProjectId, attempt, navigate } = useStudio();
  const scripts = useLoad(
    () => api.get<{ scripts: Script[] }>(`/api/m/script/scripts?projectId=${activeProjectId}`),
    [activeProjectId],
  );
  const docs = useLoad(
    () =>
      api.get<{ docs: { id: string; title: string; text: string }[] }>(
        `/api/m/showrunner/docs?projectId=${activeProjectId}`,
      ),
    [activeProjectId],
  );
  const templates = useLoad(
    () =>
      api.get<{ templates: ShowrunnerRun[] }>(
        `/api/m/showrunner/templates?projectId=${activeProjectId}`,
      ),
    [activeProjectId],
  );
  const steps = useLoad(
    () =>
      api.get<{ steps: { id: string; label: string; description: string }[] }>(
        '/api/m/showrunner/steps',
      ),
    [],
  );
  const [goal, setGoal] = useState(
    'Draft the next episode from this outline and make it ready to record',
  );
  const [target, setTarget] = useState('new');
  const [title, setTitle] = useState('');
  const [outline, setOutline] = useState('');
  const [templateRunId, setTemplate] = useState('');
  return (
    <Panel title="Start a run">
      <div className="stack">
        <Field label="Goal">
          <textarea
            className="textarea"
            style={{ minHeight: 70 }}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </Field>
        <div className="grid two">
          <Field label="Work on">
            <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="new">A new episode</option>
              {(scripts.data?.scripts ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </Field>
          {target === 'new' && (
            <Field label="New episode title">
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Episode 5"
              />
            </Field>
          )}
        </div>
        <Field label="Outline" hint="Paste an outline, or pick one of your project documents.">
          <textarea
            className="textarea script"
            value={outline}
            onChange={(e) => setOutline(e.target.value)}
          />
        </Field>
        {(docs.data?.docs.length ?? 0) > 0 && (
          <div className="row">
            <span className="small muted">Use a document:</span>
            {docs.data?.docs
              .filter((d) => /outline/i.test(d.title))
              .map((d) => (
                <Button
                  key={d.id}
                  size="small"
                  onClick={() => {
                    setOutline(d.text);
                    if (!title) setTitle(d.title.replace(/\s*outline\s*/i, '').trim());
                  }}
                >
                  {d.title}
                </Button>
              ))}
          </div>
        )}
        {(templates.data?.templates.length ?? 0) > 0 && (
          <Field label="Replay a saved template (optional)">
            <select
              className="select"
              value={templateRunId}
              onChange={(e) => setTemplate(e.target.value)}
            >
              <option value="">Let the Showrunner plan</option>
              {templates.data?.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.templateName}
                </option>
              ))}
            </select>
          </Field>
        )}
        <p className="small muted">
          Available steps right now: {(steps.data?.steps ?? []).map((s) => s.label).join(', ')}.
        </p>
        <div className="row">
          <ActionButton
            kind="primary"
            disabled={!goal.trim()}
            onAction={async () => {
              const r = await attempt(() =>
                api.post<{ run: ShowrunnerRun }>('/api/m/showrunner/runs', {
                  projectId: activeProjectId,
                  scriptId: target === 'new' ? null : target,
                  newTitle: title,
                  goal,
                  outline,
                  templateRunId: templateRunId || null,
                }),
              );
              if (r) navigate(`/showrunner?run=${r.run.id}`);
            }}
          >
            Plan and start
          </ActionButton>
        </div>
      </div>
    </Panel>
  );
}

function Runs() {
  const { activeProjectId, project, navigate, route } = useStudio();
  const runs = useLoad(
    () => api.get<{ runs: ShowrunnerRun[] }>(`/api/m/showrunner/runs?projectId=${activeProjectId}`),
    [activeProjectId],
  );
  const [starting, setStarting] = useState(route.query.get('new') === '1');
  useServerEvents(['showrunner'], () => void runs.reload());
  useEffect(() => {
    if (route.query.get('new') === '1') setStarting(true);
  }, [route]);
  return (
    <div className="page">
      <PageHeader
        eyebrow={project ? project.name : 'Scratchpad (no project open)'}
        title="Showrunner"
        tagline="State a goal. The agent plans with the modules you have, then stops for your decision after every step."
        primary={
          !starting ? (
            <Button kind="primary" onClick={() => setStarting(true)}>
              Start a run
            </Button>
          ) : undefined
        }
      />
      {starting && <StartForm />}
      {!runs.data ? (
        <Loading />
      ) : !runs.data.runs.length ? (
        !starting && (
          <EmptyState
            title="No runs yet"
            body="Try: draft episode 5 from this outline and make it ready to record."
            action={<Button onClick={() => setStarting(true)}>Start a run</Button>}
          />
        )
      ) : (
        <div className="list">
          {runs.data.runs.map((r) => (
            <div
              key={r.id}
              className="list-item clickable"
              role="link"
              tabIndex={0}
              onClick={() => navigate(`/showrunner?run=${r.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/showrunner?run=${r.id}`)}
            >
              <div className="stack tight">
                <strong>{r.goal}</strong>
                <span className="muted small">
                  {new Date(r.startedAt).toLocaleString()}
                  {r.templateName ? ` · template “${r.templateName}”` : ''}
                </span>
              </div>
              <Badge
                tone={
                  r.status === 'awaiting_approval'
                    ? 'warm'
                    : r.status === 'completed'
                      ? 'ok'
                      : r.status === 'failed'
                        ? 'high'
                        : undefined
                }
              >
                {r.status.replace('_', ' ')}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Page() {
  const { route } = useStudio();
  const id = route.query.get('run');
  return id ? <RunView key={id} id={id} /> : <Runs />;
}

const ui: ModuleUi = { manifest, Page };
export default ui;
