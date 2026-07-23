import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { diffScreenshots } from './screenshot-diff.js';

const CONFIG = {
  cellSize: 16, cellDiffThreshold: 4, minClusterAreaPx: 300, heightMismatchTolerancePx: 50, pixelmatchThreshold: 0.1,
};

function solidPng(width, height, [r, g, b], patch) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
  }
  if (patch) {
    for (let y = patch.y; y < patch.y + patch.height; y += 1) {
      for (let x = patch.x; x < patch.x + patch.width; x += 1) {
        const idx = (width * y + x) * 4;
        png.data[idx] = 255; png.data[idx + 1] = 0; png.data[idx + 2] = 0; png.data[idx + 3] = 255;
      }
    }
  }
  return PNG.sync.write(png);
}

test('diffScreenshots finds one region where the two images differ', () => {
  const live = solidPng(80, 80, [255, 255, 255]);
  const migrated = solidPng(80, 80, [255, 255, 255], { x: 20, y: 20, width: 20, height: 20 });

  const result = diffScreenshots(live, migrated, CONFIG);

  assert.equal(result.regions.length, 1);
  assert.equal(result.pageLengthMismatch, null);
  assert.equal(result.width, 80);
  assert.equal(result.height, 80);
});

test('diffScreenshots reports no regions for identical images', () => {
  const live = solidPng(80, 80, [255, 255, 255]);
  const migrated = solidPng(80, 80, [255, 255, 255]);

  const result = diffScreenshots(live, migrated, CONFIG);

  assert.deepEqual(result.regions, []);
});

test('diffScreenshots reports pageLengthMismatch when heights differ beyond tolerance, diffing only the overlap', () => {
  const live = solidPng(80, 200, [255, 255, 255]);
  const migrated = solidPng(80, 80, [255, 255, 255]);

  const result = diffScreenshots(live, migrated, CONFIG);

  assert.deepEqual(result.pageLengthMismatch, { liveHeight: 200, migratedHeight: 80, deltaPx: 120 });
  assert.equal(result.height, 80);
});
