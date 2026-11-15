import type { ModuleManifest } from '@kathix/kernel/shared';

export const manifest: ModuleManifest = {
  id: 'continuity',
  title: 'Continuity Guard',
  tagline: 'Catches contradictions with your canon and earlier episodes before the audience does.',
  requires: ['model.structured'],
  nav: {
    label: 'Continuity Guard',
    path: '/continuity',
    order: 30,
    icon: 'guard',
    background: 'continuity',
  },
  cli: {
    command: 'continuity',
    description: 'Check a draft against a reference text or a project',
  },
  actions: [
    {
      id: 'continuity.check',
      label: 'Check a script for continuity',
      requires: ['model.structured'],
      path: '/continuity',
      needsProject: true,
    },
    {
      id: 'continuity.compare',
      label: 'Compare a draft with a reference text',
      requires: ['model.structured'],
      path: '/continuity?mode=compare',
    },
    {
      id: 'continuity.health',
      label: 'See project continuity health',
      requires: ['model.structured'],
      path: '/continuity?mode=health',
      needsProject: true,
    },
  ],
};
