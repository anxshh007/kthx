import { useEffect, useState } from 'react';
import { PROJECT_TYPES, type ProjectType, type ProjectTypeInfo } from '@kathix/kernel/shared';
import type { LedgerEvent, Project, Script } from '@kathix/store';
import {
  ActionButton,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Icon,
  Loading,
  Menu,
  PageHeader,
  Panel,
  api,
  useLoad,
  useServerEvents,
  useStudio,
  type ModuleUi,
} from '@kathix/ui';
import { manifest } from './manifest';
import type { NextAction } from './service';

interface Overview {
  project: Project;
  typeInfo: ProjectTypeInfo;
  scripts: (Script & { words: number; runtimeMinutes: number; openIssues: number })[];
  counts: { pendingProposals: number; entries: number; openIssues: number; profiles: number };
  nextAction: NextAction;
  activity: LedgerEvent[];
}

function ProjectDialog({ project, onClose }: { project?: Project; onClose: () => void }) {
  const { attempt, reloadProjects, setProjectId } = useStudio();
  const [name, setName] = useState(project?.name ?? '');
  const [type, setType] = useState<ProjectType>(project?.type ?? 'video');
  return (
    <Dialog title={project ? 'Rename project' : 'Create a project'} onClose={onClose}>
      <Field label="Name">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My series"
        />
      </Field>
      <Field label="Type" hint="Tunes labels and runtime estimates.">
        <select
          className="select"
          value={type}
          onChange={(e) => setType(e.target.value as ProjectType)}
        >
          {Object.entries(PROJECT_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </Field>
      <ActionButton
        kind="primary"
        disabled={!name.trim()}
        onAction={async () => {
          const res = await attempt(() =>
            project
              ? api.put<{ project: Project }>(`/api/m/home/projects/${project.id}`, {
                  name: name.trim(),
                  type,
                })
              : api.post<{ project: Project }>('/api/m/home/projects', { name: name.trim(), type }),
          );
          if (!res) return;
          await reloadProjects();
          if (!project) setProjectId(res.project.id);
          onClose();
        }}
      >
        {project ? 'Save' : 'Create project'}
      </ActionButton>
    </Dialog>
  );
}

function Shelf({ onEdit }: { onEdit: (p: Project) => void }) {
  const { projects, project, setProjectId, attempt, reloadProjects, toast, confirm } = useStudio();
  const [showArchived, setShowArchived] = useState(false);
  const archived = useLoad(
    () => api.get<{ projects: Project[] }>('/api/m/home/projects?archived=1'),
    [showArchived, projects.length],
  );
  const list = showArchived ? (archived.data?.projects ?? []).filter((p) => p.archived) : projects;
  const setArchived = async (p: Project, value: boolean) => {
    await attempt(() => api.put(`/api/m/home/projects/${p.id}`, { archived: value }));
    if (value && project?.id === p.id) setProjectId(null);
    await reloadProjects();
    await archived.reload();
    toast(value ? `Archived ${p.name}` : `Restored ${p.name}`, {
      undo: async () => {
        await api.put(`/api/m/home/projects/${p.id}`, { archived: !value });
        await reloadProjects();
        await archived.reload();
      },
    });
  };
  const remove = async (p: Project) => {
    const ok = await confirm({
      title: `Delete ${p.name}?`,
      body: 'Its scripts, canon and history will be deleted from this computer.',
      confirmLabel: 'Delete project',
      danger: true,
    });
    if (!ok) return;
    let undone = false;
    if (project?.id === p.id) setProjectId(null);
    toast(`Deleting ${p.name}`, {
      undo: () => {
        undone = true;
      },
    });
    setTimeout(() => {
      if (undone) return;
      void attempt(() => api.del(`/api/m/home/projects/${p.id}`)).then(async () => {
        await reloadProjects();
        await archived.reload();
      });
    }, 8000);
  };
  return (
    <Panel
      title="Project shelf"
      actions={
        <Button size="small" kind="ghost" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? 'Show active projects' : 'Show archived projects'}
        </Button>
      }
    >
      {!list.length ? (
        <p className="muted">{showArchived ? 'Nothing archived.' : 'No projects yet.'}</p>
      ) : (
        <div className="list">
          {list.map((p) => (
            <div key={p.id} className={`list-item ${p.id === project?.id ? 'selected' : ''}`}>
              <div className="stack tight">
                <strong>{p.name}</strong>
                <span className="muted small">
                  {PROJECT_TYPES[p.type].label}
                  {p.isSample ? ' · Sample project' : ''}
                </span>
              </div>
              <div className="row">
                {!p.archived && p.id !== project?.id && (
                  <Button size="small" onClick={() => setProjectId(p.id)}>
                    Open
                  </Button>
                )}
                <Menu
                  label={`Actions for ${p.name}`}
                  items={[
                    ...(!p.archived
                      ? [{ label: 'Rename or change type', onSelect: () => onEdit(p) }]
                      : []),
                    {
                      label: p.archived ? 'Restore' : 'Archive',
                      onSelect: () => setArchived(p, !p.archived),
                    },
                    { label: 'Delete', danger: true, onSelect: () => remove(p) },
                  ]}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ProjectHome({ projectId }: { projectId: string }) {
  const { state, hasAll, navigate, setProjectId } = useStudio();
  const ov = useLoad(
    () => api.get<Overview>(`/api/m/home/projects/${projectId}/overview`),
    [projectId],
  );
  useServerEvents(['ledger', 'job', 'script', 'showrunner'], () => void ov.reload());
  if (ov.error) return <p role="alert">{ov.error}</p>;
  if (!ov.data) return <Loading />;
  const o = ov.data;
  const tiles = state.modules
    .filter((m) => m.id !== 'home' && hasAll(m.requires))
    .sort((a, b) => a.nav.order - b.nav.order);
  return (
    <>
      <PageHeader
        eyebrow={`${o.typeInfo.label}${o.project.isSample ? ' · Sample project' : ''}`}
        title={o.project.name}
        tagline="Stay consistent in canon and voice across every episode, while you stay the author of every line."
        primary={
          <Button kind="primary" onClick={() => navigate(o.nextAction.path)}>
            {o.nextAction.label}
          </Button>
        }
        menu={[{ label: 'Close this project', onSelect: () => setProjectId(null) }]}
      />
      <div className="next-action" role="region" aria-label="Next best action">
        <div className="stack tight">
          <span className="muted small">Next best action</span>
          <strong>{o.nextAction.label}</strong>
          <span className="small">{o.nextAction.detail}</span>
        </div>
      </div>
      <div className="grid three" aria-label="Your stack">
        {tiles.map((m) => (
          <button key={m.id} className="tile" onClick={() => navigate(m.nav.path)}>
            <span className="tile-icon">
              <Icon name={m.nav.icon} />
            </span>
            <strong>{m.title}</strong>
            <span className="muted small">{m.tagline}</span>
          </button>
        ))}
      </div>
      <div className="grid two">
        <Panel
          title={o.typeInfo.unitPlural}
          actions={
            <Button size="small" onClick={() => navigate('/script?new=1')}>
              New {o.typeInfo.unit.toLowerCase()}
            </Button>
          }
        >
          {!o.scripts.length ? (
            <EmptyState
              title={`No ${o.typeInfo.unitPlural.toLowerCase()} yet`}
              action={
                <Button onClick={() => navigate('/script?new=1')}>Write the first one</Button>
              }
            />
          ) : (
            <div className="list">
              {o.scripts.map((s) => (
                <div
                  key={s.id}
                  className="list-item clickable"
                  onClick={() => navigate(`/script?id=${s.id}`)}
                  role="link"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/script?id=${s.id}`)}
                >
                  <div className="stack tight">
                    <strong>{s.title}</strong>
                    <span className="muted small">
                      {s.words} words · {s.runtimeMinutes} min {o.typeInfo.runtimeLabel}
                    </span>
                  </div>
                  {s.openIssues > 0 && <Badge tone="high">{s.openIssues} issues</Badge>}
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <Badge>{o.counts.entries} canon entries</Badge>
            {o.counts.pendingProposals > 0 && (
              <Badge tone="ai">{o.counts.pendingProposals} proposals to review</Badge>
            )}
            <Badge>{o.counts.profiles} voice profiles</Badge>
          </div>
        </Panel>
        <Panel title="Activity">
          {!o.activity.length ? (
            <p className="muted">Things you do in Kathix appear here.</p>
          ) : (
            <div className="timeline">
              {o.activity.map((a) => (
                <div key={a.id} className="timeline-item">
                  <div className="small">{a.summary}</div>
                  <div className="muted small">
                    {new Date(a.createdAt).toLocaleString()} · {a.module}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function Page() {
  const { project, route, navigate, attempt, reloadProjects, setProjectId } = useStudio();
  const [dialog, setDialog] = useState<{ project?: Project } | null>(
    route.query.get('new') === '1' ? {} : null,
  );
  const sampleRequested = route.query.get('sample') === '1';
  useEffect(() => {
    if (route.query.get('new') === '1') setDialog({});
  }, [route]);
  useEffect(() => {
    if (!sampleRequested) return;
    navigate('/', { replace: true });
    void attempt(() => api.post<{ project: Project }>('/api/m/home/sample')).then(async (r) => {
      if (!r) return;
      await reloadProjects();
      setProjectId(r.project.id);
    });
  }, [sampleRequested]);
  const openSample = async () => {
    const r = await attempt(() => api.post<{ project: Project }>('/api/m/home/sample'));
    if (!r) return;
    await reloadProjects();
    setProjectId(r.project.id);
  };
  return (
    <div className="page">
      {project ? (
        <ProjectHome projectId={project.id} />
      ) : (
        <>
          <PageHeader
            eyebrow="Kathix"
            title="Studio Home"
            tagline="Open a project to keep your canon, scripts and voice in one place, or use any module on its own."
            primary={
              <Button kind="primary" onClick={() => setDialog({})}>
                Create a project
              </Button>
            }
            menu={[{ label: 'Open the sample project', onSelect: openSample }]}
          />
          <EmptyState
            title="No project open"
            body="Every module also works on its own: paste text into Continuity Guard, Voice Mirror or the Forge without a project."
            action={<ActionButton onAction={openSample}>Open the sample project</ActionButton>}
          />
        </>
      )}
      <Shelf onEdit={(p) => setDialog({ project: p })} />
      {dialog && (
        <ProjectDialog
          project={dialog.project}
          onClose={() => {
            setDialog(null);
            if (route.query.get('new')) navigate('/', { replace: true });
          }}
        />
      )}
    </div>
  );
}

const ui: ModuleUi = { manifest, Page };
export default ui;
