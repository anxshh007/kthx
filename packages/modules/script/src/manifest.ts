import type { ModuleManifest } from '@kathix/kernel/shared';

export const manifest: ModuleManifest = {
  id: 'script',
  title: 'Script Studio',
  tagline: 'Write with a co-writer that proposes and never imposes.',
  requires: ['store.ready'],
  nav: { label: 'Script Studio', path: '/script', order: 20, icon: 'script', background: 'script' },
  cli: { command: 'script', description: 'Ask the co-writer for a suggestion and export scripts' },
  actions: [
    {
      id: 'script.new',
      label: 'Start a new script',
      requires: ['store.ready'],
      path: '/script?new=1',
    },
    {
      id: 'script.list',
      label: 'Open the script list',
      requires: ['store.ready'],
      path: '/script',
    },
  ],
};
