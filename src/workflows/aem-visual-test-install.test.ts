import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMissingProjectPaths, copyRequiredFiles } from './aem-visual-test-install.js';

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

test('findMissingProjectPaths accepts scripts/lib-franklin.js in place of scripts/aem.js', async () => {
  const dir = await makeTempProjectDir();
  try {
    await mkdir(join(dir, 'blocks'));
    await mkdir(join(dir, 'scripts'));
    await writeFile(join(dir, 'scripts', 'lib-franklin.js'), '');
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

test('copyRequiredFiles copies tools/, .dockerignore, and .env.example into the target directory', async () => {
  const srcDir = await makeTempProjectDir();
  const targetDir = await makeTempProjectDir();
  try {
    await mkdir(join(srcDir, 'tools', 'sidekick'), { recursive: true });
    await writeFile(join(srcDir, 'tools', 'sidekick', 'config.json'), '{"sidekick":true}');
    await writeFile(join(srcDir, '.dockerignore'), 'node_modules\n');
    await writeFile(join(srcDir, '.env.example'), 'FIGMA_ACCESS_TOKEN=\n');

    await copyRequiredFiles(srcDir, targetDir);

    assert.equal(
      await readFile(join(targetDir, 'tools', 'sidekick', 'config.json'), 'utf8'),
      '{"sidekick":true}',
    );
    assert.equal(await readFile(join(targetDir, '.dockerignore'), 'utf8'), 'node_modules\n');
    assert.equal(await readFile(join(targetDir, '.env.example'), 'utf8'), 'FIGMA_ACCESS_TOKEN=\n');
  } finally {
    await rm(srcDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});

test('copyRequiredFiles excludes .DS_Store files from the tools/ copy', async () => {
  const srcDir = await makeTempProjectDir();
  const targetDir = await makeTempProjectDir();
  try {
    await mkdir(join(srcDir, 'tools', 'sidekick'), { recursive: true });
    await writeFile(join(srcDir, 'tools', '.DS_Store'), 'junk');
    await writeFile(join(srcDir, 'tools', 'sidekick', 'config.json'), '{}');
    await writeFile(join(srcDir, '.dockerignore'), '');
    await writeFile(join(srcDir, '.env.example'), '');

    await copyRequiredFiles(srcDir, targetDir);

    await assert.rejects(() => access(join(targetDir, 'tools', '.DS_Store')));
    assert.equal(await readFile(join(targetDir, 'tools', 'sidekick', 'config.json'), 'utf8'), '{}');
  } finally {
    await rm(srcDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});

test('copyRequiredFiles overwrites files that already exist in the target', async () => {
  const srcDir = await makeTempProjectDir();
  const targetDir = await makeTempProjectDir();
  try {
    await mkdir(join(srcDir, 'tools'), { recursive: true });
    await writeFile(join(srcDir, '.env.example'), 'NEW_VALUE=1\n');
    await writeFile(join(srcDir, '.dockerignore'), 'NEW_IGNORE\n');
    await writeFile(join(targetDir, '.env.example'), 'OLD_VALUE=0\n');
    await writeFile(join(targetDir, '.dockerignore'), 'OLD_IGNORE\n');

    await copyRequiredFiles(srcDir, targetDir);

    assert.equal(await readFile(join(targetDir, '.env.example'), 'utf8'), 'NEW_VALUE=1\n');
    assert.equal(await readFile(join(targetDir, '.dockerignore'), 'utf8'), 'NEW_IGNORE\n');
  } finally {
    await rm(srcDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});

test('copyRequiredFiles leaves target-only files under tools/ untouched (merge, not clean)', async () => {
  const srcDir = await makeTempProjectDir();
  const targetDir = await makeTempProjectDir();
  try {
    await mkdir(join(srcDir, 'tools', 'sidekick'), { recursive: true });
    await writeFile(join(srcDir, 'tools', 'sidekick', 'config.json'), '{}');
    await writeFile(join(srcDir, '.dockerignore'), '');
    await writeFile(join(srcDir, '.env.example'), '');
    await mkdir(join(targetDir, 'tools'), { recursive: true });
    await writeFile(join(targetDir, 'tools', 'local-notes.txt'), 'keep me');

    await copyRequiredFiles(srcDir, targetDir);

    assert.equal(await readFile(join(targetDir, 'tools', 'local-notes.txt'), 'utf8'), 'keep me');
    assert.equal(await readFile(join(targetDir, 'tools', 'sidekick', 'config.json'), 'utf8'), '{}');
  } finally {
    await rm(srcDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});
