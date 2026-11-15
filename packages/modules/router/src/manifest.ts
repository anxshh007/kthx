import type { ModuleManifest } from '@kathix/kernel/shared';

export const manifest: ModuleManifest = {
  id: 'router',
  title: 'Model Router',
  tagline: 'Connect model providers, choose which model does which job, and watch usage.',
  requires: [],
  nav: { label: 'Model Router', path: '/router', order: 90, icon: 'router', background: 'router' },
  cli: { command: 'router', description: 'Check providers, test connections and see usage' },
  actions: [
    { id: 'router.add', label: 'Connect a model provider', requires: [], path: '/router?add=1' },
    { id: 'router.usage', label: 'See model usage', requires: [], path: '/router?tab=usage' },
  ],
};
