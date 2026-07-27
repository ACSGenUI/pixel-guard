import { cp } from 'node:fs/promises';
import { basename, join } from 'node:path';

// Copies a pixel-guard skill template (aem-visual-checker/skills/<name>/) into the
// target project's .claude/skills/<name>/ so the client's Claude Code agent gains it.
// Namespaced (pixel-guard-*) and force-overwritten -- pixel-guard owns these, like tools/.
export async function copySkill(sourceDir: string, targetDir: string, skillName: string): Promise<void> {
  await cp(
    join(sourceDir, 'skills', skillName),
    join(targetDir, '.claude', 'skills', skillName),
    {
      recursive: true,
      force: true,
      filter: (source) => basename(source) !== '.DS_Store',
    },
  );
}
