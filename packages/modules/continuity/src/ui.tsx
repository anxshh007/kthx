import { useState } from 'react';
import type { CanonEntry, ContinuityIssue, Script } from '@kathix/store';
import {
  ActionButton,
  Badge,
  Button,
  Dialog,
  DiffView,
  EmptyState,
  Field,
  Loading,
  Meter,
  PageHeader,
  Panel,
  Switch,
  Tabs,
  api,
  streamPost,
  useLoad,
  useServerEvents,
  useStudio,
  type ModuleUi,
} from '@kathix/ui';
import { manifest } from './manifest';
import type { FoundIssue } from './service';

const TYPE_LABEL: Record<string, string> = {
  contradicted_fact: 'Contradicted fact',
  character_trait: 'Acts against a trait',
  timeline: 'Timeline impossibility',
  name_drift: 'Name or spelling drift',
  world_rule: 'Broken world rule',
  forgotten_promise: 'Forgotten promise',
};

type IssueLike = Pick<
  FoundIssue,
  | 'type'
  | 'severity'
  | 'confidence'
  | 'summary'
  | 'draftQuote'
  | 'refKind'
  | 'refLabel'
  | 'refQuote'
  | 'fixText'
  | 'fixReason'
> & { id?: string };

function IssueCard({
  issue,
  onApply,
  onIntentional,
  onEditCanon,
  onShow,
}: {
  issue: IssueLike;
  onApply: (text: string, edited: boolean) => Promise<unknown>;
  onIntentional: () => Promise<unknown>;
  onEditCanon?: () => void;
  onShow?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(issue.fixText);
  return (
    <article className="panel stack" aria-label={`Continuity issue: ${issue.summary}`}>
      <div className="row spread">
        <div className="row">
          <Badge
            tone={
              issue.severity === 'high'
                ? 'high'
                : issue.severity === 'medium'
                  ? 'medium'
                  : undefined
            }
          >
            {issue.severity} severity
          </Badge>
          <Badge>{TYPE_LABEL[issue.type] ?? issue.type}</Badge>
          <span className="muted small">{Math.round(issue.confidence * 100)}% confidence</span>
        </div>
        {onShow && (
          <Button size="small" kind="ghost" onClick={onShow}>
            Show in script
          </Button>
        )}
      </div>
      <strong>{issue.summary}</strong>
      <div className="grid two">
        <div className="stack tight">
          <span className="muted small">This draft says</span>
          <div className="quote draft">{issue.draftQuote}</div>
        </div>
        <div className="stack tight">
          <span className="muted small">
            {issue.refKind === 'canon' ? `Canon: ${issue.refLabel}` : issue.refLabel} says
          </span>
          <div className="quote ref">{issue.refQuote}</div>
        </div>
      </div>
      {issue.fixText && (
        <div className="panel ai stack tight">
          <Badge tone="ai">Proposed fix</Badge>
          {editing ? (
            <textarea
              className="textarea script"
              style={{ minHeight: 80 }}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Edit the fix"
            />
          ) : (
            <DiffView before={issue.draftQuote} after={issue.fixText} />
          )}
          <span className="small">
            <strong>Why: </strong>
            {issue.fixReason}
          </span>
        </div>
      )}
      <div className="row">
        {issue.fixText &&
          (editing ? (
            <>
              <ActionButton kind="primary" onAction={() => onApply(text, text !== issue.fixText)}>
                Apply my edit
              </ActionButton>
              <Button kind="ghost" onClick={() => setEditing(false)}>
                Back
              </Button>
            </>
          ) : (
            <>
              <ActionButton kind="primary" onAction={() => onApply(issue.fixText, false)}>
                Apply fix
              </ActionButton>
              <Button onClick={() => setEditing(true)}>Edit fix</Button>
            </>
          ))}
        {onEditCanon && issue.refKind === 'canon' && (
          <Button onClick={onEditCanon}>Edit canon instead</Button>
        )}
        <ActionButton kind="ghost" onAction={onIntentional}>
          Mark as intentional
        </ActionButton>
      </div>
    </article>
  );
}

function EditCanonDialog({
  issueId,
  onClose,
  onDone,
}: {
  issueId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { attempt } = useStudio();
  const d = useLoad(
    () => api.get<{ entry: CanonEntry }>(`/api/m/continuity/issues/${issueId}/entry`),
    [issueId],
  );
  const [summary, setSummary] = useState<string | null>(null);
  const [attrs, setAttrs] = useState<string | null>(null);
  if (!d.data)
    return (
      <Dialog title="Edit canon" onClose={onClose}>
        <Loading />
      </Dialog>
    );
  const e = d.data.entry;
  const attrText =
    attrs ??
    Object.entries(e.attributes)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
  return (
    <Dialog title={`Update “${e.name}” to match the script`} onClose={onClose}>
      <p className="muted small">
        The script is right and the vault is outdated. Your change is kept in the entry's history.
      </p>
      <Field label="Summary">
        <textarea
          className="textarea"
          style={{ minHeight: 70 }}
          value={summary ?? e.summary}
          onChange={(ev) => setSummary(ev.target.value)}
        />
      </Field>
      <Field label="Details (one “key: value” per line)">
        <textarea
          className="textarea"
          style={{ minHeight: 90 }}
          value={attrText}
          onChange={(ev) => setAttrs(ev.target.value)}
        />
      </Field>
      <ActionButton
        kind="primary"
        onAction={() =>
          attempt(async () => {
            const attributes = Object.fromEntries(
              attrText
                .split('\n')
                .map((l) => /^([^:]+):\s*(.*)$/.exec(l.trim()))
                .filter((m): m is RegExpExecArray => !!m)
                .map((m) => [(m[1] as string).trim(), (m[2] as string).trim()]),
            );
            await api.post(`/api/m/continuity/issues/${issueId}/edit-canon`, {
              summary: summary ?? e.summary,
              attributes,
            });
            onDone();
            onClose();
          }, 'Canon updated')
        }
      >
        Save to canon
      </ActionButton>
    </Dialog>
  );
}

function ScriptCheck({ projectId }: { projectId: string }) {
  const { route, navigate, attempt, toast, project, reloadProjects } = useStudio();
  const scripts = useLoad(
    () => api.get<{ scripts: Script[] }>(`/api/m/script/scripts?projectId=${projectId}`),
    [projectId],
  );
  const scriptId =
    route.query.get('script') ?? scripts.data?.scripts[scripts.data.scripts.length - 1]?.id ?? '';
  const issues = useLoad(
    () =>
      scriptId
        ? api.get<{ issues: ContinuityIssue[] }>(`/api/m/continuity/scripts/${scriptId}/issues`)
        : Promise.resolve({ issues: [] }),
    [scriptId],
  );
  const [stage, setStage] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{ discarded: number; canonCount: number } | null>(null);
  const [editCanon, setEditCanon] = useState<string | null>(null);
  useServerEvents(['job'], (_e, data) => {
    const j = data as { type: string; status: string };
    if (j.type === 'continuity.check' && j.status === 'succeeded') void issues.reload();
  });
  const run = async () => {
    setStage('Starting');
    const r = await attempt(() =>
      streamPost<{ issues: ContinuityIssue[]; discarded: number; canonCount: number }>(
        `/api/m/continuity/scripts/${scriptId}/check`,
        {},
        { onEvent: (e, d) => e === 'stage' && setStage((d as { stage: string }).stage) },
      ),
    );
    setStage(null);
    if (r) {
      setLastRun({ discarded: r.discarded, canonCount: r.canonCount });
      await issues.reload();
      toast(
        r.issues.length
          ? `Found ${r.issues.length} issue${r.issues.length === 1 ? '' : 's'}`
          : 'No contradictions found',
      );
    }
  };
  if (!scripts.data) return <Loading />;
  if (!scripts.data.scripts.length)
    return (
      <EmptyState
        title="No scripts to check yet"
        action={<Button onClick={() => navigate('/script?new=1')}>Start a script</Button>}
      />
    );
  const open = issues.data?.issues ?? [];
  return (
    <div className="stack">
      <Panel variant="flat">
        <div className="row spread">
          <div className="row">
            <Field label="Script">
              <select
                className="select"
                value={scriptId}
                onChange={(e) =>
                  navigate(`/continuity?script=${e.target.value}`, { replace: true })
                }
              >
                {scripts.data.scripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </Field>
            {project && (
              <Switch
                label="Check automatically when I save"
                checked={Boolean(project.settings.continuityOnSave)}
                onChange={(v) =>
                  void attempt(
                    async () => {
                      await api.put(`/api/m/home/projects/${project.id}`, {
                        settings: { continuityOnSave: v },
                      });
                      await reloadProjects();
                    },
                    v
                      ? 'Checks will run in the background after you save'
                      : 'Automatic checks are off',
                  )
                }
              />
            )}
          </div>
          <ActionButton kind="primary" disabled={!scriptId || stage !== null} onAction={run}>
            {stage ? 'Checking…' : 'Run continuity check'}
          </ActionButton>
        </div>
        {stage && (
          <p className="small muted" role="status">
            {stage}
          </p>
        )}
        {lastRun && (
          <p className="small muted">
            Checked against {lastRun.canonCount} canon entries.{' '}
            {lastRun.discarded
              ? `${lastRun.discarded} answers were discarded because their quotes could not be found word for word.`
              : 'Every issue below quotes both passages word for word.'}
          </p>
        )}
      </Panel>
      {!issues.data ? (
        <Loading />
      ) : !open.length ? (
        <EmptyState
          title="No open issues"
          body="Run a check after writing; issues you mark as intentional are never raised again."
        />
      ) : (
        open.map((i) => (
          <IssueCard
            key={i.id}
            issue={i}
            onShow={() => navigate(`/script?id=${scriptId}&at=${i.draftStart}`)}
            onApply={(text, edited) =>
              attempt(async () => {
                await api.post(`/api/m/continuity/issues/${i.id}/apply`, { text, edited });
                await issues.reload();
              }, 'Fix applied to the script')
            }
            onIntentional={async () => {
              await attempt(() => api.post(`/api/m/continuity/issues/${i.id}/intentional`));
              await issues.reload();
              toast('Marked as intentional. It will not be raised again.', {
                undo: async () => {
                  await api.post(`/api/m/continuity/issues/${i.id}/reopen`);
                  await issues.reload();
                },
              });
            }}
            onEditCanon={() => setEditCanon(i.id)}
          />
        ))
      )}
      {editCanon && (
        <EditCanonDialog
          issueId={editCanon}
          onClose={() => setEditCanon(null)}
          onDone={() => void issues.reload()}
        />
      )}
    </div>
  );
}

function Compare() {
  const { attempt, toast } = useStudio();
  const [reference, setReference] = useState('');
  const [draft, setDraft] = useState('');
  const [issues, setIssues] = useState<FoundIssue[] | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack">
      <div className="grid two">
        <Field label="Reference (what is already true)">
          <textarea
            className="textarea script"
            style={{ minHeight: 240 }}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Paste earlier episodes or notes"
          />
        </Field>
        <Field label="Draft to check">
          <textarea
            className="textarea script"
            style={{ minHeight: 240 }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste the new draft"
          />
        </Field>
      </div>
      <div className="row">
        <ActionButton
          kind="primary"
          disabled={!reference.trim() || !draft.trim() || busy}
          busyLabel="Checking"
          onAction={async () => {
            setBusy(true);
            const r = await attempt(() =>
              streamPost<{ issues: FoundIssue[] }>('/api/m/continuity/compare', {
                reference,
                draft,
              }),
            );
            setBusy(false);
            if (r) setIssues(r.issues);
          }}
        >
          Find contradictions
        </ActionButton>
      </div>
      {issues && !issues.length && <EmptyState title="No contradictions found" />}
      {issues?.map((i) => (
        <IssueCard
          key={i.fingerprint}
          issue={i}
          onApply={async (text) => {
            setDraft((d) => d.replace(i.draftQuote, text));
            setIssues((l) => (l ?? []).filter((x) => x.fingerprint !== i.fingerprint));
            toast('Fix applied to the draft');
          }}
          onIntentional={async () =>
            setIssues((l) => (l ?? []).filter((x) => x.fingerprint !== i.fingerprint))
          }
        />
      ))}
    </div>
  );
}

function Health({ projectId }: { projectId: string }) {
  const { navigate } = useStudio();
  const d = useLoad(
    () =>
      api.get<{
        scripts: {
          id: string;
          title: string;
          open: number;
          runs: { at: string; open: number; total: number }[];
        }[];
      }>(`/api/m/continuity/health?projectId=${projectId}`),
    [projectId],
  );
  if (!d.data) return <Loading />;
  const max = Math.max(1, ...d.data.scripts.flatMap((s) => s.runs.map((r) => r.total)));
  return (
    <Panel title="Open issues per script over time">
      <div className="stack">
        {d.data.scripts.map((s) => (
          <div key={s.id} className="stack tight">
            <div className="row spread">
              <Button
                kind="ghost"
                size="small"
                onClick={() => navigate(`/continuity?script=${s.id}`)}
              >
                {s.title}
              </Button>
              <Badge tone={s.open ? 'high' : 'ok'}>{s.open} open now</Badge>
            </div>
            {s.runs.length ? (
              <div className="row" aria-label={`Check history for ${s.title}`}>
                {s.runs.map((r) => (
                  <div
                    key={r.at}
                    style={{ width: 60 }}
                    title={`${new Date(r.at).toLocaleString()}: ${r.open} open of ${r.total}`}
                  >
                    <Meter
                      value={(r.open / max) * 100}
                      label={`${r.open} open issues on ${new Date(r.at).toLocaleDateString()}`}
                    />
                    <span className="muted small">
                      {new Date(r.at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="muted small">Not checked yet.</span>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Page() {
  const { route, navigate, project } = useStudio();
  const requested =
    (route.query.get('mode') as 'check' | 'compare' | 'health' | null) ??
    (project ? 'check' : 'compare');
  const mode = project ? requested : 'compare';
  const tabs = project
    ? [
        { id: 'check' as const, label: 'Check a script' },
        { id: 'compare' as const, label: 'Compare two texts' },
        { id: 'health' as const, label: 'Project health' },
      ]
    : [{ id: 'compare' as const, label: 'Compare two texts' }];
  return (
    <div className="page">
      <PageHeader
        eyebrow={project ? project.name : 'No project open'}
        title="Continuity Guard"
        tagline="Every issue quotes both passages, word for word. You decide what is a mistake."
      />
      <Tabs
        label="Continuity Guard modes"
        tabs={tabs}
        value={mode}
        onChange={(m) => {
          navigate(`/continuity?mode=${m}`, { replace: true });
        }}
      />
      {mode === 'check' && project && <ScriptCheck projectId={project.id} />}
      {mode === 'compare' && <Compare />}
      {mode === 'health' && project && <Health projectId={project.id} />}
    </div>
  );
}

const ui: ModuleUi = { manifest, Page };
export default ui;
