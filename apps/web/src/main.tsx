import '@kathix/ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { api, StudioProvider, type BackgroundManifest, type StudioState } from '@kathix/ui';
import { App } from './App';

async function boot() {
  const root = createRoot(document.getElementById('root') as HTMLElement);
  try {
    const [state, backgrounds] = await Promise.all([
      api.get<StudioState>('/api/state'),
      fetch('/backgrounds/manifest.json')
        .then((r) => (r.ok ? (r.json() as Promise<BackgroundManifest>) : { slots: {} }))
        .catch(() => ({ slots: {} })),
    ]);
    root.render(
      <StrictMode>
        <StudioProvider initialState={state} backgrounds={backgrounds}>
          <App />
        </StudioProvider>
      </StrictMode>,
    );
  } catch {
    root.render(
      <div className="splash">
        <p>Kathix could not reach its server. Start it with `pnpm start` and reload this page.</p>
      </div>,
    );
  }
}

void boot();
