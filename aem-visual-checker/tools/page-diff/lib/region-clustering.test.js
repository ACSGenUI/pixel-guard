import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterDiffRegions } from './region-clustering.js';

const OPTIONS = { cellSize: 16, cellDiffThreshold: 4, minClusterAreaPx: 300 };

function buildMask(width, height, rects) {
  const mask = new Uint8Array(width * height);
  for (const rect of rects) {
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

test('clusterDiffRegions finds a single region for one solid differing block', () => {
  const mask = buildMask(64, 64, [{ x: 20, y: 20, width: 20, height: 20 }]);

  const regions = clusterDiffRegions(mask, 64, 64, OPTIONS);

  assert.equal(regions.length, 1);
  assert.ok(regions[0].x <= 20 && regions[0].x + regions[0].width >= 40);
  assert.ok(regions[0].y <= 20 && regions[0].y + regions[0].height >= 40);
  assert.equal(regions[0].diffPixelCount, 400);
});

test('clusterDiffRegions finds two separate regions for two far-apart blocks', () => {
  const mask = buildMask(128, 128, [
    { x: 0, y: 0, width: 20, height: 20 },
    { x: 100, y: 100, width: 20, height: 20 },
  ]);

  const regions = clusterDiffRegions(mask, 128, 128, OPTIONS);

  assert.equal(regions.length, 2);
});

test('clusterDiffRegions merges two adjacent blocks into one region', () => {
  const mask = buildMask(64, 64, [
    { x: 0, y: 0, width: 16, height: 16 },
    { x: 16, y: 0, width: 16, height: 16 },
  ]);

  const regions = clusterDiffRegions(mask, 64, 64, OPTIONS);

  assert.equal(regions.length, 1);
});

test('clusterDiffRegions drops clusters smaller than minClusterAreaPx', () => {
  const mask = buildMask(64, 64, [{ x: 0, y: 0, width: 4, height: 4 }]);

  const regions = clusterDiffRegions(mask, 64, 64, OPTIONS);

  assert.equal(regions.length, 0);
});

test('clusterDiffRegions returns an empty array for an all-zero mask', () => {
  const mask = new Uint8Array(64 * 64);

  const regions = clusterDiffRegions(mask, 64, 64, OPTIONS);

  assert.deepEqual(regions, []);
});
