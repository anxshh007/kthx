import type { ModuleManifest } from '@kathix/kernel/shared';

export const manifest: ModuleManifest = {
  id: 'home',
  title: 'Studio Home',
  tagline: 'Your projects, your next step and everything that happened lately.',
  requires: ['store.ready'],
  nav: { label: 'Studio Home', path: '/', order: 0, icon: 'home', background: 'home' },
  cli: { command: 'home', description: 'List and create projects, and see the next best action' },
  actions: [
    {
      id: 'home.new-project',
      label: 'Create a project',
      requires: ['store.ready'],
      path: '/?new=1',
    },
    {
      id: 'home.sample',
      label: 'Open the sample project',
      requires: ['store.ready'],
      path: '/?sample=1',
    },
  ],
};
