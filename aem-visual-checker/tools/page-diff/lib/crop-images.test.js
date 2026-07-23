import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { cropPng } from './crop-images.js';

function buildTestPng(width, height) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) * 4;
      png.data[idx] = x % 256;
      png.data[idx + 1] = y % 256;
      png.data[idx + 2] = 0;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

test('cropPng crops to the box plus padding, preserving pixel color at each coordinate', () => {
  const buffer = buildTestPng(40, 40);

  const croppedBuffer = cropPng(buffer, { x: 20, y: 20, width: 10, height: 10 }, 5, 40, 40);
  const cropped = PNG.sync.read(croppedBuffer);

  assert.equal(cropped.width, 20);
  assert.equal(cropped.height, 20);
  // Pixel at cropped (5,5) corresponds to source (20,20): red=20, green=20.
  const idx = (cropped.width * 5 + 5) * 4;
  assert.equal(cropped.data[idx], 20);
  assert.equal(cropped.data[idx + 1], 20);
});

test('cropPng clamps the crop rectangle to the image bounds', () => {
  const buffer = buildTestPng(40, 40);

  const croppedBuffer = cropPng(buffer, { x: 0, y: 0, width: 5, height: 5 }, 10, 40, 40);
  const cropped = PNG.sync.read(croppedBuffer);

  assert.equal(cropped.width, 15); // 0 - 10 clamped to 0, plus 5 + 10 = 15
  assert.equal(cropped.height, 15);
});
