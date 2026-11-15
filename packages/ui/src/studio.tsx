import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Capability, CapabilityMap, ModuleManifest } from '@kathix/kernel/shared';
import type { Project } from '@kathix/store';
import { api, ApiError } from './api';

export interface StudioState {
  capabilities: CapabilityMap;
  probing: boolean;
  modules: ModuleManifest[];
  setupRequired: boolean;
  scratchProjectId: string;
}

export interface BackgroundSource {
  width: number;
  url: string;
}

export interface BackgroundManifest {
  slots: Record<
    string,
    {
      placeholder: string;
      avif: BackgroundSource[];
      webp: BackgroundSource[];
      kind: 'photo' | 'procedural';
    }
  >;
}

export interface Toast {
  id: number;
  message: string;
  error?: boolean;
  undo?: () => void | Promise<void>;
}

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
}

export interface Route {
  path: string;
  query: URLSearchParams;
}

type EventHandler = (event: string, data: unknown) => void;

export interface StudioContextValue {
  state: StudioState;
  refreshState(): Promise<void>;
  projects: Project[];
  project: Project | null;
  /** The open project, or the hidden Scratchpad that standalone modes use. */
  activeProjectId: string;
  setProjectId(id: string | null): void;
  reloadProjects(): Promise<void>;
  has(cap: Capability): boolean;
  hasAll(caps: readonly Capability[]): boolean;
  route: Route;
  navigate(to: string, opts?: { replace?: boolean }): void;
  toast(message: string, opts?: { undo?: Toast['undo']; error?: boolean }): void;
  toasts: Toast[];
  dismissToast(id: number): void;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  pendingConfirm: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;
  /** Runs an action and turns any failure into a plain-language toast. */
  attempt<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined>;
  subscribe(handler: EventHandler): () => void;
  backgrounds: BackgroundManifest;
  focusMode: boolean;
  setFocusMode(on: boolean): void;
  paletteOpen: boolean;
  setPaletteOpen(open: boolean): void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const v = useContext(StudioContext);
  if (!v) throw new Error('useStudio must be used inside StudioProvider');
  return v;
}

function readRoute(): Route {
  return {
    path: window.location.pathname || '/',
    query: new URLSearchParams(window.location.search),
  };
}

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private windows); preferences then last for this visit only.
  }
}

export function StudioProvider({
  initialState,
  backgrounds,
  children,
}: {
  initialState: StudioState;
  backgrounds: BackgroundManifest;
  children: ReactNode;
}) {
  const [state, setState] = useState(initialState);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectIdState] = useState<string | null>(() =>
    storageGet('kathix.project'),
  );
  const [route, setRoute] = useState<Route>(readRoute);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<StudioContextValue['pendingConfirm']>(null);
  const [focusMode, setFocus] = useState(() => storageGet('kathix.focus') === 'on');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const handlers = useRef(new Set<EventHandler>());
  const toastSeq = useRef(0);

  const refreshState = useCallback(async () => {
    setState(await api.get<StudioState>('/api/state'));
  }, []);

  const reloadProjects = useCallback(async () => {
    const res = await api.get<{ projects: Project[] }>('/api/m/home/projects');
    setProjects(res.projects);
  }, []);

  useEffect(() => {
    void reloadProjects().catch(() => undefined);
  }, [reloadProjects, state.setupRequired]);

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.focus = focusMode ? 'on' : 'off';
  }, [focusMode]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    const forward = (event: string) => (e: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(e.data as string);
      } catch {
        data = null;
      }
      if (event === 'capabilities') void refreshState();
      for (const h of handlers.current) h(event, data);
    };
    for (const ev of ['job', 'capabilities', 'ledger', 'script', 'showrunner']) {
      source.addEventListener(ev, forward(ev));
    }
    return () => source.close();
  }, [refreshState]);

  useEffect(() => {
    if (!state.probing) return;
    const t = setInterval(() => void refreshState(), 1200);
    return () => clearInterval(t);
  }, [state.probing, refreshState]);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setRoute(readRoute());
    window.scrollTo({ top: 0 });
  }, []);

  const dismissToast = useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    [],
  );

  const toast = useCallback(
    (message: string, opts?: { undo?: Toast['undo']; error?: boolean }) => {
      const id = ++toastSeq.current;
      setToasts((t) => [...t.slice(-3), { id, message, ...opts }]);
      setTimeout(() => dismissToast(id), opts?.undo ? 9000 : 5000);
    },
    [dismissToast],
  );

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        setPendingConfirm({
          ...opts,
          resolve: (ok) => {
            setPendingConfirm(null);
            resolve(ok);
          },
        }),
      ),
    [],
  );

  const attempt = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const out = await fn();
        if (success) toast(success);
        return out;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return undefined;
        toast(
          err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong.',
          { error: true },
        );
        return undefined;
      }
    },
    [toast],
  );

  const subscribe = useCallback((h: EventHandler) => {
    handlers.current.add(h);
    return () => handlers.current.delete(h);
  }, []);

  const setProjectId = useCallback((id: string | null) => {
    setProjectIdState(id);
    storageSet('kathix.project', id);
  }, []);

  const setFocusMode = useCallback((on: boolean) => {
    setFocus(on);
    storageSet('kathix.focus', on ? 'on' : 'off');
  }, []);

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  const value: StudioContextValue = {
    state,
    refreshState,
    projects,
    project,
    activeProjectId: project?.id ?? state.scratchProjectId,
    setProjectId,
    reloadProjects,
    has: (c) => state.capabilities[c]?.available === true,
    hasAll: (cs) => cs.every((c) => state.capabilities[c]?.available === true),
    route,
    navigate,
    toast,
    toasts,
    dismissToast,
    confirm,
    pendingConfirm,
    attempt,
    subscribe,
    backgrounds,
    focusMode,
    setFocusMode,
    paletteOpen,
    setPaletteOpen,
  };
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

/** Calls `handler` for each live server event of the given kinds. */
export function useServerEvents(kinds: string[], handler: EventHandler): void {
  const { subscribe } = useStudio();
  const ref = useRef(handler);
  ref.current = handler;
  const key = kinds.join(',');
  useEffect(
    () =>
      subscribe((event, data) => {
        if (key.split(',').includes(event)) ref.current(event, data);
      }),
    [subscribe, key],
  );
}

/** Loads data from the server and reloads when `deps` change. */
export function useLoad<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): { data: T | null; error: string | null; reload: () => Promise<void>; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, deps);
  return { data, error, reload, loading };
}
