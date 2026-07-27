import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { compareBlockCrops } from './block-compare.js';

const CONFIG = {
  cellSize: 16, cellDiffThreshold: 4, minClusterAreaPx: 300,
  heightMismatchTolerancePx: 50, pixelmatchThreshold: 0.1,
};

function solidPng(width, height, [r, g, b]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    png.data[i * 4] = r; png.data[i * 4 + 1] = g; png.data[i * 4 + 2] = b; png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

test('identical crops pass with zero diff', () => {
  const a = solidPng(200, 200, [255, 255, 255]);
  const result = compareBlockCrops(a, solidPng(200, 200, [255, 255, 255]), CONFIG);
  assert.equal(result.pass, true);
  assert.equal(result.diffPixelCount, 0);
  assert.equal(result.widthDelta, 0);
  assert.equal(result.heightMismatch, null);
});

test('fully different crops fail with a diff region', () => {
  const result = compareBlockCrops(
    solidPng(200, 200, [255, 255, 255]), solidPng(200, 200, [0, 0, 0]), CONFIG,
  );
  assert.equal(result.pass, false);
  assert.ok(result.diffPixelCount > 0);
});

test('differing widths are normalized to the common width and reported', () => {
  const result = compareBlockCrops(
    solidPng(200, 100, [255, 255, 255]), solidPng(160, 100, [255, 255, 255]), CONFIG,
  );
  assert.equal(result.widthDelta, 40);
  assert.equal(result.pass, true); // overlapping region is identical
});

test('differing heights are reported via heightMismatch', () => {
  const result = compareBlockCrops(
    solidPng(200, 200, [255, 255, 255]), solidPng(200, 320, [255, 255, 255]), CONFIG,
  );
  assert.ok(result.heightMismatch);
  assert.equal(result.heightMismatch.deltaPx, 120);
});
