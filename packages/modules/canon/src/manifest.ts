import type { ModuleManifest } from '@kathix/kernel/shared';

export const manifest: ModuleManifest = {
  id: 'canon',
  title: 'Canon Vault',
  tagline:
    'Your story bible: every character, place, rule and promise, each traced to where you wrote it.',
  requires: ['store.ready'],
  nav: { label: 'Canon Vault', path: '/canon', order: 10, icon: 'vault', background: 'canon' },
  cli: {
    command: 'canon',
    description: 'Import material, review proposals and export the story bible',
  },
  actions: [
    {
      id: 'canon.import',
      label: 'Import episodes or notes into the canon',
      requires: ['model.structured'],
      path: '/canon?tab=import',
    },
    {
      id: 'canon.review',
      label: 'Review canon proposals',
      requires: ['store.ready'],
      path: '/canon?tab=review',
    },
    {
      id: 'canon.timeline',
      label: 'Open the story timeline',
      requires: ['store.ready'],
      path: '/canon?tab=timeline',
    },
    {
      id: 'canon.graph',
      label: 'Open the relationship graph',
      requires: ['store.ready'],
      path: '/canon?tab=graph',
    },
  ],
};
