import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBlockSummary } from './block-summary.js';

function region(overrides) {
  return {
    status: 'failed', diffPixelCount: 100,
    block: { name: 'hero', selector: 'sel', kind: 'block', boundingBox: { x: 0, y: 0, width: 100, height: 100 } },
    crops: { live: 'l.png', migrated: 'm.png', diff: 'd.png' },
    ...overrides,
  };
}

test('aggregates a block across viewports: regionCount, totalDiffPx, viewportsAffected sorted', () => {
  const viewports = [
    { viewportLabel: 'Tablet', regions: [region({ diffPixelCount: 200 })] },
    { viewportLabel: 'Desktop', regions: [region({ diffPixelCount: 300 }), region({ diffPixelCount: 100 })] },
  ];
  const [hero] = buildBlockSummary(viewports);
  assert.equal(hero.name, 'hero');
  assert.equal(hero.regionCount, 3);
  assert.equal(hero.totalDiffPx, 600);
  assert.deepEqual(hero.viewportsAffected, ['Desktop', 'Tablet']);
});

test('coverage is max across viewports = sum(diffPx)/blockArea', () => {
  // block area 100x100 = 10000. Tablet 1000/10000=0.1, Desktop 5000/10000=0.5 -> max 0.5
  const viewports = [
    { viewportLabel: 'Tablet', regions: [region({ diffPixelCount: 1000 })] },
    { viewportLabel: 'Desktop', regions: [region({ diffPixelCount: 5000 })] },
  ];
  const [hero] = buildBlockSummary(viewports);
  assert.equal(hero.coverage, 0.5);
  assert.equal(hero.severityScore, 0.5);
  assert.equal(hero.worstViewport, 'Desktop');
});

test('coverage clamps to 1 when diff pixels exceed the block box area', () => {
  const viewports = [
    { viewportLabel: 'Desktop', regions: [region({ diffPixelCount: 999999 })] },
  ];
  const [hero] = buildBlockSummary(viewports);
  assert.equal(hero.coverage, 1);
});

test('zero-area block box contributes 0 coverage, no NaN', () => {
  const zeroBox = { name: 'ghost', selector: 's', kind: 'block', boundingBox: { x: 0, y: 0, width: 0, height: 0 } };
  const viewports = [
    { viewportLabel: 'Desktop', regions: [region({ block: zeroBox, diffPixelCount: 500 })] },
  ];
  const [ghost] = buildBlockSummary(viewports);
  assert.equal(ghost.coverage, 0);
  assert.equal(Number.isNaN(ghost.coverage), false);
});

test('excludes ignored and unattributed regions', () => {
  const viewports = [{
    viewportLabel: 'Desktop',
    regions: [
      region({ status: 'ignored' }),
      region({ block: null }),
      region({ block: { name: 'cards', selector: 's', kind: 'block', boundingBox: { x: 0, y: 0, width: 100, height: 100 } } }),
    ],
  }];
  const result = buildBlockSummary(viewports);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'cards');
});

test('orders entries top-to-bottom by block top Y (header first), regardless of severity', () => {
  const mk = (name, kind, y, diffPx) => ({
    viewportLabel: 'Desktop',
    regions: [region({ block: { name, selector: name, kind, boundingBox: { x: 0, y, width: 100, height: 100 } }, diffPixelCount: diffPx })],
  });
  // columns is the most-broken but lowest on the page; nav is at the very top.
  const viewports = [
    mk('columns', 'block', 1200, 9900),
    mk('nav', 'landmark', 0, 100),
    mk('hero', 'block', 200, 6000),
  ];
  const order = buildBlockSummary(viewports).map((r) => `${r.kind}:${r.name}`);
  assert.deepEqual(order, ['landmark:nav', 'block:hero', 'block:columns']);
});

test('exposes topY as the block top Y in the worst viewport', () => {
  const viewports = [
    { viewportLabel: 'Tablet', regions: [region({ diffPixelCount: 100, block: { name: 'hero', selector: 's', kind: 'block', boundingBox: { x: 0, y: 50, width: 100, height: 100 } } })] },
    { viewportLabel: 'Desktop', regions: [region({ diffPixelCount: 5000, block: { name: 'hero', selector: 's', kind: 'block', boundingBox: { x: 0, y: 300, width: 100, height: 100 } } })] },
  ];
  const [hero] = buildBlockSummary(viewports);
  assert.equal(hero.worstViewport, 'Desktop');
  assert.equal(hero.topY, 300);
});

test('worstCrop is the diff crop of the largest-diffPixelCount region in the worst viewport', () => {
  const viewports = [{
    viewportLabel: 'Desktop',
    regions: [
      region({ diffPixelCount: 100, crops: { live: 'a-l', migrated: 'a-m', diff: 'a-diff' } }),
      region({ diffPixelCount: 900, crops: { live: 'b-l', migrated: 'b-m', diff: 'b-diff' } }),
    ],
  }];
  const [hero] = buildBlockSummary(viewports);
  assert.equal(hero.worstCrop, 'b-diff');
});

test('empty / no failing regions returns []', () => {
  assert.deepEqual(buildBlockSummary([]), []);
  assert.deepEqual(buildBlockSummary([{ viewportLabel: 'Desktop', regions: [] }]), []);
});
