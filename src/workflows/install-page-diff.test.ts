// src/workflows/install-page-diff.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp, mkdir, writeFile, rm, access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPackageJsonExists, copyPageDiffFiles } from './install-page-diff.js';

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pixel-guard-test-'));
}

test('checkPackageJsonExists returns true when package.json exists', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'package.json'), '{}');
    assert.equal(await checkPackageJsonExists(dir), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('checkPackageJsonExists returns false when package.json is missing', async () => {
  const dir = await makeTempDir();
  try {
    assert.equal(await checkPackageJsonExists(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('copyPageDiffFiles copies tools/page-diff/ (and only that) from source to target', async () => {
  const sourceDir = await makeTempDir();
  const targetDir = await makeTempDir();
  try {
    await mkdir(join(sourceDir, 'tools', 'page-diff', 'lib'), { recursive: true });
    await writeFile(join(sourceDir, 'tools', 'page-diff', 'compare-page-diff.js'), '// script');
    await writeFile(join(sourceDir, 'tools', 'page-diff', 'lib', 'mapping-file.js'), '// lib');
    await writeFile(join(sourceDir, 'tools', 'page-diff', '.DS_Store'), '');

    await copyPageDiffFiles(sourceDir, targetDir);

    await access(join(targetDir, 'tools', 'page-diff', 'compare-page-diff.js'));
    await access(join(targetDir, 'tools', 'page-diff', 'lib', 'mapping-file.js'));
    await assert.rejects(() => access(join(targetDir, 'tools', 'page-diff', '.DS_Store')));
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});

test('copyPageDiffFiles does not copy the installer-internal changes.js manifest', async () => {
  const sourceDir = await makeTempDir();
  const targetDir = await makeTempDir();
  try {
    await mkdir(join(sourceDir, 'tools', 'page-diff'), { recursive: true });
    await writeFile(join(sourceDir, 'tools', 'page-diff', 'compare-page-diff.js'), '// script');
    await writeFile(join(sourceDir, 'tools', 'page-diff', 'changes.js'), 'export const scripts = {};');

    await copyPageDiffFiles(sourceDir, targetDir);

    await access(join(targetDir, 'tools', 'page-diff', 'compare-page-diff.js'));
    await assert.rejects(() => access(join(targetDir, 'tools', 'page-diff', 'changes.js')));
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});
