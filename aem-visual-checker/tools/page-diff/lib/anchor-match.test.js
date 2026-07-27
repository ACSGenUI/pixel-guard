import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, unionBox, computeConfidence } from './anchor-match.js';

const CONFIG = { maxAncestorAreaRatio: 0.6 };

test('normalizeText trims, collapses whitespace, lowercases', () => {
  assert.equal(normalizeText('  NO   GOAL\nIS  TOO Small '), 'no goal is too small');
});

test('unionBox returns the enclosing box of all inputs', () => {
  const box = unionBox([
    { x: 10, y: 20, width: 30, height: 40 }, // right=40 bottom=60
    { x: 5, y: 50, width: 10, height: 30 },  // right=15 bottom=80
  ]);
  assert.deepEqual(box, { x: 5, y: 20, width: 35, height: 60 });
});

test('unionBox returns null for no boxes', () => {
  assert.equal(unionBox([]), null);
});

test('computeConfidence is 1 when all anchors match and region is tight', () => {
  const c = computeConfidence(
    { totalAnchors: 4, matchedAnchors: 4, regionArea: 100_000, viewportArea: 1_000_000 },
    CONFIG,
  );
  assert.equal(c, 1);
});

test('computeConfidence scales down with partial matches', () => {
  const c = computeConfidence(
    { totalAnchors: 4, matchedAnchors: 2, regionArea: 100_000, viewportArea: 1_000_000 },
    CONFIG,
  );
  assert.equal(c, 0.5);
});

test('computeConfidence penalizes a region that fills most of the viewport', () => {
  const tight = computeConfidence(
    { totalAnchors: 2, matchedAnchors: 2, regionArea: 100_000, viewportArea: 1_000_000 }, CONFIG,
  );
  const sprawling = computeConfidence(
    { totalAnchors: 2, matchedAnchors: 2, regionArea: 900_000, viewportArea: 1_000_000 }, CONFIG,
  );
  assert.equal(tight, 1);
  assert.ok(sprawling < tight);
});

test('computeConfidence is 0 with no anchors', () => {
  assert.equal(
    computeConfidence({ totalAnchors: 0, matchedAnchors: 0, regionArea: 0, viewportArea: 1_000_000 }, CONFIG),
    0,
  );
});
