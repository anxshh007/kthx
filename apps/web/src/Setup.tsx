import { useState } from 'react';
import { PROJECT_TYPES, type ProjectType } from '@kathix/kernel/shared';
import type { Project } from '@kathix/store';
import { ActionButton, Background, Button, Field, api, useLoad, useStudio } from '@kathix/ui';

interface KindInfo {
  kind: string;
  label: string;
  needsKey: boolean;
  needsBaseUrl: boolean;
}

interface ProviderRow {
  config: { id: string; label: string; kind: string };
  status: string;
  lastError: string | null;
}

/** First launch: connect one model provider. This screen is the only one shown until that works. */
export function ConnectScreen({ onConnected }: { onConnected: () => void }) {
  const { refreshState, attempt, toast } = useStudio();
  const kinds = useLoad(() => api.get<{ kinds: KindInfo[] }>('/api/m/router/kinds'), []);
  const providers = useLoad(
    () => api.get<{ providers: ProviderRow[] }>('/api/m/router/providers'),
    [],
  );
  const [kind, setKind] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const info = kinds.data?.kinds.find((k) => k.kind === kind);
  const failing =
    providers.data?.providers.filter((p) => p.status === 'error' && p.config.kind !== 'ollama') ??
    [];

  const connect = async () => {
    const res = await attempt(() =>
      api.post<{ ok: boolean; message: string }>('/api/m/router/providers', {
        kind,
        apiKey,
        baseUrl: baseUrl || undefined,
      }),
    );
    if (!res) return;
    if (!res.ok) {
      toast(res.message, { error: true });
      return;
    }
    setApiKey('');
    toast(res.message);
    await api.post('/api/capabilities/refresh');
    await refreshState();
    onConnected();
  };

  return (
    <>
      <Background slot="home" />
      <main className="splash">
        <section className="panel setup-card stack" aria-labelledby="setup-title">
          <div className="brand">
            <div className="brand-mark">K</div>
            <span>Kathix</span>
          </div>
          <h1 id="setup-title">Connect a writing model</h1>
          <p className="muted">
            Kathix keeps your stories on this computer. It only sends the passages you work on to
            the model you connect here. Your key is stored encrypted on this machine.
          </p>
          {failing.map((p) => (
            <p key={p.config.id} className="small" role="alert">
              {p.config.label} could not connect: {p.lastError}
            </p>
          ))}
          <Field label="Model provider">
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
              {(kinds.data?.kinds ?? []).map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          {info?.needsBaseUrl && (
            <Field label="Address" hint="For example https://api.groq.com/openai/v1">
              <input
                className="input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://"
              />
            </Field>
          )}
          {(info?.needsKey || info?.needsBaseUrl) && (
            <Field label={info?.needsKey ? 'API key' : 'API key (if the service needs one)'}>
              <input
                className="input"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your key"
              />
            </Field>
          )}
          {info?.kind === 'ollama' && (
            <p className="small muted">
              Kathix will look for Ollama on this computer at its usual address.
            </p>
          )}
          <ActionButton
            kind="primary"
            busyLabel="Testing the connection"
            disabled={Boolean(info?.needsKey && !apiKey) || Boolean(info?.needsBaseUrl && !baseUrl)}
            onAction={connect}
          >
            Test and connect
          </ActionButton>
        </section>
      </main>
    </>
  );
}

/** Second launch screen: open the sample or start a project. */
export function ChooseScreen({ onDone }: { onDone: () => void }) {
  const { reloadProjects, setProjectId, attempt, navigate } = useStudio();
  const [name, setName] = useState('');
  const [type, setType] = useState<ProjectType>('podcast');
  const openSample = async () => {
    const res = await attempt(() => api.post<{ project: Project }>('/api/m/home/sample'));
    if (!res) return;
    await reloadProjects();
    setProjectId(res.project.id);
    navigate('/');
    onDone();
  };
  const create = async () => {
    const res = await attempt(() =>
      api.post<{ project: Project }>('/api/m/home/projects', { name: name.trim(), type }),
    );
    if (!res) return;
    await reloadProjects();
    setProjectId(res.project.id);
    navigate('/');
    onDone();
  };
  return (
    <>
      <Background slot="home" />
      <main className="splash">
        <section className="panel setup-card stack" aria-labelledby="choose-title">
          <h1 id="choose-title">You're connected. Where shall we start?</h1>
          <ActionButton kind="primary" busyLabel="Opening the sample" onAction={openSample}>
            Open the sample project
          </ActionButton>
          <p className="muted small">
            An original three-episode audio drama with its story bible, ready to explore.
          </p>
          <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
          <h2>Start my own</h2>
          <Field label="Project name">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My series"
            />
          </Field>
          <Field label="What are you making?">
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
          <div className="row">
            <ActionButton disabled={!name.trim()} onAction={create}>
              Start my own
            </ActionButton>
            <Button kind="ghost" onClick={onDone}>
              Skip for now
            </Button>
          </div>
        </section>
      </main>
    </>
  );
}
