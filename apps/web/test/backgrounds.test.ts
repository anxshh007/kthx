import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../../tests/helpers';

const publicDir = path.join(ROOT, 'apps', 'web', 'public', 'backgrounds');
const css = readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'styles.css'), 'utf8');
const manifest = JSON.parse(readFileSync(path.join(publicDir, 'manifest.json'), 'utf8')) as {
  slots: Record<
    string,
    {
      kind: string;
      placeholder: string;
      avif: { width: number; url: string }[];
      webp: { width: number; url: string }[];
    }
  >;
};

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (r: number, g: number, b: number) =>
  0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const hex = (name: string) => {
  const m = new RegExp(`--${name}: #([0-9a-f]{6});`).exec(css);
  if (!m) throw new Error(`token --${name} missing`);
  const h = m[1] as string;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};

/** The scrim stops, read straight from the stylesheet so the test tracks the real CSS. */
function scrimStops(): { at: number; alpha: number; rgb: [number, number, number] }[] {
  const rule = /\.bg-scrim \{([^}]*)\}/.exec(css)?.[1] ?? '';
  const block =
    /linear-gradient\(\s*180deg,([\s\S]*?)\)\s*,/.exec(rule.replace(/\)\s*(\d+%)/g, ') $1'))?.[1] ??
    '';
  return [...block.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)\s*(\d+)%/g)].map((m) => ({
    rgb: [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number],
    alpha: Number(m[4]),
    at: Number(m[5]) / 100,
  }));
}

describe('background images', () => {
  it('every slot ships AVIF and WebP at 1920, 2560 and 3840 with a placeholder', () => {
    for (const [slot, s] of Object.entries(manifest.slots)) {
      expect(s.placeholder.startsWith('data:image/webp;base64,'), slot).toBe(true);
      expect(s.avif.map((x) => x.width)).toEqual([1920, 2560, 3840]);
      for (const f of [...s.avif, ...s.webp])
        expect(existsSync(path.join(ROOT, 'apps', 'web', 'public', f.url)), f.url).toBe(true);
      expect(statSync(path.join(publicDir, `${slot}-1920.avif`)).size).toBeLessThan(400 * 1024);
    }
  });

  it('masters are 3840 by 2160 and photographs are credited', async () => {
    const credits = readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
    for (const [slot, s] of Object.entries(manifest.slots)) {
      const meta = await sharp(
        path.join(ROOT, 'assets', 'backgrounds', 'masters', `${slot}.jpg`),
      ).metadata();
      expect([meta.width, meta.height]).toEqual([3840, 2160]);
      if (s.kind === 'photo') expect(credits).toContain(`\`${slot}\``);
    }
  });

  it('text over the scrim keeps at least 4.5:1 contrast at the busiest pixel of every image', async () => {
    const stops = scrimStops();
    expect(stops.length).toBeGreaterThanOrEqual(2);
    const alphaAt = (t: number) => {
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i] as (typeof stops)[number];
        const b = stops[i + 1] as (typeof stops)[number];
        if (t <= b.at)
          return {
            alpha: a.alpha + ((b.alpha - a.alpha) * (t - a.at)) / (b.at - a.at),
            rgb: a.rgb,
          };
      }
      const last = stops[stops.length - 1] as (typeof stops)[number];
      return { alpha: last.alpha, rgb: last.rgb };
    };
    const text = lum(...hex('text'));
    const muted = lum(...hex('muted'));
    for (const slot of Object.keys(manifest.slots)) {
      const { data, info } = await sharp(path.join(publicDir, `${slot}-1920.webp`))
        .raw()
        .toBuffer({ resolveWithObject: true });
      let worst = Infinity;
      for (let y = 0; y < info.height; y += 4) {
        const { alpha, rgb } = alphaAt(y / info.height);
        for (let x = 0; x < info.width; x += 4) {
          const i = (y * info.width + x) * info.channels;
          const px = [0, 1, 2].map(
            (k) => (data[i + k] as number) * (1 - alpha) + (rgb[k] as number) * alpha,
          ) as [number, number, number];
          worst = Math.min(worst, contrast(muted, lum(...px)), contrast(text, lum(...px)));
        }
      }
      expect(worst, `${slot} worst contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
