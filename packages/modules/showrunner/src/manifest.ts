import type { ModuleManifest } from '@kathix/kernel/shared';

export const manifest: ModuleManifest = {
  id: 'showrunner',
  title: 'Showrunner',
  tagline: 'An agent that runs your production pipeline, one approved step at a time.',
  requires: ['model.structured'],
  nav: {
    label: 'Showrunner',
    path: '/showrunner',
    order: 60,
    icon: 'agent',
    background: 'showrunner',
  },
  cli: {
    command: 'showrunner',
    description: 'Run the production pipeline with approval checkpoints',
  },
  actions: [
    {
      id: 'showrunner.start',
      label: 'Start a Showrunner run',
      requires: ['model.structured'],
      path: '/showrunner?new=1',
      needsProject: true,
    },
  ],
};
