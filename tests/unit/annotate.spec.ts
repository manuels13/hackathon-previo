import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { markPoint } from '../../src/vision/annotate';

function blank(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(255);
  return PNG.sync.write(png);
}

function rgbAt(png: Buffer, x: number, y: number): [number, number, number] {
  const img = PNG.sync.read(png);
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

test('markPoint draws a red ring and centre dot at the given pixel', async () => {
  const marked = await markPoint(blank(200, 120), 100, 60, 28, 5);
  expect(rgbAt(marked, 100 + 28, 60)).toEqual([255, 26, 26]); // on the ring
  expect(rgbAt(marked, 100, 60)).toEqual([255, 26, 26]); // centre dot
  expect(rgbAt(marked, 100 + 14, 60)).toEqual([255, 255, 255]); // inside, untouched
  expect(rgbAt(marked, 5, 5)).toEqual([255, 255, 255]); // far away, untouched
});

test('markPoint near the edge does not throw', async () => {
  await expect(markPoint(blank(50, 50), 2, 48)).resolves.toBeInstanceOf(Buffer);
});
