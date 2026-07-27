import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function blockSlug(block) {
  return String(block).replace(/:/g, '-').trim().toLowerCase().replace(/\s+/g, '-');
}

export function baselineDir(targetDir, pairSlug) {
  return join(targetDir, 'tools', 'page-diff', 'baselines', pairSlug);
}

export function baselinePath(targetDir, pairSlug, block, viewportLabel) {
  return join(baselineDir(targetDir, pairSlug), `${blockSlug(block)}-${viewportLabel.toLowerCase()}.png`);
}

function manifestPath(targetDir, pairSlug) {
  return join(baselineDir(targetDir, pairSlug), 'manifest.json');
}

export async function readManifest(targetDir, pairSlug) {
  try {
    return JSON.parse(await readFile(manifestPath(targetDir, pairSlug), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { entries: [] };
    throw error;
  }
}

export async function upsertManifestEntry(targetDir, pairSlug, entry) {
  await mkdir(baselineDir(targetDir, pairSlug), { recursive: true });
  const manifest = await readManifest(targetDir, pairSlug);
  const entries = manifest.entries.filter(
    (e) => !(e.block === entry.block && e.viewport === entry.viewport),
  );
  entries.push(entry);
  await writeFile(manifestPath(targetDir, pairSlug), JSON.stringify({ entries }, null, 2));
}
