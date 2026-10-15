import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { Region } from '../providers/types';

export function crop(png: Buffer, region: Region): Buffer {
  const src = PNG.sync.read(png);
  const x = Math.round(region.x * src.width);
  const y = Math.round(region.y * src.height);
  const w = Math.max(1, Math.min(src.width - x, Math.round(region.w * src.width)));
  const h = Math.max(1, Math.min(src.height - y, Math.round(region.h * src.height)));
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(src, out, x, y, w, h, 0, 0);
  return PNG.sync.write(out);
}

/** Fraction (0..1) of pixels that differ between two screenshots of the same size. */
export function diffRatio(a: Buffer, b: Buffer): number {
  const imgA = PNG.sync.read(a);
  const imgB = PNG.sync.read(b);
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) return 1;
  const changed = pixelmatch(imgA.data, imgB.data, null, imgA.width, imgA.height, { threshold: 0.1 });
  return changed / (imgA.width * imgA.height);
}

/**
 * Fraction (0..1) of clearly coloured pixels. Loading screens are mostly black/white/grey, while a
 * game's intro and play screens are full of colour, so this tells "still loading" from "game shown".
 */
export function colorfulness(png: Buffer): number {
  const img = PNG.sync.read(png);
  let coloured = 0;
  const step = 4; // sample every 4th pixel: plenty for a ratio
  let sampled = 0;
  for (let i = 0; i < img.data.length; i += 4 * step) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max > 60 && (max - min) / max > 0.35) coloured++;
    sampled++;
  }
  return coloured / sampled;
}
