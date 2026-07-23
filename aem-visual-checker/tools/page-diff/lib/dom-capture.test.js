import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxesOverlap, overlapArea, filterOverlappingElements } from './dom-capture.js';

test('boxesOverlap returns true for overlapping boxes', () => {
  assert.equal(boxesOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }), true);
});

test('boxesOverlap returns false for non-overlapping boxes', () => {
  assert.equal(boxesOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 }), false);
});

test('overlapArea computes the intersection area', () => {
  const area = overlapArea({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 });
  assert.equal(area, 25);
});

test('filterOverlappingElements keeps only elements whose bounding box overlaps the region, smallest first', () => {
  const elements = [
    { selector: 'body', boundingBox: { x: 0, y: 0, width: 1000, height: 1000 } },
    { selector: '.hero', boundingBox: { x: 10, y: 10, width: 100, height: 50 } },
    { selector: '.footer', boundingBox: { x: 900, y: 900, width: 50, height: 50 } },
  ];
  const regionBox = { x: 20, y: 20, width: 30, height: 20 };

  const result = filterOverlappingElements(elements, regionBox);

  assert.deepEqual(result.map((el) => el.selector), ['.hero', 'body']);
});
