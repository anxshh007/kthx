import { Suspense, useEffect, useState } from 'react';
import { Background, Button, Icon, Loading, useStudio } from '@kathix/ui';
import { MODULE_PAGES } from './modules';
import { ChooseScreen, ConnectScreen } from './Setup';
import { Palette } from './Palette';
import { JobsTray } from './JobsTray';

function Toasts() {
  const { toasts, dismissToast } = useStudio();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.error ? 'error' : ''}`}
          role={t.error ? 'alert' : 'status'}
        >
          <span>{t.message}</span>
          {t.undo && (
            <Button
              size="small"
              onClick={() => {
                dismissToast(t.id);
                void t.undo?.();
              }}
            >
              Undo
            </Button>
          )}
          <Button
            size="small"
            kind="ghost"
            className="icon"
            aria-label="Dismiss message"
            onClick={() => dismissToast(t.id)}
          >
            <Icon name="close" size={14} />
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Destructive actions ask once; the action itself then offers undo. */
function ConfirmDialog() {
  const { pendingConfirm } = useStudio();
  if (!pendingConfirm) return null;
  const { title, body, confirmLabel, danger, resolve } = pendingConfirm;
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="row">
          <Button kind={danger ? 'danger' : 'primary'} onClick={() => resolve(true)} autoFocus>
            {confirmLabel}
          </Button>
          <Button kind="ghost" onClick={() => resolve(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const studio = useStudio();
  const {
    state,
    hasAll,
    route,
    navigate,
    project,
    paletteOpen,
    setPaletteOpen,
    focusMode,
    setFocusMode,
  } = studio;
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setPaletteOpen]);

  if (state.setupRequired) {
    if (state.probing) {
      return (
        <>
          <Background slot="home" />
          <main className="splash">
            <Loading label="Checking your model connections" />
          </main>
          <Toasts />
        </>
      );
    }
    return (
      <>
        <ConnectScreen onConnected={() => setChoosing(true)} />
        <Toasts />
      </>
    );
  }
  if (choosing) {
    return (
      <>
        <ChooseScreen onDone={() => setChoosing(false)} />
        <Toasts />
      </>
    );
  }

  const visible = state.modules
    .filter((m) => hasAll(m.requires))
    .sort((a, b) => a.nav.order - b.nav.order);
  const current =
    [...visible]
      .sort((a, b) => b.nav.path.length - a.nav.path.length)
      .find((m) =>
        m.nav.path === '/'
          ? route.path === '/'
          : route.path === m.nav.path || route.path.startsWith(`${m.nav.path}/`),
      ) ?? visible[0];
  const Page = current ? MODULE_PAGES[current.id] : undefined;

  return (
    <>
      <Background slot={current?.nav.background ?? 'home'} />
      <div className="shell">
        <nav className="sidebar" aria-label="Kathix modules">
          <div className="brand">
            <div className="brand-mark">K</div>
            <span>Kathix</span>
          </div>
          {visible.map((m) => (
            <a
              key={m.id}
              href={m.nav.path}
              className="nav-item"
              aria-current={current?.id === m.id ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(m.nav.path);
              }}
            >
              <Icon name={m.nav.icon} />
              {m.nav.label}
            </a>
          ))}
          <div className="sidebar-foot">
            <div className="project-pill">
              {project ? 'Project' : 'No project open'}
              {project && <strong>{project.name}</strong>}
            </div>
            <button
              className="nav-item"
              onClick={() => setPaletteOpen(true)}
              aria-keyshortcuts="Control+K"
            >
              <Icon name="search" />
              Search and commands
            </button>
            <button
              className="nav-item"
              onClick={() => setFocusMode(!focusMode)}
              aria-pressed={focusMode}
            >
              <Icon name="focus" />
              {focusMode ? 'Focus mode on' : 'Focus mode'}
            </button>
          </div>
        </nav>
        <main className="main" id="main">
          <Suspense fallback={<Loading />}>
            {Page ? <Page key={current?.id} /> : <Loading />}
          </Suspense>
        </main>
      </div>
      {paletteOpen && <Palette />}
      <JobsTray />
      <Toasts />
      <ConfirmDialog />
    </>
  );
}
