import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergePackageJson, appendMissingLines } from './update-project-config.js';

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pixel-guard-test-'));
}

test('mergePackageJson merges scripts/dependencies/devDependencies into an existing package.json, overwriting shared keys', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'target-project',
        scripts: { start: 'aem up', build: 'echo build' },
        dependencies: { lodash: '^4.0.0' },
        devDependencies: { eslint: '^8.0.0' },
      }, null, 2),
    );

    await mergePackageJson(dir, {
      scripts: { start: 'concurrently -k "npm run test:visual:server" "aem up"', 'test:visual': 'echo visual' },
      dependencies: { playwright: '^1.53.1' },
      devDependencies: { husky: '^8.0.3' },
    });

    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    assert.deepEqual(pkg.scripts, {
      start: 'concurrently -k "npm run test:visual:server" "aem up"',
      build: 'echo build',
      'test:visual': 'echo visual',
    });
    assert.deepEqual(pkg.dependencies, { lodash: '^4.0.0', playwright: '^1.53.1' });
    assert.deepEqual(pkg.devDependencies, { eslint: '^8.0.0', husky: '^8.0.3' });
    assert.equal(pkg.name, 'target-project');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergePackageJson creates scripts/dependencies/devDependencies keys when the target package.json lacks them', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'bare-project' }, null, 2));

    await mergePackageJson(dir, {
      scripts: { 'test:visual': 'echo visual' },
      dependencies: { playwright: '^1.53.1' },
      devDependencies: { husky: '^8.0.3' },
    });

    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    assert.deepEqual(pkg.scripts, { 'test:visual': 'echo visual' });
    assert.deepEqual(pkg.dependencies, { playwright: '^1.53.1' });
    assert.deepEqual(pkg.devDependencies, { husky: '^8.0.3' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergePackageJson writes pretty-printed JSON with a trailing newline', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'bare-project' }));

    await mergePackageJson(dir, { scripts: { start: 'aem up' }, dependencies: {}, devDependencies: {} });

    const raw = await readFile(join(dir, 'package.json'), 'utf8');
    assert.ok(raw.endsWith('\n'));
    assert.ok(raw.includes('  "scripts"'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('appendMissingLines creates the file with the given lines when it does not exist', async () => {
  const dir = await makeTempDir();
  try {
    const filePath = join(dir, '.hlxignore');

    await appendMissingLines(filePath, ['tools/visual-tests/*']);

    assert.equal(await readFile(filePath, 'utf8'), 'tools/visual-tests/*\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('appendMissingLines appends only the lines not already present', async () => {
  const dir = await makeTempDir();
  try {
    const filePath = join(dir, '.gitignore');
    await writeFile(filePath, 'node_modules\n.env\n');

    await appendMissingLines(filePath, ['.env', 'playwright-report/', 'test-results/']);

    assert.equal(
      await readFile(filePath, 'utf8'),
      'node_modules\n.env\nplaywright-report/\ntest-results/\n',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('appendMissingLines leaves the file unchanged when every line is already present', async () => {
  const dir = await makeTempDir();
  try {
    const filePath = join(dir, '.gitignore');
    await writeFile(filePath, 'node_modules\n.env\n');

    await appendMissingLines(filePath, ['.env']);

    assert.equal(await readFile(filePath, 'utf8'), 'node_modules\n.env\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
