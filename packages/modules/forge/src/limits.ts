import type { ForgeKind } from '@kathix/prompts';

export const FORGE_KIND_LABELS: Record<ForgeKind, string> = {
  hook: 'Opening hook',
  title: 'Title',
  thumbnail: 'Thumbnail text',
  description: 'One-line description',
};

/** Character limits per platform, enforced in code. Hard platform limits where one exists, else the visible-before-truncation length. */
export const PLATFORMS: Record<string, { label: string; limits: Record<ForgeKind, number> }> = {
  youtube: { label: 'YouTube', limits: { title: 100, thumbnail: 30, description: 150, hook: 220 } },
  podcast: {
    label: 'Podcast apps',
    limits: { title: 100, thumbnail: 30, description: 250, hook: 300 },
  },
  tiktok: { label: 'TikTok', limits: { title: 100, thumbnail: 25, description: 150, hook: 120 } },
  reels: {
    label: 'Instagram Reels',
    limits: { title: 100, thumbnail: 25, description: 125, hook: 120 },
  },
  webfiction: {
    label: 'Web fiction site',
    limits: { title: 80, thumbnail: 30, description: 200, hook: 300 },
  },
};

export function limitFor(platform: string, kind: ForgeKind, custom?: number | null): number {
  const base = PLATFORMS[platform]?.limits[kind] ?? 150;
  return custom && custom > 0 ? Math.min(custom, 2000) : base;
}
