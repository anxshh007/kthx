import type { ModuleManifest } from '@kathix/kernel/shared';

export const manifest: ModuleManifest = {
  id: 'forge',
  title: 'Hook and Title Forge',
  tagline: 'Hooks, titles and descriptions grounded in what your episode actually delivers.',
  requires: ['model.structured'],
  nav: {
    label: 'Hook and Title Forge',
    path: '/forge',
    order: 50,
    icon: 'forge',
    background: 'forge',
  },
  cli: { command: 'forge', description: 'Generate hooks, titles and descriptions from a script' },
  actions: [
    {
      id: 'forge.titles',
      label: 'Write titles for an episode',
      requires: ['model.structured'],
      path: '/forge?kind=title',
    },
    {
      id: 'forge.hooks',
      label: 'Write opening hooks',
      requires: ['model.structured'],
      path: '/forge?kind=hook',
    },
    {
      id: 'forge.shortlist',
      label: 'Compare my shortlist',
      requires: ['model.structured'],
      path: '/forge?tab=shortlist',
    },
  ],
};
