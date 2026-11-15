export const CAPABILITIES = [
  'model.text',
  'model.structured',
  'model.embeddings',
  'model.custom.adaption',
  'model.local',
  'store.ready',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface CapabilityState {
  available: boolean;
  detail: string;
  checkedAt: string;
}

export type CapabilityMap = Record<Capability, CapabilityState>;

export type BackgroundSlot =
  | 'home'
  | 'canon'
  | 'continuity'
  | 'voice'
  | 'forge'
  | 'showrunner'
  | 'script'
  | 'ledger'
  | 'router';

export interface NavEntry {
  label: string;
  path: string;
  order: number;
  icon: string;
  background: BackgroundSlot;
}

export interface PaletteAction {
  id: string;
  label: string;
  requires: Capability[];
  path: string;
  keywords?: string[];
  needsProject?: boolean;
}

export interface ModuleManifest {
  id: string;
  title: string;
  tagline: string;
  requires: Capability[];
  nav: NavEntry;
  cli: { command: string; description: string };
  actions: PaletteAction[];
}

export type ProjectType = 'video' | 'podcast' | 'fiction' | 'comic';

export interface ProjectTypeInfo {
  label: string;
  unit: string;
  unitPlural: string;
  wordsPerMinute: number;
  runtimeLabel: string;
}

export const PROJECT_TYPES: Record<ProjectType, ProjectTypeInfo> = {
  video: {
    label: 'Video series',
    unit: 'Episode',
    unitPlural: 'Episodes',
    wordsPerMinute: 150,
    runtimeLabel: 'spoken runtime',
  },
  podcast: {
    label: 'Podcast',
    unit: 'Episode',
    unitPlural: 'Episodes',
    wordsPerMinute: 155,
    runtimeLabel: 'spoken runtime',
  },
  fiction: {
    label: 'Web fiction',
    unit: 'Chapter',
    unitPlural: 'Chapters',
    wordsPerMinute: 230,
    runtimeLabel: 'reading time',
  },
  comic: {
    label: 'Comic script',
    unit: 'Issue',
    unitPlural: 'Issues',
    wordsPerMinute: 200,
    runtimeLabel: 'reading time',
  },
};

export const CANON_TYPES = [
  'character',
  'place',
  'object',
  'faction',
  'rule',
  'fact',
  'event',
  'gag',
  'promise',
] as const;

export type CanonType = (typeof CANON_TYPES)[number];

export const CANON_TYPE_LABELS: Record<CanonType, string> = {
  character: 'Character',
  place: 'Place',
  object: 'Object',
  faction: 'Faction',
  rule: 'Rule of the world',
  fact: 'Fact',
  event: 'Timeline event',
  gag: 'Running gag',
  promise: 'Open promise',
};

export interface EvidenceRef {
  sourceKind: 'canon' | 'script' | 'doc' | 'reference' | 'sample';
  sourceId: string;
  label: string;
  quote: string;
  start: number;
  end: number;
}

export type Origin = 'human' | 'ai' | 'ai_edited';
