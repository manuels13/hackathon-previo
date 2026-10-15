import { Jimp } from 'jimp';

const RED = 0xff1a1aff; // RGBA

/**
 * Draws a bright red ring (plus a small centre dot) at pixel (x, y) and returns the PNG: forensic
 * evidence of exactly where the automation is about to click.
 */
export async function markPoint(png: Buffer, x: number, y: number, radius = 28, thickness = 5): Promise<Buffer> {
  const image = await Jimp.read(png);
  const { width, height } = image.bitmap;
  const outer = radius + thickness / 2;
  const inner = radius - thickness / 2;
  for (let py = Math.max(0, Math.floor(y - outer)); py <= Math.min(height - 1, Math.ceil(y + outer)); py++) {
    for (let px = Math.max(0, Math.floor(x - outer)); px <= Math.min(width - 1, Math.ceil(x + outer)); px++) {
      const d = Math.hypot(px - x, py - y);
      if ((d >= inner && d <= outer) || d <= 3) image.setPixelColor(RED, px, py);
    }
  }
  return image.getBuffer('image/png');
}
