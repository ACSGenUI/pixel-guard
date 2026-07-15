# Copy Required Files Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third step to the `aem-visual-test-install` workflow that copies `tools/`, `.dockerignore`, and `.env.example` from `pixel-guard`'s bundled `aem-visual-checker/` source into the target project's root, but only when both prior checks (Docker installed, valid EDS project structure) passed.

**Architecture:** A pure, unit-testable helper (`copyRequiredFiles`) does the actual filesystem copy between an arbitrary source and target directory, using `fs.cp` with `recursive: true, force: true` for `tools/` (merge-overwrite, `.DS_Store` filtered out) and single-file overwrite copies for `.dockerignore` and `.env.example`. A new Mastra step (`copyRequiredFilesStep`) wraps that helper: it reads the two earlier steps' results via Mastra's `getStepResult` (not via `inputSchema`, since the step needs data from two steps back), skips the copy if either prerequisite failed, and otherwise calls the helper with the real source directory (resolved relative to this module's own file via `import.meta.url`, since `process.cwd()` at runtime is the *target* project) and `process.cwd()` as the target. The workflow chains the new step after `checkProjectStructureStep` and extends the final `.map()` to include its result in the overall output.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), `@mastra/core` workflows, `zod` for schemas, Node's built-in `node:test` + `node:assert/strict` test runner, `node:fs/promises` (`cp`), run via `tsx --test` / `tsx -e`.

## Global Constraints

- Source files live in `aem-visual-checker/` at the `pixel-guard` repo root: `tools/`, `.dockerignore`, `.env.example`. `changes.js` in that same directory is explicitly **not** copied by this step (it's reference material for a future step).
- The source directory must be resolved relative to the workflow module's own file location (`import.meta.url`), never relative to `process.cwd()` — `process.cwd()` is the *target* project being installed into, not the `pixel-guard` repo.
- Copying is merge-overwrite: files that exist in both source and target are replaced; pre-existing target files that aren't part of the source tree (e.g. extra files already under a target `tools/`) are left untouched. The target directory is never deleted/cleaned first.
- `.DS_Store` anywhere under the source `tools/` must never be copied to the target.
- The copy only runs if both `checkPrerequisitesStep`'s `dockerInstalled` and `checkProjectStructureStep`'s `projectStructureValid` are `true`. Otherwise, skip the filesystem operation entirely and report why via the output message.
- Output shape mirrors the existing steps' convention: a boolean flag plus a `message` string (`{ filesCopied: boolean, message: string }`).

---

### Task 1: Add `copyRequiredFiles` helper with tests

**Files:**
- Modify: `src/workflows/aem-visual-test-install.ts`
- Modify: `src/workflows/aem-visual-test-install.test.ts`

**Interfaces:**
- Produces: `export async function copyRequiredFiles(sourceDir: string, targetDir: string): Promise<void>` — copies `tools/` (recursively, excluding any `.DS_Store`), `.dockerignore`, and `.env.example` from `sourceDir` into `targetDir`, overwriting files that already exist at the destination path.

- [ ] **Step 1: Write the failing tests**

Add to `src/workflows/aem-visual-test-install.test.ts`, updating the top imports and appending the new tests:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMissingProjectPaths, copyRequiredFiles } from './aem-visual-test-install.js';
```

(This changes the existing `import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';` line to also import `readFile` and `access`, and changes the existing `import { findMissingProjectPaths } from './aem-visual-test-install.js';` line to also import `copyRequiredFiles`.)

Append these four tests at the end of the file:

```ts
test('copyRequiredFiles copies tools/, .dockerignore, and .env.example into the target directory', async () => {
  const srcDir = await makeTempProjectDir();
  const targetDir = await makeTempProjectDir();
  try {
    await mkdir(join(srcDir, 'tools', 'sidekick'), { recursive: true });
    await writeFile(join(srcDir, 'tools', 'sidekick', 'config.json'), '{"sidekick":true}');
    await writeFile(join(srcDir, '.dockerignore'), 'node_modules\n');
    await writeFile(join(srcDir, '.env.example'), 'FIGMA_ACCESS_TOKEN=\n');

    await copyRequiredFiles(srcDir, targetDir);

    assert.equal(
      await readFile(join(targetDir, 'tools', 'sidekick', 'config.json'), 'utf8'),
      '{"sidekick":true}',
    );
    assert.equal(await readFile(join(targetDir, '.dockerignore'), 'utf8'), 'node_modules\n');
    assert.equal(await readFile(join(targetDir, '.env.example'), 'utf8'), 'FIGMA_ACCESS_TOKEN=\n');
  } finally {
    await rm(srcDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});

test('copyRequiredFiles excludes .DS_Store files from the tools/ copy', async () => {
  const srcDir = await makeTempProjectDir();
  const targetDir = await makeTempProjectDir();
  try {
    await mkdir(join(srcDir, 'tools', 'sidekick'), { recursive: true });
    await writeFile(join(srcDir, 'tools', '.DS_Store'), 'junk');
    await writeFile(join(srcDir, 'tools', 'sidekick', 'config.json'), '{}');
    await writeFile(join(srcDir, '.dockerignore'), '');
    await writeFile(join(srcDir, '.env.example'), '');

    await copyRequiredFiles(srcDir, targetDir);

    await assert.rejects(() => access(join(targetDir, 'tools', '.DS_Store')));
    assert.equal(await readFile(join(targetDir, 'tools', 'sidekick', 'config.json'), 'utf8'), '{}');
  } finally {
    await rm(srcDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});

test('copyRequiredFiles overwrites files that already exist in the target', async () => {
  const srcDir = await makeTempProjectDir();
  const targetDir = await makeTempProjectDir();
  try {
    await mkdir(join(srcDir, 'tools'), { recursive: true });
    await writeFile(join(srcDir, '.env.example'), 'NEW_VALUE=1\n');
    await writeFile(join(srcDir, '.dockerignore'), 'NEW_IGNORE\n');
    await writeFile(join(targetDir, '.env.example'), 'OLD_VALUE=0\n');
    await writeFile(join(targetDir, '.dockerignore'), 'OLD_IGNORE\n');

    await copyRequiredFiles(srcDir, targetDir);

    assert.equal(await readFile(join(targetDir, '.env.example'), 'utf8'), 'NEW_VALUE=1\n');
    assert.equal(await readFile(join(targetDir, '.dockerignore'), 'utf8'), 'NEW_IGNORE\n');
  } finally {
    await rm(srcDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});

test('copyRequiredFiles leaves target-only files under tools/ untouched (merge, not clean)', async () => {
  const srcDir = await makeTempProjectDir();
  const targetDir = await makeTempProjectDir();
  try {
    await mkdir(join(srcDir, 'tools', 'sidekick'), { recursive: true });
    await writeFile(join(srcDir, 'tools', 'sidekick', 'config.json'), '{}');
    await writeFile(join(srcDir, '.dockerignore'), '');
    await writeFile(join(srcDir, '.env.example'), '');
    await mkdir(join(targetDir, 'tools'), { recursive: true });
    await writeFile(join(targetDir, 'tools', 'local-notes.txt'), 'keep me');

    await copyRequiredFiles(srcDir, targetDir);

    assert.equal(await readFile(join(targetDir, 'tools', 'local-notes.txt'), 'utf8'), 'keep me');
    assert.equal(await readFile(join(targetDir, 'tools', 'sidekick', 'config.json'), 'utf8'), '{}');
  } finally {
    await rm(srcDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `copyRequiredFiles` is not exported from `./aem-visual-test-install.js` (module has no such export / import error).

- [ ] **Step 3: Implement the helper**

In `src/workflows/aem-visual-test-install.ts`, update the top imports from:

```ts
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
```

to:

```ts
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { access, cp } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
```

Then add, immediately after the `findMissingProjectPaths` function and before `checkPrerequisitesStep`:

```ts
const ASSETS_SOURCE_DIR = fileURLToPath(new URL('../../aem-visual-checker', import.meta.url));

export async function copyRequiredFiles(sourceDir: string, targetDir: string): Promise<void> {
  await cp(join(sourceDir, 'tools'), join(targetDir, 'tools'), {
    recursive: true,
    force: true,
    filter: (source) => basename(source) !== '.DS_Store',
  });
  await cp(join(sourceDir, '.dockerignore'), join(targetDir, '.dockerignore'), { force: true });
  await cp(join(sourceDir, '.env.example'), join(targetDir, '.env.example'), { force: true });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 7 tests green (the 3 existing `findMissingProjectPaths` tests plus the 4 new `copyRequiredFiles` tests).

- [ ] **Step 5: Commit**

```bash
git add src/workflows/aem-visual-test-install.ts src/workflows/aem-visual-test-install.test.ts
git commit -m "Add copyRequiredFiles helper with tests"
```

---

### Task 2: Add `copyRequiredFilesStep` and wire it into the workflow

**Files:**
- Modify: `src/workflows/aem-visual-test-install.ts`

**Interfaces:**
- Consumes: `copyRequiredFiles(sourceDir: string, targetDir: string): Promise<void>` and `ASSETS_SOURCE_DIR` from Task 1.
- Produces: `export const copyRequiredFilesStep` — a Mastra step with `outputSchema: z.object({ filesCopied: z.boolean(), message: z.string() })`.
- Produces: `aemVisualTestInstallWorkflow`'s output schema becomes `z.object({ dockerInstalled: z.boolean(), dockerMessage: z.string(), projectStructureValid: z.boolean(), projectStructureMessage: z.string(), filesCopied: z.boolean(), filesCopiedMessage: z.string() })`.

- [ ] **Step 1: Add `copyRequiredFilesStep`**

In `src/workflows/aem-visual-test-install.ts`, add after `checkProjectStructureStep` and before `aemVisualTestInstallWorkflow`:

```ts
export const copyRequiredFilesStep = createStep({
  id: 'copy-required-files',
  description: 'Copies the tools/ folder, .dockerignore, and .env.example into the target project, if prerequisites are met.',
  inputSchema: checkProjectStructureStep.outputSchema,
  outputSchema: z.object({
    filesCopied: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ getStepResult }) => {
    const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
    const { projectStructureValid } = getStepResult(checkProjectStructureStep);
    if (!dockerInstalled || !projectStructureValid) {
      return {
        filesCopied: false,
        message: 'Skipped copying required files because prerequisites were not met.',
      };
    }
    await copyRequiredFiles(ASSETS_SOURCE_DIR, process.cwd());
    return {
      filesCopied: true,
      message: 'Copied tools/, .dockerignore, and .env.example to the project.',
    };
  },
});
```

- [ ] **Step 2: Wire the new step into the workflow and merge outputs**

Replace the existing `aemVisualTestInstallWorkflow` definition:

```ts
export const aemVisualTestInstallWorkflow = createWorkflow({
  id: 'aem-visual-test-install',
  description: 'Install or Scaffold the AEM Visual Test environment in the current project. Check for prerequisites and provide instructions if not met. copy and modify the necessary files to set up the environment.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    dockerInstalled: z.boolean(),
    dockerMessage: z.string(),
    projectStructureValid: z.boolean(),
    projectStructureMessage: z.string(),
  }),
})
  .then(checkPrerequisitesStep)
  .then(checkProjectStructureStep)
  .map({
    dockerInstalled: { step: checkPrerequisitesStep, path: 'dockerInstalled' },
    dockerMessage: { step: checkPrerequisitesStep, path: 'message' },
    projectStructureValid: { step: checkProjectStructureStep, path: 'projectStructureValid' },
    projectStructureMessage: { step: checkProjectStructureStep, path: 'message' },
  })
  .commit();
```

with:

```ts
export const aemVisualTestInstallWorkflow = createWorkflow({
  id: 'aem-visual-test-install',
  description: 'Install or Scaffold the AEM Visual Test environment in the current project. Check for prerequisites and provide instructions if not met. copy and modify the necessary files to set up the environment.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    dockerInstalled: z.boolean(),
    dockerMessage: z.string(),
    projectStructureValid: z.boolean(),
    projectStructureMessage: z.string(),
    filesCopied: z.boolean(),
    filesCopiedMessage: z.string(),
  }),
})
  .then(checkPrerequisitesStep)
  .then(checkProjectStructureStep)
  .then(copyRequiredFilesStep)
  .map({
    dockerInstalled: { step: checkPrerequisitesStep, path: 'dockerInstalled' },
    dockerMessage: { step: checkPrerequisitesStep, path: 'message' },
    projectStructureValid: { step: checkProjectStructureStep, path: 'projectStructureValid' },
    projectStructureMessage: { step: checkProjectStructureStep, path: 'message' },
    filesCopied: { step: copyRequiredFilesStep, path: 'filesCopied' },
    filesCopiedMessage: { step: copyRequiredFilesStep, path: 'message' },
  })
  .commit();
```

- [ ] **Step 3: Type-check the project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the automated tests**

Run: `npm test`
Expected: PASS — same 7 tests from Task 1 still green (this task adds no new automated tests; the step's gating and the workflow wiring are verified manually next).

- [ ] **Step 5: Manually verify the skip case (project structure invalid)**

From the `pixel-guard` repo root (which has no `blocks/`, `scripts/aem.js`, or `head.html`), run:

```bash
npx tsx -e "
import { aemVisualTestInstallWorkflow } from './src/workflows/aem-visual-test-install.js';
const run = await aemVisualTestInstallWorkflow.createRun();
const result = await run.start({ inputData: {} });
console.log(JSON.stringify(result, null, 2));
"
```

Expected: output includes `\"projectStructureValid\": false`, and `\"filesCopied\": false` with `\"filesCopiedMessage\": \"Skipped copying required files because prerequisites were not met.\"`.

- [ ] **Step 6: Manually verify the copy case (prerequisites met)**

Create a scratch target directory with the required EDS structure, then run the workflow with `process.chdir` pointed at it (the import must happen while cwd is still the `pixel-guard` root, so both the relative import and `ASSETS_SOURCE_DIR` resolve correctly; `process.chdir` only needs to happen before `run.start()`):

```bash
mkdir -p /tmp/pixel-guard-verify/blocks /tmp/pixel-guard-verify/scripts
touch /tmp/pixel-guard-verify/scripts/aem.js /tmp/pixel-guard-verify/package.json /tmp/pixel-guard-verify/head.html
npx tsx -e "
import { aemVisualTestInstallWorkflow } from './src/workflows/aem-visual-test-install.js';
process.chdir('/tmp/pixel-guard-verify');
const run = await aemVisualTestInstallWorkflow.createRun();
const result = await run.start({ inputData: {} });
console.log(JSON.stringify(result, null, 2));
"
find /tmp/pixel-guard-verify/tools -maxdepth 2
ls -la /tmp/pixel-guard-verify/.dockerignore /tmp/pixel-guard-verify/.env.example
rm -rf /tmp/pixel-guard-verify
```

Expected: if Docker is installed on this machine, output includes `\"filesCopied\": true` and `\"filesCopiedMessage\": \"Copied tools/, .dockerignore, and .env.example to the project.\"`, and the `find`/`ls` commands confirm `tools/sidekick`, `tools/visual-overlay`, `tools/visual-tests`, `.dockerignore`, and `.env.example` all exist under `/tmp/pixel-guard-verify`. (If Docker isn't installed on this machine, `filesCopied` will correctly be `false` with the skip message instead — that's expected gating behavior, not a bug; re-run Step 5's assertions mentally against that case instead.)

- [ ] **Step 7: Commit**

```bash
git add src/workflows/aem-visual-test-install.ts
git commit -m "Add copyRequiredFilesStep and wire it into the workflow"
```
