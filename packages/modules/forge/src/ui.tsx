import { useState } from 'react';
import type { ForgeKind } from '@kathix/prompts';
import type { ForgeItem, Script } from '@kathix/store';
import {
  ActionButton,
  Badge,
  Button,
  EmptyState,
  Field,
  Loading,
  PageHeader,
  Panel,
  Tabs,
  api,
  downloadFrom,
  useLoad,
  useStudio,
  type ModuleUi,
} from '@kathix/ui';
import { FORGE_KIND_LABELS, PLATFORMS, limitFor } from './limits';
import { manifest } from './manifest';
import type { ScoredOption } from './service';

function OptionCard({ item, reload }: { item: ForgeItem; reload: () => Promise<void> }) {
  const { attempt, toast } = useStudio();
  const [note, setNote] = useState('');
  const p = item.payload as unknown as ScoredOption;
  return (
    <article
      className="panel ai stack"
      aria-label={`${FORGE_KIND_LABELS[item.kind as ForgeKind]} option`}
    >
      <div className="row spread">
        <Badge tone="ai">{FORGE_KIND_LABELS[item.kind as ForgeKind]}</Badge>
        <span className="muted small">
          {p.length}/{p.limit} characters
        </span>
      </div>
      <p style={{ fontSize: '1.1rem', fontFamily: 'var(--script-font)' }}>{item.text}</p>
      {p.clickbait && (
        <div className="badge high" role="note" style={{ whiteSpace: 'normal' }}>
          Clickbait: the script never delivers {p.missingPayoffs.map((m) => `“${m}”`).join(', ')}
        </div>
      )}
      <table className="data">
        <tbody>
          {p.scores.map((s) => (
            <tr key={s.criterion}>
              <td style={{ width: 170 }}>{s.criterion}</td>
              <td style={{ width: 60 }}>{s.score === null ? '—' : `${s.score}/10`}</td>
              <td className="small">{s.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.supported.length > 0 && (
        <details>
          <summary className="small muted">Where the script delivers this</summary>
          {p.supported.map((s, i) => (
            <div key={i} className="quote ref small">
              {s.quote}
            </div>
          ))}
        </details>
      )}
      <div className="row">
        <Button
          size="small"
          kind={item.shortlisted ? 'primary' : 'default'}
          onClick={() =>
            void attempt(
              async () => {
                await api.post(`/api/m/forge/items/${item.id}/shortlist`, {
                  on: !item.shortlisted,
                });
                await reload();
              },
              item.shortlisted ? 'Removed from shortlist' : 'Added to shortlist',
            )
          }
        >
          {item.shortlisted ? 'On shortlist' : 'Shortlist'}
        </Button>
        <Button
          size="small"
          onClick={() =>
            void attempt(async () => {
              await navigator.clipboard.writeText(item.text);
              toast('Copied');
            })
          }
        >
          Copy
        </Button>
        <input
          className="input"
          style={{ flex: 1, minWidth: 140 }}
          placeholder="Refine with a note, e.g. shorter"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Refinement note"
        />
        <ActionButton
          size="small"
          kind="ai"
          busyLabel="Refining"
          onAction={() =>
            attempt(async () => {
              await api.post(`/api/m/forge/items/${item.id}/refine`, { note });
              setNote('');
              await reload();
            }, 'Refined options added')
          }
        >
          Refine
        </ActionButton>
      </div>
    </article>
  );
}

function Generate({ reload, items }: { reload: () => Promise<void>; items: ForgeItem[] }) {
  const { activeProjectId, project, route, attempt } = useStudio();
  const scripts = useLoad(
    () => api.get<{ scripts: Script[] }>(`/api/m/script/scripts?projectId=${activeProjectId}`),
    [activeProjectId],
  );
  const [scriptId, setScriptId] = useState('');
  const [script, setScript] = useState('');
  const [kind, setKind] = useState<ForgeKind>((route.query.get('kind') as ForgeKind) ?? 'title');
  const [platform, setPlatform] = useState('youtube');
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState('');
  const [count, setCount] = useState(5);
  const [custom, setCustom] = useState('');
  const limit = limitFor(platform, kind, custom ? Number(custom) : null);
  const scriptList = project ? (scripts.data?.scripts ?? []) : [];
  return (
    <div className="stack">
      <Panel variant="flat">
        <div className="grid three">
          {scriptList.length > 0 && (
            <Field label="Script">
              <select
                className="select"
                value={scriptId}
                onChange={(e) => setScriptId(e.target.value)}
              >
                <option value="">Paste a script</option>
                {scriptList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="What to write">
            <select
              className="select"
              value={kind}
              onChange={(e) => setKind(e.target.value as ForgeKind)}
            >
              {Object.entries(FORGE_KIND_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Platform">
            <select
              className="select"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {Object.entries(PLATFORMS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Audience">
            <input
              className="input"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="Fans of slow-burn mysteries"
            />
          </Field>
          <Field label="Tone">
            <input
              className="input"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="Eerie but warm"
            />
          </Field>
          <Field label="How many options">
            <input
              className="input"
              type="number"
              min={1}
              max={8}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
            />
          </Field>
          <Field
            label={`Length limit (default ${limitFor(platform, kind)})`}
            hint="Kathix never shows an option longer than this."
          >
            <input
              className="input"
              type="number"
              min={10}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder={String(limitFor(platform, kind))}
            />
          </Field>
        </div>
        {!scriptId && (
          <textarea
            className="textarea script"
            style={{ marginTop: 12 }}
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="Paste the script to package"
            aria-label="Script text"
          />
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <ActionButton
            kind="primary"
            busyLabel="Writing options"
            disabled={!scriptId && !script.trim()}
            onAction={() =>
              attempt(async () => {
                await api.post('/api/m/forge/generate', {
                  projectId: activeProjectId,
                  scriptId: scriptId || null,
                  script: scriptId ? null : script,
                  kind,
                  platform,
                  audience,
                  tone,
                  count,
                  maxChars: custom ? Number(custom) : null,
                });
                await reload();
              })
            }
          >
            Generate options
          </ActionButton>
          <span className="muted small">Limit: {limit} characters</span>
        </div>
      </Panel>
      {!items.length ? (
        <EmptyState
          title="No options yet"
          body="Choose a script and what to write; every option is scored and checked against the script."
        />
      ) : (
        items.map((i) => <OptionCard key={i.id} item={i} reload={reload} />)
      )}
    </div>
  );
}

function Shortlist({ items, reload }: { items: ForgeItem[]; reload: () => Promise<void> }) {
  if (!items.length)
    return (
      <EmptyState
        title="Your shortlist is empty"
        body="Shortlist favourites to compare them side by side."
      />
    );
  return (
    <div className="grid two">
      {items.map((i) => (
        <OptionCard key={i.id} item={i} reload={reload} />
      ))}
    </div>
  );
}

function Page() {
  const { activeProjectId, project, route, navigate, attempt } = useStudio();
  const tab = (route.query.get('tab') as 'generate' | 'shortlist' | null) ?? 'generate';
  const all = useLoad(
    () => api.get<{ items: ForgeItem[] }>(`/api/m/forge/items?projectId=${activeProjectId}`),
    [activeProjectId],
  );
  const shortlisted = (all.data?.items ?? []).filter((i) => i.shortlisted);
  return (
    <div className="page">
      <PageHeader
        eyebrow={project ? project.name : 'No project open'}
        title="Hook and Title Forge"
        tagline="Packaging grounded in the actual script. Anything the script does not deliver is flagged as clickbait."
        menu={
          shortlisted.length
            ? [
                {
                  label: 'Export shortlist as Markdown',
                  onSelect: () =>
                    void attempt(() =>
                      downloadFrom(
                        `/api/m/forge/shortlist.md?projectId=${activeProjectId}`,
                        'shortlist.md',
                      ),
                    ),
                },
              ]
            : []
        }
      />
      <Tabs
        label="Forge sections"
        value={tab}
        onChange={(t) => {
          navigate(`/forge?tab=${t}`, { replace: true });
        }}
        tabs={[
          { id: 'generate', label: 'Generate' },
          { id: 'shortlist', label: `Shortlist (${shortlisted.length})` },
        ]}
      />
      {!all.data ? (
        <Loading />
      ) : tab === 'generate' ? (
        <Generate reload={all.reload} items={all.data.items.slice(0, 30)} />
      ) : (
        <Shortlist items={shortlisted} reload={all.reload} />
      )}
    </div>
  );
}

const ui: ModuleUi = { manifest, Page };
export default ui;
