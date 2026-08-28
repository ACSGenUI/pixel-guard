import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export function resolveBlockSpecPath(blockName: string): string {
  const slug = blockName.toLowerCase().replace(/\s+/g, '-');
  return join('tools', 'visual-tests', 'blocks', slug, `${slug}.spec.js`);
}

export async function blockSpecExists(baseDir: string, specPath: string): Promise<boolean> {
  try {
    await access(join(baseDir, specPath));
    return true;
  } catch {
    return false;
  }
}

export async function listAvailableBlocks(baseDir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(baseDir, 'tools', 'visual-tests', 'blocks'), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}
