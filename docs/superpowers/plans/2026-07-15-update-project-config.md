# Update Project Config Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth step to the `aem-visual-test-install` workflow that merges visual-test npm scripts/dependencies into the target project's `package.json` and appends ignore entries to its `.gitignore` and `.hlxignore`, using data refactored out of `aem-visual-checker/changes.js`, but only when Docker is installed, the project structure is valid, and the required files were successfully copied.

**Architecture:** `aem-visual-checker/changes.js` is refactored from template-literal strings into plain JS objects/arrays (`scripts`, `dependenciesToAdd`, `devDependenciesToAdd`, `gitignoreLines`, `hlxignoreLines`), importable directly from TypeScript once `tsconfig.json` allows it. Two pure, unit-testable helpers — `mergePackageJson` (JSON-parse-merge-overwrite-write) and `appendMissingLines` (read-diff-append, used for both ignore files) — live in a new file, `src/workflows/update-project-config.ts`, independent of Mastra. A new Mastra step, `updateProjectConfigStep`, stays in `src/workflows/aem-visual-test-install.ts` alongside the other three steps (it needs `getStepResult` references to all of them, so keeping it there avoids a circular import between the two files), reads `changes.js`'s data and calls the two helpers, gated on the three upstream booleans.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), `@mastra/core` workflows, `zod` for schemas, Node's built-in `node:test` + `node:assert/strict` test runner, `node:fs/promises` (`readFile`/`writeFile`), run via `tsx --test` / `tsx -e`.

## Global Constraints

- `changes.js` exports plain objects/arrays: `scripts`, `dependenciesToAdd`, `devDependenciesToAdd` (all `Record<string, string>`), `gitignoreLines`, `hlxignoreLines` (both `string[]`). The old `dependecy`, `devDependencies` (full-block strings) and the `dependecyAppend`/`devDependenciesAppend` names are removed entirely — nothing else references them.
- `package.json` merging overwrites: any key present in both the target's `scripts`/`dependencies`/`devDependencies` and our additions is replaced by our value. Keys only in the target are preserved.
- `.gitignore`/`.hlxignore` appending is idempotent: only lines not already present (exact string match) are appended; re-running against an already-updated file adds nothing.
- Both `.gitignore` and `.hlxignore` are created (with just the appended lines) if they don't already exist in the target.
- `updateProjectConfigStep` only performs its writes if `dockerInstalled`, `projectStructureValid`, and `filesCopied` are all `true` (read via `getStepResult` from `checkPrerequisitesStep`, `checkProjectStructureStep`, and `copyRequiredFilesStep` respectively). Otherwise it skips all filesystem writes and reports why.
- Output shape mirrors the existing steps' convention: `{ configUpdated: boolean, message: string }`.
- `tsconfig.json` gains `"allowJs": true` and `"aem-visual-checker/changes.js"` added to `include` — not the whole `aem-visual-checker/` tree, to avoid pulling unrelated browser/Node scripts under `aem-visual-checker/tools` into type-checking.

---

### Task 1: Refactor `changes.js` to plain JS objects and make it importable from TypeScript

**Files:**
- Modify: `aem-visual-checker/changes.js`
- Modify: `tsconfig.json`

**Interfaces:**
- Produces: `scripts: Record<string, string>`, `dependenciesToAdd: Record<string, string>`, `devDependenciesToAdd: Record<string, string>`, `gitignoreLines: string[]`, `hlxignoreLines: string[]`, all exported from `aem-visual-checker/changes.js`.

- [ ] **Step 1: Rewrite `changes.js`**

Replace the entire contents of `aem-visual-checker/changes.js` with:

```js
export const scripts = {
  "test:visual:figma": "node tools/visual-tests/figma-util.js",
  "test:visual:report": "playwright show-report tools/visual-tests/playwright-report",
  "test:visual:server": "node tools/visual-tests/start-visual-test-server.js",
  "start": "concurrently -k \"npm run test:visual:server\" \"aem up\" --kill-others-on-fail",
  "test:visual:build": "docker compose -f tools/visual-tests/docker-compose.yml build",
  "test:visual": "docker compose -f tools/visual-tests/docker-compose.yml run --rm playwright",
  "test:visual:update": "docker compose -f tools/visual-tests/docker-compose.yml run --rm playwright npx playwright test --config=tools/visual-tests/playwright.config.ts --update-snapshots",
  "test:visual:block": "docker compose -f tools/visual-tests/docker-compose.yml run --rm playwright npx playwright test --config=tools/visual-tests/playwright.config.ts",
  "test:visual:generate": "docker compose -f tools/visual-tests/docker-compose.yml run --rm playwright node tools/visual-tests/generate-visual-tests.js"
};

export const dependenciesToAdd = {
  "@playwright/test": "^1.53.1",
  "cors": "^2.8.5",
  "dotenv": "^17.2.3",
  "express": "^4.21.2",
  "playwright": "^1.53.1"
};

export const devDependenciesToAdd = {
  "concurrently": "^8.2.2",
  "husky": "^8.0.3"
};

export const gitignoreLines = [
  "tools/visual-tests/port.txt",
  "playwright-report/",
  "test-results/",
  "tools/visual-tests/playwright-report/",
  "tools/visual-tests/test-results/",
  ".env",
  ".env.local"
];

export const hlxignoreLines = ["tools/visual-tests/*"];
```

- [ ] **Step 2: Update `tsconfig.json`**

Change:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

to:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowJs": true,
    "outDir": "dist"
  },
  "include": ["src", "aem-visual-checker/changes.js"]
}
```

- [ ] **Step 3: Verify the module loads and type-checks**

Run: `node --input-type=module -e "import('./aem-visual-checker/changes.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'scripts', 'dependenciesToAdd', 'devDependenciesToAdd', 'gitignoreLines', 'hlxignoreLines' ]`

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add aem-visual-checker/changes.js tsconfig.json
git commit -m "Refactor changes.js to plain JS objects"
```

---

### Task 2: Add `mergePackageJson` and `appendMissingLines` helpers with tests

**Files:**
- Create: `src/workflows/update-project-config.ts`
- Create: `src/workflows/update-project-config.test.ts`

**Interfaces:**
- Produces: `export async function mergePackageJson(targetDir: string, additions: { scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> }): Promise<void>`
- Produces: `export async function appendMissingLines(filePath: string, lines: string[]): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `src/workflows/update-project-config.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergePackageJson, appendMissingLines } from './update-project-config.js';

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pixel-guard-test-'));
}

test('mergePackageJson merges scripts/dependencies/devDependencies into an existing package.json, overwriting shared keys', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'target-project',
        scripts: { start: 'aem up', build: 'echo build' },
        dependencies: { lodash: '^4.0.0' },
        devDependencies: { eslint: '^8.0.0' },
      }, null, 2),
    );

    await mergePackageJson(dir, {
      scripts: { start: 'concurrently -k "npm run test:visual:server" "aem up"', 'test:visual': 'echo visual' },
      dependencies: { playwright: '^1.53.1' },
      devDependencies: { husky: '^8.0.3' },
    });

    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    assert.deepEqual(pkg.scripts, {
      start: 'concurrently -k "npm run test:visual:server" "aem up"',
      build: 'echo build',
      'test:visual': 'echo visual',
    });
    assert.deepEqual(pkg.dependencies, { lodash: '^4.0.0', playwright: '^1.53.1' });
    assert.deepEqual(pkg.devDependencies, { eslint: '^8.0.0', husky: '^8.0.3' });
    assert.equal(pkg.name, 'target-project');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergePackageJson creates scripts/dependencies/devDependencies keys when the target package.json lacks them', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'bare-project' }, null, 2));

    await mergePackageJson(dir, {
      scripts: { 'test:visual': 'echo visual' },
      dependencies: { playwright: '^1.53.1' },
      devDependencies: { husky: '^8.0.3' },
    });

    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    assert.deepEqual(pkg.scripts, { 'test:visual': 'echo visual' });
    assert.deepEqual(pkg.dependencies, { playwright: '^1.53.1' });
    assert.deepEqual(pkg.devDependencies, { husky: '^8.0.3' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergePackageJson writes pretty-printed JSON with a trailing newline', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'bare-project' }));

    await mergePackageJson(dir, { scripts: { start: 'aem up' }, dependencies: {}, devDependencies: {} });

    const raw = await readFile(join(dir, 'package.json'), 'utf8');
    assert.ok(raw.endsWith('\n'));
    assert.ok(raw.includes('  "scripts"'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('appendMissingLines creates the file with the given lines when it does not exist', async () => {
  const dir = await makeTempDir();
  try {
    const filePath = join(dir, '.hlxignore');

    await appendMissingLines(filePath, ['tools/visual-tests/*']);

    assert.equal(await readFile(filePath, 'utf8'), 'tools/visual-tests/*\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('appendMissingLines appends only the lines not already present', async () => {
  const dir = await makeTempDir();
  try {
    const filePath = join(dir, '.gitignore');
    await writeFile(filePath, 'node_modules\n.env\n');

    await appendMissingLines(filePath, ['.env', 'playwright-report/', 'test-results/']);

    assert.equal(
      await readFile(filePath, 'utf8'),
      'node_modules\n.env\nplaywright-report/\ntest-results/\n',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('appendMissingLines leaves the file unchanged when every line is already present', async () => {
  const dir = await makeTempDir();
  try {
    const filePath = join(dir, '.gitignore');
    await writeFile(filePath, 'node_modules\n.env\n');

    await appendMissingLines(filePath, ['.env']);

    assert.equal(await readFile(filePath, 'utf8'), 'node_modules\n.env\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/workflows/update-project-config.ts` does not exist (module not found).

- [ ] **Step 3: Implement the helpers**

Create `src/workflows/update-project-config.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all new tests green, plus the existing 7 tests in `aem-visual-test-install.test.ts` still passing.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/update-project-config.ts src/workflows/update-project-config.test.ts
git commit -m "Add mergePackageJson and appendMissingLines helpers with tests"
```

---

### Task 3: Add `updateProjectConfigStep` and wire it into the workflow

**Files:**
- Modify: `src/workflows/aem-visual-test-install.ts`

**Interfaces:**
- Consumes: `mergePackageJson`, `appendMissingLines` from Task 2; `scripts`, `dependenciesToAdd`, `devDependenciesToAdd`, `gitignoreLines`, `hlxignoreLines` from `aem-visual-checker/changes.js` (Task 1).
- Produces: `export const updateProjectConfigStep` — a Mastra step with `outputSchema: z.object({ configUpdated: z.boolean(), message: z.string() })`.
- Produces: `aemVisualTestInstallWorkflow`'s output schema gains `configUpdated: z.boolean()` and `configUpdatedMessage: z.string()`.

- [ ] **Step 1: Add the new imports**

In `src/workflows/aem-visual-test-install.ts`, change the top imports from:

```ts
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { access, cp } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { mergePackageJson, appendMissingLines } from './update-project-config.js';
import { scripts, dependenciesToAdd, devDependenciesToAdd, gitignoreLines, hlxignoreLines } from '../../aem-visual-checker/changes.js';
```

- [ ] **Step 2: Add `updateProjectConfigStep`**

Add, immediately after `copyRequiredFilesStep` and before `aemVisualTestInstallWorkflow`:

```ts
export const updateProjectConfigStep = createStep({
  id: 'update-project-config',
  description: 'Merges visual-test npm scripts/dependencies into package.json and appends ignore entries to .gitignore and .hlxignore, if prerequisites are met.',
  inputSchema: copyRequiredFilesStep.outputSchema,
  outputSchema: z.object({
    configUpdated: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ getStepResult }) => {
    const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
    const { projectStructureValid } = getStepResult(checkProjectStructureStep);
    const { filesCopied } = getStepResult(copyRequiredFilesStep);
    if (!dockerInstalled || !projectStructureValid || !filesCopied) {
      return {
        configUpdated: false,
        message: 'Skipped updating project config because prerequisites were not met.',
      };
    }
    await mergePackageJson(process.cwd(), {
      scripts,
      dependencies: dependenciesToAdd,
      devDependencies: devDependenciesToAdd,
    });
    await appendMissingLines(join(process.cwd(), '.gitignore'), gitignoreLines);
    await appendMissingLines(join(process.cwd(), '.hlxignore'), hlxignoreLines);
    return {
      configUpdated: true,
      message: 'Updated package.json, .gitignore, and .hlxignore.',
    };
  },
});
```

- [ ] **Step 3: Wire the new step into the workflow and merge outputs**

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
    configUpdated: z.boolean(),
    configUpdatedMessage: z.string(),
  }),
})
  .then(checkPrerequisitesStep)
  .then(checkProjectStructureStep)
  .then(copyRequiredFilesStep)
  .then(updateProjectConfigStep)
  .map({
    dockerInstalled: { step: checkPrerequisitesStep, path: 'dockerInstalled' },
    dockerMessage: { step: checkPrerequisitesStep, path: 'message' },
    projectStructureValid: { step: checkProjectStructureStep, path: 'projectStructureValid' },
    projectStructureMessage: { step: checkProjectStructureStep, path: 'message' },
    filesCopied: { step: copyRequiredFilesStep, path: 'filesCopied' },
    filesCopiedMessage: { step: copyRequiredFilesStep, path: 'message' },
    configUpdated: { step: updateProjectConfigStep, path: 'configUpdated' },
    configUpdatedMessage: { step: updateProjectConfigStep, path: 'message' },
  })
  .commit();
```

- [ ] **Step 4: Type-check the project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the automated tests**

Run: `npm test`
Expected: PASS — same tests from Tasks 1–2 still green (this task adds no new automated tests; the step's gating and workflow wiring are verified manually next).

- [ ] **Step 6: Manually verify the skip case (project structure invalid)**

From the `pixel-guard` repo root (which has no `blocks/`, `scripts/aem.js`, or `head.html`), run:

```bash
npx tsx -e "
import { aemVisualTestInstallWorkflow } from './src/workflows/aem-visual-test-install.js';
const run = await aemVisualTestInstallWorkflow.createRun();
const result = await run.start({ inputData: {} });
console.log(JSON.stringify(result, null, 2));
"
```

Expected: output includes `"projectStructureValid": false`, `"filesCopied": false`, and `"configUpdated": false` with `"configUpdatedMessage": "Skipped updating project config because prerequisites were not met."`.

- [ ] **Step 7: Manually verify the update case (prerequisites met)**

Create a scratch target directory with the required EDS structure plus a pre-existing `package.json` and `.gitignore` (to see merge/overwrite and idempotent-append behavior in action), then run the workflow with `process.chdir` pointed at it:

```bash
mkdir -p /tmp/pixel-guard-verify/blocks /tmp/pixel-guard-verify/scripts
touch /tmp/pixel-guard-verify/scripts/aem.js /tmp/pixel-guard-verify/head.html
cat > /tmp/pixel-guard-verify/package.json <<'EOF'
{
  "name": "scratch-target",
  "scripts": { "start": "aem up" },
  "dependencies": {},
  "devDependencies": {}
}
EOF
printf 'node_modules\n.env\n' > /tmp/pixel-guard-verify/.gitignore
npx tsx -e "
import { aemVisualTestInstallWorkflow } from './src/workflows/aem-visual-test-install.js';
process.chdir('/tmp/pixel-guard-verify');
const run = await aemVisualTestInstallWorkflow.createRun();
const result = await run.start({ inputData: {} });
console.log(JSON.stringify(result, null, 2));
"
cat /tmp/pixel-guard-verify/package.json
cat /tmp/pixel-guard-verify/.gitignore
cat /tmp/pixel-guard-verify/.hlxignore
rm -rf /tmp/pixel-guard-verify
```

Expected: if Docker is installed on this machine, output includes `"configUpdated": true` and `"configUpdatedMessage": "Updated package.json, .gitignore, and .hlxignore."`; `package.json`'s `scripts.start` is overwritten to the visual-test `concurrently` command, `dependencies`/`devDependencies` gain the visual-test packages; `.gitignore` keeps `node_modules`/`.env` and gains the new lines (not duplicating `.env`); `.hlxignore` is created containing `tools/visual-tests/*`. (If Docker isn't installed on this machine, `configUpdated` will correctly be `false` with the skip message instead — that's expected gating behavior, not a bug.)

- [ ] **Step 8: Commit**

```bash
git add src/workflows/aem-visual-test-install.ts
git commit -m "Add updateProjectConfigStep and wire it into the workflow"
```
