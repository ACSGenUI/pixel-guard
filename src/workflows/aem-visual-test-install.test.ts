import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMissingProjectPaths } from './aem-visual-test-install.js';

async function makeTempProjectDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pixel-guard-test-'));
}

test('findMissingProjectPaths returns an empty array when all required paths exist', async () => {
  const dir = await makeTempProjectDir();
  try {
    await mkdir(join(dir, 'blocks'));
    await mkdir(join(dir, 'scripts'));
    await writeFile(join(dir, 'scripts', 'aem.js'), '');
    await writeFile(join(dir, 'package.json'), '{}');
    await writeFile(join(dir, 'head.html'), '');

    const missing = await findMissingProjectPaths(dir);

    assert.deepEqual(missing, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findMissingProjectPaths reports every missing required path, in order', async () => {
  const dir = await makeTempProjectDir();
  try {
    // Only package.json exists; blocks/, scripts/aem.js, and head.html are missing.
    await writeFile(join(dir, 'package.json'), '{}');

    const missing = await findMissingProjectPaths(dir);

    assert.deepEqual(missing, ['blocks/ folder', 'scripts/aem.js', 'head.html']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findMissingProjectPaths reports all four paths missing on an empty directory', async () => {
  const dir = await makeTempProjectDir();
  try {
    const missing = await findMissingProjectPaths(dir);

    assert.deepEqual(missing, ['blocks/ folder', 'scripts/aem.js', 'package.json', 'head.html']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
