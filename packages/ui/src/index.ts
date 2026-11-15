export * from './api';
export * from './studio';
export * from './components';
export * from './icons';

import type { ComponentType } from 'react';
import type { ModuleManifest } from '@kathix/kernel/shared';

/** What every module's `ui.tsx` exports by default. */
export interface ModuleUi {
  manifest: ModuleManifest;
  Page: ComponentType;
}
