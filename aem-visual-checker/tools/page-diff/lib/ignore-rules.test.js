import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadIgnoreRules, matchRulesForContext, overlapRatio, applyIgnoreStatus,
} from './ignore-rules.js';

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), 'page-diff-test-'));
}

test('loadIgnoreRules returns an empty array when the file does not exist', async () => {
  const rules = await loadIgnoreRules('/nonexistent/ignore.json');
  assert.deepEqual(rules, []);
});

test('loadIgnoreRules parses an existing ignore.json', async () => {
  const dir = await makeTempDir();
  try {
    const filePath = join(dir, 'ignore.json');
    await writeFile(filePath, JSON.stringify([{ pairSlug: 'home', selector: '.promo' }]));

    const rules = await loadIgnoreRules(filePath);

    assert.deepEqual(rules, [{ pairSlug: 'home', selector: '.promo' }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('matchRulesForContext matches by exact pairSlug', () => {
  const rules = [{ pairSlug: 'home', selector: '.promo' }, { pairSlug: 'contact', selector: '.other' }];
  const matched = matchRulesForContext(rules, { pairSlug: 'home', liveUrl: 'https://live.example.com/home', viewportLabel: 'Mobile' });
  assert.deepEqual(matched, [{ pairSlug: 'home', selector: '.promo' }]);
});

test('matchRulesForContext matches by urlPattern wildcard', () => {
  const rules = [{ urlPattern: '*/blog/*', selector: '.ad' }];
  const matched = matchRulesForContext(rules, { pairSlug: 'blog-post-1', liveUrl: 'https://live.example.com/blog/post-1', viewportLabel: 'Desktop' });
  assert.equal(matched.length, 1);
});

test('matchRulesForContext excludes rules scoped to a different viewport', () => {
  const rules = [{ pairSlug: 'home', viewport: 'Mobile', selector: '.promo' }];
  const matched = matchRulesForContext(rules, { pairSlug: 'home', liveUrl: 'https://live.example.com/home', viewportLabel: 'Desktop' });
  assert.deepEqual(matched, []);
});

test('matchRulesForContext matches viewport case-insensitively', () => {
  const rules = [{ pairSlug: 'home', viewport: 'mobile', selector: '.promo' }];
  const matched = matchRulesForContext(rules, { pairSlug: 'home', liveUrl: 'https://live.example.com/home', viewportLabel: 'Mobile' });
  assert.deepEqual(matched, [{ pairSlug: 'home', viewport: 'mobile', selector: '.promo' }]);
});

test('overlapRatio returns 1 when the rule box fully covers the region', () => {
  const ratio = overlapRatio({ x: 10, y: 10, width: 10, height: 10 }, { x: 0, y: 0, width: 100, height: 100 });
  assert.equal(ratio, 1);
});

test('overlapRatio returns 0 for non-overlapping boxes', () => {
  const ratio = overlapRatio({ x: 0, y: 0, width: 10, height: 10 }, { x: 100, y: 100, width: 10, height: 10 });
  assert.equal(ratio, 0);
});

test('applyIgnoreStatus marks a region ignored when overlap meets the threshold, failed otherwise', () => {
  const regions = [
    { x: 0, y: 0, width: 10, height: 10, diffPixelCount: 5 },
    { x: 200, y: 200, width: 10, height: 10, diffPixelCount: 5 },
  ];
  const ignoredBoxes = [{ box: { x: 0, y: 0, width: 10, height: 10 }, rule: { selector: '.promo' } }];

  const result = applyIgnoreStatus(regions, ignoredBoxes, 0.5);

  assert.equal(result[0].status, 'ignored');
  assert.deepEqual(result[0].matchedRule, { selector: '.promo' });
  assert.equal(result[1].status, 'failed');
  assert.equal(result[1].matchedRule, null);
});
