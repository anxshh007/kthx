import { diffWordsWithSpace } from 'diff';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import type { EvidenceRef } from '@kathix/kernel/shared';
import { Icon } from './icons';
import { readUpload } from './api';
import { useStudio } from './studio';

type ButtonKind = 'primary' | 'ai' | 'danger' | 'ghost' | 'default';

/**
 * Controls are never greyed out. A button whose action is not ready yet (for
 * example, a form still missing its text) stays clickable and says what it needs.
 */
export function Button({
  kind = 'default',
  size,
  busy,
  className,
  children,
  disabled,
  needs,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: ButtonKind;
  size?: 'small';
  busy?: boolean;
  needs?: string;
}) {
  const { toast } = useStudio();
  const cls = ['btn', kind !== 'default' ? kind : '', size ?? '', className ?? '']
    .filter(Boolean)
    .join(' ');
  const waiting = Boolean(disabled) && !busy;
  return (
    <button
      type="button"
      className={cls}
      aria-busy={busy ? 'true' : undefined}
      {...rest}
      disabled={busy}
      onClick={waiting ? () => toast(needs ?? 'Fill in what this needs first.') : onClick}
    >
      {children}
    </button>
  );
}

/** A button whose async handler shows progress and can't be double-fired. */
export function ActionButton({
  onAction,
  children,
  busyLabel,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  kind?: ButtonKind;
  size?: 'small';
  busyLabel?: string;
  onAction: () => Promise<unknown> | unknown;
}) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  return (
    <Button
      {...rest}
      busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onAction();
        } finally {
          if (mounted.current) setBusy(false);
        }
      }}
    >
      {busy && busyLabel ? busyLabel : children}
    </Button>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void | Promise<void>;
  danger?: boolean;
}

/** Secondary actions live here, so each screen keeps one primary action. */
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!items.length) return null;
  return (
    <div className="menu-wrap" ref={ref}>
      <Button
        kind="ghost"
        className="icon"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </Button>
      {open && (
        <div className="menu" role="menu" id={id}>
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={it.danger ? 'danger' : undefined}
              onClick={() => {
                setOpen(false);
                void it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  tagline,
  primary,
  menu,
}: {
  eyebrow?: string;
  title: string;
  tagline?: ReactNode;
  primary?: ReactNode;
  menu?: MenuItem[];
}) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {tagline && <p className="tagline">{tagline}</p>}
      </div>
      <div className="row">
        {primary}
        {menu && <Menu label="More actions" items={menu} />}
      </div>
    </header>
  );
}

export function Panel({
  title,
  actions,
  children,
  variant,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  variant?: 'flat' | 'ai';
  className?: string;
}) {
  return (
    <section className={['panel', variant ?? '', className ?? ''].filter(Boolean).join(' ')}>
      {(title || actions) && (
        <div className="panel-title">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span>{label}</span>
    </label>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {body && <p className="muted">{body}</p>}
      {action}
    </div>
  );
}

export function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: 'warm' | 'ai' | 'high' | 'medium' | 'ok';
}) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

export function Meter({ value, label, ai }: { value: number; label: string; ai?: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={`meter ${ai ? 'ai' : ''}`}
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button');
    first?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`dialog ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="row spread">
          <h2>{title}</h2>
          <Button kind="ghost" className="icon" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function DiffView({ before, after }: { before: string; after: string }) {
  const parts = diffWordsWithSpace(before, after);
  return (
    <div className="diff" aria-label="Proposed change">
      {parts.map((p, i) =>
        p.added ? (
          <ins key={i}>{p.value}</ins>
        ) : p.removed ? (
          <del key={i}>{p.value}</del>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </div>
  );
}

export function EvidenceList({
  items,
  onOpen,
  empty,
}: {
  items: EvidenceRef[];
  onOpen?: (e: EvidenceRef) => void;
  empty?: string;
}) {
  const [open, setOpen] = useState<EvidenceRef | null>(null);
  if (!items.length) return empty ? <p className="muted small">{empty}</p> : null;
  return (
    <div className="stack tight">
      <div className="evidence" aria-label="Evidence used">
        {items.map((e) => (
          <button
            key={`${e.sourceId}-${e.start}`}
            title={e.quote}
            onClick={() => {
              setOpen(open?.sourceId === e.sourceId && open.start === e.start ? null : e);
              onOpen?.(e);
            }}
          >
            {e.label}
          </button>
        ))}
      </div>
      {open && (
        <div className="quote ai small">
          <strong>{open.label}</strong>
          {'\n'}
          {open.quote}
        </div>
      )}
    </div>
  );
}

export interface SuggestionView {
  id: string;
  originalText: string;
  proposedText: string;
  reason: string;
  evidence: EvidenceRef[];
  model?: string;
}

/** AI proposals: diff, reason and evidence, with accept, edit-then-accept or reject. */
export function SuggestionCard({
  suggestion,
  onAccept,
  onReject,
  acceptLabel = 'Accept',
  emptyEvidence = 'No canon or past passages were used for this suggestion.',
}: {
  suggestion: SuggestionView;
  onAccept: (finalText: string, edited: boolean) => Promise<unknown>;
  onReject: (reason: string) => Promise<unknown>;
  acceptLabel?: string;
  emptyEvidence?: string;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'reject'>('view');
  const [draft, setDraft] = useState(suggestion.proposedText);
  const [reason, setReason] = useState('');
  return (
    <article className="panel ai stack" aria-label="AI suggestion">
      <div className="row spread">
        <Badge tone="ai">AI suggestion</Badge>
        {suggestion.model && <span className="muted small">{suggestion.model}</span>}
      </div>
      {mode === 'edit' ? (
        <textarea
          className="textarea script"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Edit suggestion before accepting"
        />
      ) : (
        <DiffView before={suggestion.originalText} after={suggestion.proposedText} />
      )}
      <p className="small">
        <strong>Why: </strong>
        {suggestion.reason}
      </p>
      <EvidenceList items={suggestion.evidence} empty={emptyEvidence} />
      {mode === 'reject' && (
        <Field label="What was wrong? (optional, shapes the next attempt)">
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Too formal for this character"
          />
        </Field>
      )}
      <div className="row">
        {mode === 'view' && (
          <>
            <ActionButton kind="primary" onAction={() => onAccept(suggestion.proposedText, false)}>
              {acceptLabel}
            </ActionButton>
            <Button onClick={() => setMode('edit')}>Edit, then accept</Button>
            <Button kind="ghost" onClick={() => setMode('reject')}>
              Reject
            </Button>
          </>
        )}
        {mode === 'edit' && (
          <>
            <ActionButton
              kind="primary"
              onAction={() => onAccept(draft, draft !== suggestion.proposedText)}
            >
              Accept my edit
            </ActionButton>
            <Button kind="ghost" onClick={() => setMode('view')}>
              Back
            </Button>
          </>
        )}
        {mode === 'reject' && (
          <>
            <ActionButton kind="danger" onAction={() => onReject(reason)}>
              Reject suggestion
            </ActionButton>
            <Button kind="ghost" onClick={() => setMode('view')}>
              Back
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

export function Background({ slot }: { slot: string }) {
  const { backgrounds } = useStudio();
  const [loaded, setLoaded] = useState(false);
  const entry = backgrounds.slots[slot];
  useEffect(() => setLoaded(false), [slot]);
  if (slot === 'script' || !entry) {
    return (
      <div className="bg-layer" aria-hidden="true">
        <div className="bg-paper" />
      </div>
    );
  }
  const srcset = (list: { width: number; url: string }[]) =>
    list.map((s) => `${s.url} ${s.width}w`).join(', ');
  return (
    <div className="bg-layer" aria-hidden="true">
      <img className="bg-placeholder" src={entry.placeholder} alt="" />
      <picture>
        <source type="image/avif" srcSet={srcset(entry.avif)} sizes="100vw" />
        <source type="image/webp" srcSet={srcset(entry.webp)} sizes="100vw" />
        <img
          className={`bg-full ${loaded ? 'loaded' : ''}`}
          src={entry.webp[0]?.url}
          alt=""
          onLoad={() => setLoaded(true)}
          decoding="async"
        />
      </picture>
      <div className="bg-scrim" />
    </div>
  );
}

export function FileButton({
  label,
  accept,
  multiple,
  onFiles,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  onFiles: (files: { name: string; text?: string; base64?: string }[]) => Promise<void> | void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        aria-label={label}
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          setBusy(true);
          try {
            await onFiles(await Promise.all(files.map(readUpload)));
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button busy={busy} onClick={() => ref.current?.click()}>
        <Icon name="upload" size={16} />
        {label}
      </Button>
    </>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <p className="muted" role="status">
      {label}…
    </p>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="panel flat row spread" role="alert">
      <span>{message}</span>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}
