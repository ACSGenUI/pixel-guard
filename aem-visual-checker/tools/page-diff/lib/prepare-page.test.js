import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreparePage } from './prepare-page.js';

async function makeTargetDir(prepareSource) {
  const dir = await mkdtemp(join(tmpdir(), 'prep-'));
  if (prepareSource !== null) {
    await mkdir(join(dir, 'tools', 'page-diff'), { recursive: true });
    await writeFile(join(dir, 'tools', 'page-diff', 'prepare.js'), prepareSource);
  }
  return dir;
}

test('no-op when tools/page-diff/prepare.js is absent', async () => {
  const dir = await makeTargetDir(null);
  const page = { calls: [] };
  try {
    await runPreparePage(page, { side: 'live', url: 'u', pairSlug: 'home', viewport: 'Desktop' }, dir);
    assert.deepEqual(page.calls, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('calls the default export with (page, context)', async () => {
  const dir = await makeTargetDir(
    'export default async (page, ctx) => { page.calls.push(ctx.side); };',
  );
  const page = { calls: [] };
  try {
    await runPreparePage(page, { side: 'live', url: 'u', pairSlug: 'home', viewport: 'Desktop' }, dir);
    assert.deepEqual(page.calls, ['live']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('calls a named `prepare` export when there is no default', async () => {
  const dir = await makeTargetDir(
    'export async function prepare(page, ctx) { page.calls.push(ctx.viewport); }',
  );
  const page = { calls: [] };
  try {
    await runPreparePage(page, { side: 'migrated', url: 'u', pairSlug: 'home', viewport: 'Tablet' }, dir);
    assert.deepEqual(page.calls, ['Tablet']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('surfaces an error thrown by the user hook, naming side and url', async () => {
  const dir = await makeTargetDir(
    "export default async () => { throw new Error('boom'); };",
  );
  const page = { calls: [] };
  try {
    await assert.rejects(
      () => runPreparePage(page, { side: 'live', url: 'https://live/', pairSlug: 'home', viewport: 'Desktop' }, dir),
      /prepare\.js.*live.*https:\/\/live\/.*boom/s,
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});
