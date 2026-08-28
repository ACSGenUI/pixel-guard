# Project Structure Check Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second step to the `aem-visual-test-install` workflow that verifies the target project (the directory the MCP server's process is running in) has the standard AEM Edge Delivery Services layout, and merge its result with the existing Docker check into one final workflow output.

**Architecture:** A pure, unit-testable helper (`findMissingProjectPaths`) does the filesystem existence checks against a given base directory. A new Mastra step (`checkProjectStructureStep`) wraps that helper, calling it with `process.cwd()`. The workflow chains `checkPrerequisitesStep` and `checkProjectStructureStep` independently via `.then()`, then uses `.map()` to combine both steps' booleans and messages into a single final output shape (replacing the current single-step `outputSchema`).

**Tech Stack:** TypeScript (ESM, `"type": "module"`), `@mastra/core` workflows, `zod` for schemas, Node's built-in `node:test` + `node:assert/strict` test runner (no new dependency — `@types/node` is already installed), run via `tsx --test`.

## Global Constraints

- Required paths, relative to the project root, are exactly: `blocks/` (folder), `scripts/aem.js` (file), `package.json` (file), `head.html` (file) — the standard AEM EDS boilerplate layout.
- The project root is `process.cwd()` — no new workflow input is introduced.
- Existence-only checks (via `fs.access`) — do not distinguish file vs. directory type.
- Output shape mirrors the existing `checkPrerequisitesStep` convention: a boolean flag plus a `message` string.
- Both checks (Docker, project structure) must always run — no short-circuiting — and the workflow's final output must report both results.
- On failure, the message must name exactly which required items are missing.

---

### Task 1: Add `findMissingProjectPaths` helper with tests

**Files:**
- Modify: `src/workflows/aem-visual-test-install.ts`
- Create: `src/workflows/aem-visual-test-install.test.ts`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Produces: `export async function findMissingProjectPaths(baseDir: string): Promise<string[]>` — returns an array of human-readable labels for each required path that does not exist under `baseDir`. Empty array means everything required is present. Labels, in required-path order: `'blocks/ folder'`, `'scripts/aem.js'`, `'package.json'`, `'head.html'`.

- [ ] **Step 1: Add the `test` script to `package.json`**

Edit `package.json`'s `"scripts"` block to:

```json
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts",
    "test": "tsx --test src"
  },
```

- [ ] **Step 2: Write the failing tests**

Create `src/workflows/aem-visual-test-install.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMissingProjectPaths } from './aem-visual-test-install.js';

async function makeTempProjectDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pixel-guard-test-'));
}

test('findMissingProjectPaths returns an empty array when all required paths exist', async () => {
  const dir = await makeTempProjectDir();
  try {
    await mkdir(join(dir, 'blocks'));
    await mkdir(join(dir, 'scripts'));
    await writeFile(join(dir, 'scripts', 'aem.js'), '');
    await writeFile(join(dir, 'package.json'), '{}');
    await writeFile(join(dir, 'head.html'), '');

    const missing = await findMissingProjectPaths(dir);

    assert.deepEqual(missing, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findMissingProjectPaths reports every missing required path, in order', async () => {
  const dir = await makeTempProjectDir();
  try {
    // Only package.json exists; blocks/, scripts/aem.js, and head.html are missing.
    await writeFile(join(dir, 'package.json'), '{}');

    const missing = await findMissingProjectPaths(dir);

    assert.deepEqual(missing, ['blocks/ folder', 'scripts/aem.js', 'head.html']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findMissingProjectPaths reports all four paths missing on an empty directory', async () => {
  const dir = await makeTempProjectDir();
  try {
    const missing = await findMissingProjectPaths(dir);

    assert.deepEqual(missing, ['blocks/ folder', 'scripts/aem.js', 'package.json', 'head.html']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `findMissingProjectPaths` is not exported from `./aem-visual-test-install.js` (module has no such export / import error).

- [ ] **Step 4: Implement the helper**

In `src/workflows/aem-visual-test-install.ts`, add near the top (after the existing imports, before `DOCKER_INSTALL_MESSAGE`):

```ts
import { access } from 'node:fs/promises';
import { join } from 'node:path';
```

Then add, after `DOCKER_INSTALL_MESSAGE` and before `checkPrerequisitesStep`:

```ts
const REQUIRED_PROJECT_PATHS: Array<{ relativePath: string; label: string }> = [
  { relativePath: 'blocks', label: 'blocks/ folder' },
  { relativePath: 'scripts/aem.js', label: 'scripts/aem.js' },
  { relativePath: 'package.json', label: 'package.json' },
  { relativePath: 'head.html', label: 'head.html' },
];

export async function findMissingProjectPaths(baseDir: string): Promise<string[]> {
  const missing: string[] = [];
  for (const { relativePath, label } of REQUIRED_PROJECT_PATHS) {
    try {
      await access(join(baseDir, relativePath));
    } catch {
      missing.push(label);
    }
  }
  return missing;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/workflows/aem-visual-test-install.ts src/workflows/aem-visual-test-install.test.ts package.json
git commit -m "Add findMissingProjectPaths helper with tests"
```

---

### Task 2: Add `checkProjectStructureStep` and wire it into the workflow

**Files:**
- Modify: `src/workflows/aem-visual-test-install.ts`

**Interfaces:**
- Consumes: `findMissingProjectPaths(baseDir: string): Promise<string[]>` from Task 1.
- Produces: `export const checkProjectStructureStep` — a Mastra step with `outputSchema: z.object({ projectStructureValid: z.boolean(), message: z.string() })`.
- Produces: `aemVisualTestInstallWorkflow`'s output schema becomes `z.object({ dockerInstalled: z.boolean(), dockerMessage: z.string(), projectStructureValid: z.boolean(), projectStructureMessage: z.string() })`.

- [ ] **Step 1: Add `checkProjectStructureStep`**

In `src/workflows/aem-visual-test-install.ts`, add after `checkPrerequisitesStep` and before `aemVisualTestInstallWorkflow`:

```ts
export const checkProjectStructureStep = createStep({
  id: 'check-project-structure',
  description: 'Checks that the current project has the required AEM Edge Delivery Services file structure (blocks folder, scripts/aem.js, package.json, head.html).',
  inputSchema: z.object({}),
  outputSchema: z.object({
    projectStructureValid: z.boolean(),
    message: z.string(),
  }),
  execute: async () => {
    const missing = await findMissingProjectPaths(process.cwd());
    if (missing.length === 0) {
      return { projectStructureValid: true, message: 'Project structure is valid.' };
    }
    return {
      projectStructureValid: false,
      message: `Missing required project files: ${missing.join(', ')}. This does not look like an AEM Edge Delivery Services project.`,
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
  outputSchema: checkPrerequisitesStep.outputSchema,
})
  .then(checkPrerequisitesStep)
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

- [ ] **Step 3: Type-check the project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the automated tests**

Run: `npm test`
Expected: PASS — same 3 tests from Task 1 still green (this task adds no new automated tests; the workflow wiring is verified manually next).

- [ ] **Step 5: Manually verify the full workflow, missing-structure case**

From the `pixel-guard` repo root (which has no `blocks/`, `scripts/aem.js`, or `head.html`), run:

```bash
npx tsx -e "
import { aemVisualTestInstallWorkflow } from './src/workflows/aem-visual-test-install.js';
const run = await aemVisualTestInstallWorkflow.createRun();
const result = await run.start({ inputData: {} });
console.log(JSON.stringify(result, null, 2));
"
```

Expected: output includes `\"projectStructureValid\": false` and a `projectStructureMessage` naming `blocks/ folder`, `scripts/aem.js`, and `head.html` as missing (`package.json` exists in this repo, so it should NOT be listed as missing). Also confirm `dockerInstalled` and `dockerMessage` are present and reflect whether Docker is installed on this machine.

- [ ] **Step 6: Manually verify the full workflow, valid-structure case**

Create a temporary directory with the required structure, then run the workflow with `process.chdir` pointed at it (the import must happen while cwd is still the `pixel-guard` root, so the relative import resolves; `process.chdir` only needs to happen before `run.start()`, since that's when `findMissingProjectPaths` reads `process.cwd()`):

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
rm -rf /tmp/pixel-guard-verify
```

Expected: output includes `\"projectStructureValid\": true` and `\"message\": \"Project structure is valid.\"`.

- [ ] **Step 7: Commit**

```bash
git add src/workflows/aem-visual-test-install.ts
git commit -m "Add project structure check step and merge with Docker check in workflow output"
```
