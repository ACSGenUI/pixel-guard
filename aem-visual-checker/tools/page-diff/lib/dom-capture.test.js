import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boxesOverlap, overlapArea, filterOverlappingElements, assignRegionToBlock,
} from './dom-capture.js';

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

test('assignRegionToBlock returns the smallest box whose bounds contain the region center', () => {
  const section = { name: 'section', selector: 'main > div:nth-of-type(2)', kind: 'section', boundingBox: { x: 0, y: 0, width: 1000, height: 1000 } };
  const block = { name: 'columns', selector: 'main > div:nth-of-type(2) > div', kind: 'block', boundingBox: { x: 100, y: 100, width: 200, height: 100 } };

  const region = { x: 150, y: 130, width: 20, height: 20 };

  const result = assignRegionToBlock(region, [section, block]);

  assert.equal(result.name, 'columns');
  assert.equal(result.kind, 'block');
});

test('assignRegionToBlock breaks a same-area tie by greatest overlap with the region', () => {
  const a = { name: 'a', selector: '.a', kind: 'block', boundingBox: { x: 0, y: 0, width: 100, height: 100 } };
  const b = { name: 'b', selector: '.b', kind: 'block', boundingBox: { x: 40, y: 0, width: 100, height: 100 } };

  // Equal-area boxes. Region center (95,50) is inside both, but the region straddles a's right
  // edge (x 75-115), so it overlaps b (x 40-140) more than a (x 0-100) -> tiebreak picks b.
  const region = { x: 75, y: 40, width: 40, height: 20 };

  const result = assignRegionToBlock(region, [a, b]);

  assert.equal(result.name, 'b');
});

test('assignRegionToBlock returns null when no box contains the region center', () => {
  const block = { name: 'columns', selector: '.columns', kind: 'block', boundingBox: { x: 0, y: 0, width: 50, height: 50 } };

  const region = { x: 500, y: 500, width: 10, height: 10 };

  assert.equal(assignRegionToBlock(region, [block]), null);
});
