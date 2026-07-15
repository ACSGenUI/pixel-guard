import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function mergePackageJson(
  targetDir: string,
  additions: {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  },
): Promise<void> {
  const packageJsonPath = join(targetDir, 'package.json');
  const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  pkg.scripts = { ...(pkg.scripts ?? {}), ...additions.scripts };
  pkg.dependencies = { ...(pkg.dependencies ?? {}), ...additions.dependencies };
  pkg.devDependencies = { ...(pkg.devDependencies ?? {}), ...additions.devDependencies };
  await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

export async function appendMissingLines(filePath: string, lines: string[]): Promise<void> {
  let existingContent = '';
  try {
    existingContent = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const existingLines = existingContent.split('\n');
  const missingLines = lines.filter((line) => !existingLines.includes(line));
  if (missingLines.length === 0) {
    return;
  }
  const trimmedContent = existingContent.replace(/\n+$/, '');
  const prefix = trimmedContent.length === 0 ? '' : `${trimmedContent}\n`;
  await writeFile(filePath, `${prefix}${missingLines.join('\n')}\n`, 'utf8');
}
