import { useState } from 'react';
import type { ProviderStatus, TierMap } from '@kathix/models';
import {
  ActionButton,
  Badge,
  Button,
  Dialog,
  Field,
  Loading,
  PageHeader,
  Panel,
  Switch,
  Tabs,
  api,
  useLoad,
  useStudio,
  type ModuleUi,
} from '@kathix/ui';
import { manifest } from './manifest';

type Row = ProviderStatus & { removable: boolean };
interface KindInfo {
  kind: string;
  label: string;
  needsKey: boolean;
  needsBaseUrl: boolean;
}
interface Usage {
  byModule: {
    module: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cost: number | null;
    cached: number;
  }[];
  byDay: {
    day: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cost: number | null;
  }[];
  byProvider: {
    provider: string;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  prices: Record<string, { input: number; output: number }>;
}

function AddProvider({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { attempt, toast } = useStudio();
  const kinds = useLoad(() => api.get<{ kinds: KindInfo[] }>('/api/m/router/kinds'), []);
  const [kind, setKind] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const info = kinds.data?.kinds.find((k) => k.kind === kind);
  return (
    <Dialog title="Connect a model provider" onClose={onClose}>
      <Field label="Provider">
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
          {(kinds.data?.kinds ?? []).map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      {info?.needsBaseUrl && (
        <Field label="Base URL">
          <input
            className="input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
          />
        </Field>
      )}
      {(info?.needsKey || info?.needsBaseUrl) && (
        <Field label="API key">
          <input
            className="input"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>
      )}
      <ActionButton
        kind="primary"
        busyLabel="Testing"
        disabled={Boolean(info?.needsKey && !apiKey) || Boolean(info?.needsBaseUrl && !baseUrl)}
        onAction={async () => {
          const r = await attempt(() =>
            api.post<{ ok: boolean; message: string }>('/api/m/router/providers', {
              kind,
              apiKey: apiKey || undefined,
              baseUrl: baseUrl || undefined,
            }),
          );
          if (!r) return;
          toast(r.message, { error: !r.ok });
          if (r.ok) {
            onAdded();
            onClose();
          }
        }}
      >
        Test and connect
      </ActionButton>
    </Dialog>
  );
}

function Providers({
  rows,
  localOnly,
  reload,
}: {
  rows: Row[];
  localOnly: boolean;
  reload: () => Promise<void>;
}) {
  const { attempt, has, toast, confirm } = useStudio();
  return (
    <div className="stack">
      {has('model.local') && (
        <Panel variant="flat">
          <Switch
            label="Local-only mode: never send material to hosted providers"
            checked={localOnly}
            onChange={(on) =>
              void attempt(() => api.post('/api/m/router/local-only', { on }).then(reload))
            }
          />
        </Panel>
      )}
      {rows.map((p) => (
        <Panel key={p.config.id} variant="flat">
          <div className="row spread">
            <div className="stack tight">
              <div className="row">
                <h3>{p.config.label}</h3>
                <Badge tone={p.status === 'ok' ? 'ok' : p.status === 'error' ? 'high' : undefined}>
                  {p.status === 'ok'
                    ? 'Connected'
                    : p.status === 'error'
                      ? 'Not answering'
                      : 'Not checked'}
                </Badge>
                {p.config.kind === 'ollama' && <Badge>Local</Badge>}
              </div>
              <span className="muted small">
                {p.models.filter((m) => m.kind === 'chat').length} text models ·{' '}
                {p.models.filter((m) => m.kind === 'embedding').length} embedding models ·
                structured answers:{' '}
                {p.nativeStructured === null
                  ? 'not checked'
                  : p.nativeStructured
                    ? 'native'
                    : 'by instruction'}
                {p.inFlight ? ` · ${p.inFlight} running` : ''}
              </span>
              {p.lastError && (
                <span className="small" style={{ color: 'var(--danger)' }}>
                  {p.lastError}
                </span>
              )}
            </div>
            <div className="row">
              <Switch
                label={p.config.enabled ? 'On' : 'Off'}
                checked={p.config.enabled}
                onChange={(enabled) =>
                  void attempt(() =>
                    api
                      .post(`/api/m/router/providers/${p.config.id}/enabled`, { enabled })
                      .then(reload),
                  )
                }
              />
              <ActionButton
                size="small"
                onAction={async () => {
                  const r = await attempt(() =>
                    api.post<{ ok: boolean; message: string }>(
                      `/api/m/router/providers/${p.config.id}/test`,
                    ),
                  );
                  if (r) toast(r.message, { error: !r.ok });
                  await reload();
                }}
              >
                Test
              </ActionButton>
              {p.removable && (
                <Button
                  size="small"
                  kind="ghost"
                  onClick={async () => {
                    if (
                      !(await confirm({
                        title: `Remove ${p.config.label}?`,
                        body: 'Its key is deleted from this computer. You can connect it again later.',
                        confirmLabel: 'Remove',
                        danger: true,
                      }))
                    )
                      return;
                    await attempt(
                      () => api.del(`/api/m/router/providers/${p.config.id}`).then(reload),
                      'Provider removed',
                    );
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="small muted" htmlFor={`rpm-${p.config.id}`}>
              Rate budget (requests per minute)
            </label>
            <input
              id={`rpm-${p.config.id}`}
              className="input"
              style={{ width: 100 }}
              type="number"
              min={1}
              defaultValue={p.config.rpm}
              onBlur={(e) => {
                const rpm = Number(e.target.value);
                if (rpm > 0 && rpm !== p.config.rpm)
                  void attempt(
                    () =>
                      api.post(`/api/m/router/providers/${p.config.id}/rpm`, { rpm }).then(reload),
                    'Rate budget saved',
                  );
              }}
            />
          </div>
        </Panel>
      ))}
    </div>
  );
}

function Tiers({ rows }: { rows: Row[] }) {
  const { attempt } = useStudio();
  const tiers = useLoad(() => api.get<{ tiers: TierMap }>('/api/m/router/tiers'), []);
  if (!tiers.data) return <Loading />;
  const options = rows
    .filter((r) => r.config.enabled && r.config.kind !== 'adaption')
    .flatMap((r) =>
      r.models
        .filter((m) => m.kind === 'chat')
        .map((m) => ({
          value: `${r.config.id}::${m.id}`,
          label: `${r.config.label} · ${m.label}`,
        })),
    );
  const desc = {
    fast: 'Inline rewrites, tightening, titles',
    balanced: 'Canon extraction, continuing scenes, hooks',
    deep: 'Continuity across episodes, Showrunner planning',
  };
  return (
    <div className="grid three">
      {(['fast', 'balanced', 'deep'] as const).map((t) => {
        const first = tiers.data?.tiers[t][0];
        return (
          <Panel key={t} variant="flat" title={t[0]?.toUpperCase() + t.slice(1)}>
            <p className="muted small">{desc[t]}</p>
            <Field label="Model">
              <select
                className="select"
                value={first ? `${first.providerId}::${first.model}` : ''}
                onChange={(e) => {
                  const [providerId, model] = e.target.value.split('::') as [string, string];
                  void attempt(
                    () =>
                      api
                        .put(`/api/m/router/tiers/${t}`, { targets: [{ providerId, model }] })
                        .then(tiers.reload),
                    'Tier updated',
                  );
                }}
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <p className="small muted">
              Fails over to:{' '}
              {(tiers.data?.tiers[t] ?? [])
                .slice(1)
                .map((x) => `${x.providerId}/${x.model}`)
                .join(', ') || 'no other models'}
            </p>
          </Panel>
        );
      })}
    </div>
  );
}

function UsageView() {
  const { attempt } = useStudio();
  const usage = useLoad(() => api.get<Usage>('/api/m/router/usage'), []);
  if (!usage.data) return <Loading />;
  const u = usage.data;
  const fmt = (c: number | null) => (c === null ? '—' : `$${c.toFixed(4)}`);
  return (
    <div className="stack">
      <Panel variant="flat" title="By module">
        <table className="data">
          <thead>
            <tr>
              <th>Module</th>
              <th>Calls</th>
              <th>From cache</th>
              <th>Input tokens</th>
              <th>Output tokens</th>
              <th>Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {u.byModule.map((m) => (
              <tr key={m.module}>
                <td>{m.module}</td>
                <td>{m.calls}</td>
                <td>{m.cached}</td>
                <td>{m.inputTokens}</td>
                <td>{m.outputTokens}</td>
                <td>{fmt(m.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!u.byModule.length && <p className="muted">No model calls yet.</p>}
      </Panel>
      <Panel variant="flat" title="By day">
        <table className="data">
          <thead>
            <tr>
              <th>Day</th>
              <th>Calls</th>
              <th>Tokens</th>
              <th>Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {u.byDay.map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td>{d.calls}</td>
                <td>{d.inputTokens + d.outputTokens}</td>
                <td>{fmt(d.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel variant="flat" title="Prices for cost estimates (per million tokens)">
        <p className="muted small">
          Kathix has no built-in price list. Enter your provider's prices to see estimated cost.
        </p>
        <table className="data">
          <thead>
            <tr>
              <th>Model</th>
              <th>Input $</th>
              <th>Output $</th>
            </tr>
          </thead>
          <tbody>
            {u.byProvider.map((p) => {
              const key = `${p.provider}/${p.model}`;
              const price = u.prices[key];
              const save = (field: 'input' | 'output', v: number) =>
                void attempt(
                  () =>
                    api
                      .put('/api/m/router/prices', {
                        providerId: p.provider,
                        model: p.model,
                        input: field === 'input' ? v : (price?.input ?? 0),
                        output: field === 'output' ? v : (price?.output ?? 0),
                      })
                      .then(usage.reload),
                  'Price saved',
                );
              return (
                <tr key={key}>
                  <td>{key}</td>
                  {(['input', 'output'] as const).map((f) => (
                    <td key={f}>
                      <input
                        className="input"
                        aria-label={`${f} price for ${key}`}
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={price?.[f] ?? ''}
                        style={{ width: 110 }}
                        onBlur={(e) => e.target.value !== '' && save(f, Number(e.target.value))}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function AdaptionPanel() {
  const { attempt } = useStudio();
  const info = useLoad(
    () =>
      api.get<{ configured: boolean; model: string; models: string[]; available: boolean }>(
        '/api/m/router/adaption',
      ),
    [],
  );
  const [model, setModel] = useState('');
  if (!info.data?.configured) return null;
  return (
    <Panel variant="flat" title="Adaption voice model">
      <p className="muted small">
        Pick the model you trained on your Voice Mirror dataset. Script Studio can then write with
        it. Status: {info.data.available ? 'answering' : 'not answering yet'}.
      </p>
      <div className="row">
        <input
          className="input"
          style={{ maxWidth: 360 }}
          list="adaption-models"
          placeholder={info.data.model || 'Model id or stack:<slug>'}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          aria-label="Adaption model id"
        />
        <datalist id="adaption-models">
          {info.data.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <ActionButton
          disabled={!model}
          onAction={() =>
            attempt(
              () => api.put('/api/m/router/adaption', { model }).then(info.reload),
              'Voice model saved',
            )
          }
        >
          Use this model
        </ActionButton>
      </div>
    </Panel>
  );
}

function Page() {
  const { route, navigate, refreshState } = useStudio();
  const tab = (route.query.get('tab') as 'providers' | 'tiers' | 'usage' | null) ?? 'providers';
  const [adding, setAdding] = useState(route.query.get('add') === '1');
  const data = useLoad(
    () => api.get<{ providers: Row[]; localOnly: boolean }>('/api/m/router/providers'),
    [],
  );
  const reload = async () => {
    await data.reload();
    await refreshState();
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="Platform"
        title="Model Router"
        tagline="Every model call goes through here: rate budgets, a response cache, automatic failover and a usage meter."
        primary={
          <Button kind="primary" onClick={() => setAdding(true)}>
            Connect a provider
          </Button>
        }
      />
      <Tabs
        label="Model Router sections"
        tabs={[
          { id: 'providers', label: 'Providers' },
          { id: 'tiers', label: 'Task tiers' },
          { id: 'usage', label: 'Usage' },
        ]}
        value={tab}
        onChange={(t) => {
          navigate(`/router?tab=${t}`, { replace: true });
        }}
      />
      {!data.data ? (
        <Loading />
      ) : tab === 'providers' ? (
        <>
          <Providers rows={data.data.providers} localOnly={data.data.localOnly} reload={reload} />
          <AdaptionPanel />
        </>
      ) : tab === 'tiers' ? (
        <Tiers rows={data.data.providers} />
      ) : (
        <UsageView />
      )}
      {adding && <AddProvider onClose={() => setAdding(false)} onAdded={() => void reload()} />}
    </div>
  );
}

const ui: ModuleUi = { manifest, Page };
export default ui;
