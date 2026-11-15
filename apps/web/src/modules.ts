import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ModuleUi } from '@kathix/ui';
import registry from '../../../modules.config.json';

const loaders = import.meta.glob<{ default: ModuleUi }>('../../../packages/modules/*/src/ui.tsx');

/** Module pages, built from the single registry in modules.config.json. */
export const MODULE_PAGES: Record<string, LazyExoticComponent<ComponentType>> = Object.fromEntries(
  registry.modules.flatMap((id) => {
    const loader = loaders[`../../../packages/modules/${id}/src/ui.tsx`];
    return loader ? [[id, lazy(async () => ({ default: (await loader()).default.Page }))]] : [];
  }),
);
