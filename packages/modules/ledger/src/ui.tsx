import { useEffect } from 'react';
import type { AuthorRange, AuthorshipShare } from '@kathix/kernel/shared';
import type { LedgerEvent, Project, Script } from '@kathix/store';
import {
  Badge,
  Button,
  EmptyState,
  Loading,
  Meter,
  PageHeader,
  Panel,
  api,
  downloadFrom,
  useLoad,
  useStudio,
  type ModuleUi,
} from '@kathix/ui';
import { manifest } from './manifest';

interface Counts {
  offered: number;
  accepted: number;
  edited: number;
  rejected: number;
  pending: number;
}

function ShareBar({ share }: { share: AuthorshipShare }) {
  const pct = (n: number) => (share.total ? Math.round((n / share.total) * 1000) / 10 : 0);
  return (
    <div className="stack tight">
      <div className="row spread">
        <strong style={{ fontSize: '1.4rem' }}>{share.humanPercent}% written by you</strong>
        <span className="muted small">{share.total} characters</span>
      </div>
      <Meter value={share.humanPercent} label="Share written by you" />
      <div className="row small">
        <span>
          <span className="legend" style={{ background: 'var(--text)' }} />
          You {pct(share.human)}%
        </span>
        <span>
          <span className="legend" style={{ background: 'var(--cool)' }} />
          AI, accepted {pct(share.ai)}%
        </span>
        <span>
          <span className="legend" style={{ background: '#b9a7f0' }} />
          AI, then edited by you {pct(share.aiEdited)}%
        </span>
      </div>
    </div>
  );
}

function Events({ events }: { events: LedgerEvent[] }) {
  if (!events.length) return <p className="muted">Nothing recorded yet.</p>;
  return (
    <table className="data">
      <thead>
        <tr>
          <th>When</th>
          <th>What happened</th>
          <th>Module</th>
          <th>Model</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id}>
            <td>{new Date(e.createdAt).toLocaleString()}</td>
            <td>{e.summary}</td>
            <td>{e.module}</td>
            <td>{e.model || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScriptView({ id }: { id: string }) {
  const { attempt, navigate } = useStudio();
  const d = useLoad(
    () =>
      api.get<{
        script: Script;
        text: string;
        ranges: AuthorRange[];
        share: AuthorshipShare;
        suggestions: Counts;
        events: LedgerEvent[];
      }>(`/api/m/ledger/scripts/${id}`),
    [id],
  );
  if (d.error) return <p role="alert">{d.error}</p>;
  if (!d.data) return <Loading />;
  const x = d.data;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Provenance Ledger"
        title={x.script.title}
        tagline="Every character is coloured by where it came from."
        primary={
          <Button
            kind="primary"
            onClick={() =>
              void attempt(() =>
                downloadFrom(
                  `/api/m/ledger/disclosure.md?scriptId=${id}`,
                  `${x.script.title} - AI disclosure.md`,
                ),
              )
            }
          >
            Export disclosure statement
          </Button>
        }
        menu={[
          { label: 'Open in Script Studio', onSelect: () => navigate(`/script?id=${id}`) },
          { label: 'Back to the project ledger', onSelect: () => navigate('/ledger') },
        ]}
      />
      <Panel>
        <ShareBar share={x.share} />
      </Panel>
      <div className="row">
        <Badge>{x.suggestions.offered} suggestions offered</Badge>
        <Badge tone="ai">{x.suggestions.accepted} accepted</Badge>
        <Badge tone="ai">{x.suggestions.edited} edited then accepted</Badge>
        <Badge>{x.suggestions.rejected} rejected</Badge>
      </div>
      <div className="authored" aria-label="Script coloured by authorship">
        {x.ranges.map((r) => (
          <span
            key={r.start}
            className={`o-${r.origin}`}
            title={
              r.origin === 'human'
                ? 'Written by you'
                : r.origin === 'ai'
                  ? 'Suggested by AI, accepted'
                  : 'Suggested by AI, then edited by you'
            }
          >
            {x.text.slice(r.start, r.end)}
          </span>
        ))}
        {!x.text && <span className="muted">This script is empty.</span>}
      </div>
      <Panel title="Record" variant="flat">
        <Events events={x.events} />
      </Panel>
    </div>
  );
}

function ProjectView() {
  const { activeProjectId, project, attempt, navigate, route } = useStudio();
  const d = useLoad(
    () =>
      api.get<{
        project: Project;
        scripts: { id: string; title: string; share: AuthorshipShare }[];
        total: AuthorshipShare;
        suggestions: Counts;
        events: LedgerEvent[];
      }>(`/api/m/ledger/project?projectId=${activeProjectId}`),
    [activeProjectId],
  );
  const exportDisclosure = () =>
    attempt(() =>
      downloadFrom(`/api/m/ledger/disclosure.md?projectId=${activeProjectId}`, 'AI disclosure.md'),
    );
  useEffect(() => {
    if (route.query.get('disclosure') === '1') {
      navigate('/ledger', { replace: true });
      void exportDisclosure();
    }
  }, []);
  if (!d.data) return <Loading />;
  const x = d.data;
  return (
    <div className="page">
      <PageHeader
        eyebrow={project ? project.name : 'Scratchpad (no project open)'}
        title="Provenance Ledger"
        tagline="Every AI suggestion offered, accepted, edited or rejected, and the human share of each script."
        primary={
          <Button kind="primary" onClick={() => void exportDisclosure()}>
            Export disclosure statement
          </Button>
        }
      />
      <Panel>
        <ShareBar share={{ ...x.total, humanPercent: x.total.humanPercent }} />
      </Panel>
      <Panel title="Scripts">
        {!x.scripts.length ? (
          <EmptyState
            title="No scripts yet"
            action={<Button onClick={() => navigate('/script?new=1')}>Start a script</Button>}
          />
        ) : (
          <div className="list">
            {x.scripts.map((s) => (
              <div
                key={s.id}
                className="list-item clickable"
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/ledger?script=${s.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/ledger?script=${s.id}`)}
              >
                <strong>{s.title}</strong>
                <div className="row" style={{ minWidth: 220 }}>
                  <div style={{ flex: 1 }}>
                    <Meter value={s.share.humanPercent} label={`${s.title} human share`} />
                  </div>
                  <span className="small">{s.share.humanPercent}% yours</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Record" variant="flat">
        <Events events={x.events} />
      </Panel>
    </div>
  );
}

function Page() {
  const { route } = useStudio();
  const id = route.query.get('script');
  return id ? <ScriptView key={id} id={id} /> : <ProjectView />;
}

const ui: ModuleUi = { manifest, Page };
export default ui;
