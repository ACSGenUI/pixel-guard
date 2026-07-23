import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMappingFile } from './mapping-file.js';

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), 'page-diff-test-'));
}

test('parseMappingFile parses a JSON array of pairs and derives pairSlug from the migrated URL path', async () => {
  const dir = await makeTempDir();
  try {
    const filePath = join(dir, 'urls.json');
    await writeFile(filePath, JSON.stringify([
      { liveUrl: 'https://live.example.com/about', migratedUrl: 'https://migrated.example.com/about' },
    ]));

    const pairs = await parseMappingFile(filePath);

    assert.deepEqual(pairs, [
      { liveUrl: 'https://live.example.com/about', migratedUrl: 'https://migrated.example.com/about', pairSlug: 'about' },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseMappingFile parses a CSV file with a header row', async () => {
  const dir = await makeTempDir();
  try {
    const filePath = join(dir, 'urls.csv');
    await writeFile(filePath, 'liveUrl,migratedUrl\nhttps://live.example.com/,https://migrated.example.com/\n');

    const pairs = await parseMappingFile(filePath);

    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].liveUrl, 'https://live.example.com/');
    assert.equal(pairs[0].migratedUrl, 'https://migrated.example.com/');
    assert.equal(pairs[0].pairSlug, 'pair');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseMappingFile de-duplicates identical derived slugs by appending -2, -3, ...', async () => {
  const dir = await makeTempDir();
  try {
    const filePath = join(dir, 'urls.json');
    await writeFile(filePath, JSON.stringify([
      { liveUrl: 'https://live.example.com/a/home', migratedUrl: 'https://migrated.example.com/x/home' },
      { liveUrl: 'https://live.example.com/b/home', migratedUrl: 'https://migrated.example.com/y/home' },
    ]));

    const pairs = await parseMappingFile(filePath);

    assert.deepEqual(pairs.map((p) => p.pairSlug), ['home', 'home-2']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseMappingFile throws a descriptive error for a row missing migratedUrl', async () => {
  const dir = await makeTempDir();
  try {
    const filePath = join(dir, 'urls.json');
    await writeFile(filePath, JSON.stringify([{ liveUrl: 'https://live.example.com/' }]));

    await assert.rejects(() => parseMappingFile(filePath), /row 1.*migratedUrl/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseMappingFile throws for an unsupported file extension', async () => {
  const dir = await makeTempDir();
  try {
    const filePath = join(dir, 'urls.txt');
    await writeFile(filePath, 'not a mapping file');

    await assert.rejects(() => parseMappingFile(filePath), /\.csv or \.json/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
