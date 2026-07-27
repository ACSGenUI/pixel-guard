import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Runs the target project's optional tools/page-diff/prepare.js hook against a page
// after navigation and before any screenshot / DOM read, so the user can dismiss
// cookie banners, strip ads, or perform side-specific actions. No-op when the file
// is absent; a hook that throws is surfaced with the side + url for diagnosis.
export async function runPreparePage(page, context, targetDir) {
  const hookPath = join(targetDir, 'tools', 'page-diff', 'prepare.js');
  try {
    await access(hookPath);
  } catch {
    return; // no prepare.js -> no-op
  }

  const mod = await import(pathToFileURL(hookPath).href);
  const fn = typeof mod.default === 'function'
    ? mod.default
    : (typeof mod.prepare === 'function' ? mod.prepare : null);
  if (!fn) return; // present but no usable export -> no-op

  try {
    await fn(page, context);
  } catch (error) {
    throw new Error(
      `tools/page-diff/prepare.js failed on the ${context.side} page (${context.url}): ${error.message}`,
      { cause: error },
    );
  }
}
