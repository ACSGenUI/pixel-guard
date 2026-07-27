import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blockSlug, baselinePath, readManifest, upsertManifestEntry,
} from './block-baseline.js';

test('blockSlug turns kind:name into a filesystem-safe slug', () => {
  assert.equal(blockSlug('hero-spotlight'), 'hero-spotlight');
  assert.equal(blockSlug('landmark:nav'), 'landmark-nav');
  assert.equal(blockSlug('Card Set'), 'card-set');
});

test('baselinePath composes the expected location', () => {
  const p = baselinePath('/proj', 'home', 'hero-spotlight', 'Desktop');
  assert.equal(p, '/proj/tools/page-diff/baselines/home/hero-spotlight-desktop.png');
});

test('readManifest returns empty entries when absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bl-'));
  try {
    assert.deepEqual(await readManifest(dir, 'home'), { entries: [] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('upsertManifestEntry inserts then replaces by block+viewport', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bl-'));
  try {
    await upsertManifestEntry(dir, 'home', { block: 'hero', viewport: 'Desktop', confidence: 0.5 });
    await upsertManifestEntry(dir, 'home', { block: 'hero', viewport: 'Tablet', confidence: 0.9 });
    await upsertManifestEntry(dir, 'home', { block: 'hero', viewport: 'Desktop', confidence: 0.95 });
    const manifest = await readManifest(dir, 'home');
    assert.equal(manifest.entries.length, 2);
    const desktop = manifest.entries.find((e) => e.viewport === 'Desktop');
    assert.equal(desktop.confidence, 0.95);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
