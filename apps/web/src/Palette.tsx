import { useEffect, useMemo, useRef, useState } from 'react';
import { api, useStudio } from '@kathix/ui';

interface Item {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

interface SearchHit {
  kind: 'script' | 'canon';
  id: string;
  title: string;
  snippet: string;
  path: string;
}

/** Global command palette (Ctrl/Cmd+K): every available action, plus search across scripts and canon. */
export function Palette() {
  const {
    state,
    hasAll,
    project,
    projects,
    setProjectId,
    navigate,
    setPaletteOpen,
    focusMode,
    setFocusMode,
  } = useStudio();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => setPaletteOpen(false);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api
        .get<{ hits: SearchHit[] }>(
          `/api/m/home/search?q=${encodeURIComponent(q)}${project ? `&projectId=${project.id}` : ''}`,
        )
        .then((r) => !ctrl.signal.aborted && setHits(r.hits))
        .catch(() => setHits([]));
    }, 160);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q, project]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const m of state.modules) {
      if (!hasAll(m.requires)) continue;
      out.push({
        id: `nav-${m.id}`,
        label: `Go to ${m.nav.label}`,
        hint: 'Open',
        run: () => navigate(m.nav.path),
      });
      for (const a of m.actions) {
        if (!hasAll(a.requires) || (a.needsProject && !project)) continue;
        out.push({ id: a.id, label: a.label, hint: m.nav.label, run: () => navigate(a.path) });
      }
    }
    for (const p of projects) {
      if (p.id !== project?.id) {
        out.push({
          id: `p-${p.id}`,
          label: `Open project: ${p.name}`,
          hint: 'Project',
          run: () => {
            setProjectId(p.id);
            navigate('/');
          },
        });
      }
    }
    out.push({
      id: 'focus',
      label: focusMode ? 'Turn off focus mode' : 'Turn on focus mode',
      hint: 'View',
      run: () => setFocusMode(!focusMode),
    });
    const needle = q.trim().toLowerCase();
    const filtered = needle ? out.filter((i) => i.label.toLowerCase().includes(needle)) : out;
    return [
      ...filtered,
      ...hits.map((h) => ({
        id: `hit-${h.kind}-${h.id}`,
        label: h.title,
        hint: h.kind === 'script' ? 'Script' : 'Canon',
        run: () => navigate(h.path),
      })),
    ];
  }, [
    state.modules,
    hasAll,
    project,
    projects,
    q,
    hits,
    navigate,
    setProjectId,
    focusMode,
    setFocusMode,
  ]);

  useEffect(() => setActive(0), [q]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          value={q}
          placeholder="Type a command, or search your scripts and canon"
          aria-label="Search commands, scripts and canon"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              const it = items[active];
              if (it) {
                close();
                it.run();
              }
            }
          }}
        />
        <ul role="listbox" aria-label="Results">
          {items.map((it, i) => (
            <li key={it.id}>
              <button
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  close();
                  it.run();
                }}
              >
                <span>{it.label}</span>
                <span className="muted small">{it.hint}</span>
              </button>
            </li>
          ))}
          {!items.length && (
            <li className="muted small" style={{ padding: 12 }}>
              Nothing matches “{q}”.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
