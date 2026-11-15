import type { ModuleManifest } from '@kathix/kernel/shared';

export const manifest: ModuleManifest = {
  id: 'ledger',
  title: 'Provenance Ledger',
  tagline: 'A record of every AI suggestion and how much of each script is yours.',
  requires: ['store.ready'],
  nav: {
    label: 'Provenance Ledger',
    path: '/ledger',
    order: 80,
    icon: 'ledger',
    background: 'ledger',
  },
  cli: {
    command: 'ledger',
    description: 'Show authorship shares and export an AI disclosure statement',
  },
  actions: [
    {
      id: 'ledger.disclosure',
      label: 'Export an AI disclosure statement',
      requires: ['store.ready'],
      path: '/ledger?disclosure=1',
      needsProject: true,
    },
  ],
};
