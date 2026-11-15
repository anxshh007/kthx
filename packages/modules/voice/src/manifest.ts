import type { ModuleManifest } from '@kathix/kernel/shared';

export const manifest: ModuleManifest = {
  id: 'voice',
  title: 'Voice Mirror',
  tagline: 'Keeps you sounding like yourself, measured line by line.',
  requires: ['store.ready'],
  nav: { label: 'Voice Mirror', path: '/voice', order: 40, icon: 'voice', background: 'voice' },
  cli: {
    command: 'voice',
    description: 'Build a voice profile, score a draft and export a training dataset',
  },
  actions: [
    {
      id: 'voice.match',
      label: 'Score a draft against my voice',
      requires: ['store.ready'],
      path: '/voice?tab=match',
    },
    {
      id: 'voice.profiles',
      label: 'Manage voice profiles',
      requires: ['store.ready'],
      path: '/voice?tab=profiles',
      needsProject: true,
    },
    {
      id: 'voice.dataset',
      label: 'Export a voice training dataset',
      requires: ['store.ready'],
      path: '/voice?tab=profiles',
      needsProject: true,
    },
  ],
};
