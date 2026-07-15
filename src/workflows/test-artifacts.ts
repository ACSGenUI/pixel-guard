import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Playwright writes one *-actual.png/*-expected.png/*-diff.png triple per failed
// screenshot comparison into outputDir (test-results/), nested under a per-test folder.
// Verified empirically against a real failing toMatchSnapshot() run.
async function collectDiffImages(dir: string, results: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectDiffImages(fullPath, results);
    } else if (entry.isFile() && entry.name.endsWith('-diff.png')) {
      results.push(fullPath);
    }
  }
}

export async function findDiffImages(targetDir: string): Promise<string[]> {
  const testResultsDir = join(targetDir, 'tools', 'visual-tests', 'test-results');
  const results: string[] = [];
  await collectDiffImages(testResultsDir, results);
  return results;
}
