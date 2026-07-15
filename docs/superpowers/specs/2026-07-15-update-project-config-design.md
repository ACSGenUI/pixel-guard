# Design: Update Project Config Step

## Context

`pixel-guard` is a Mastra MCP server that scaffolds/installs the AEM Visual
Test environment into a target AEM Edge Delivery Services (EDS) project. The
`aem-visual-test-install` workflow currently has three steps:
`checkPrerequisitesStep` (Docker installed), `checkProjectStructureStep`
(target project looks like an AEM EDS project), and `copyRequiredFilesStep`
(copies `tools/`, `.dockerignore`, `.env.example` from the bundled
`aem-visual-checker/` source into the target project).

`aem-visual-checker/changes.js` holds reference data for a fourth step,
explicitly called out as out-of-scope in the `copyRequiredFilesStep` design:
merging visual-test npm scripts and dependencies into the target's
`package.json`, and appending ignore entries to its `.gitignore` and
`.hlxignore`. This design covers that step.

`changes.js` currently stores this data as raw template-literal strings
(including a `// Visual Testing Scripts` comment line inside the `scripts`
string, which makes it invalid JSON) plus redundant "full block" variables
(`dependecy`, `devDependencies`) alongside "append" variables
(`dependecyAppend`, `devDependenciesAppend`) that duplicate the same key/value
pairs in a fragment shape. Since the target's `package.json` is guaranteed to
already exist (`checkProjectStructureStep` requires it), only the merge-shape
data is ever needed — the full-block variables are dead weight.

## Requirements

- Refactor `aem-visual-checker/changes.js` to export plain JS objects/arrays
  instead of template-literal strings:
  - `scripts: Record<string, string>`
  - `dependenciesToAdd: Record<string, string>`
  - `devDependenciesToAdd: Record<string, string>`
  - `gitignoreLines: string[]`
  - `hlxignoreLines: string[]`
  - Drop `dependecy`, `devDependencies` (full-block strings) and the
    `dependecyAppend`/`devDependenciesAppend` naming — superseded by the
    objects above.
- Add a step, gated on `dockerInstalled && projectStructureValid &&
  filesCopied`, that:
  - Merges `scripts`, `dependenciesToAdd`, and `devDependenciesToAdd` into the
    target's `package.json` (`scripts`, `dependencies`, `devDependencies`
    respectively), overwriting any key that already exists in the target with
    our version — mirroring `copyRequiredFiles`'s overwrite semantics.
  - Appends each line of `gitignoreLines` to the target's `.gitignore` and
    each line of `hlxignoreLines` to the target's `.hlxignore`, skipping any
    line that's already present so re-running the workflow against an
    already-installed project doesn't pile up duplicate entries.
  - Creates `.hlxignore` if it doesn't already exist in the target (it's not
    part of `REQUIRED_PROJECT_PATHS`, so it may be absent); `.gitignore` is
    assumed to exist as part of a normal git checkout but is also created if
    somehow missing, for symmetry.
- If any of the three gating booleans is `false`, skip all filesystem writes
  and report why via the output message, matching the existing steps'
  convention.

## Design

### `changes.js` refactor

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

### Importing `changes.js` from TypeScript

`changes.js` lives outside `src/` (at `aem-visual-checker/changes.js`,
alongside the other install assets), and the project's `tsconfig.json`
currently has no `allowJs` and `"include": ["src"]`. Rather than enabling
`allowJs` project-wide (which would pull the unrelated `tools/` browser/Node
scripts under `aem-visual-checker/tools` into type-checking), add just this
one file to `include`:

```json
{
  "compilerOptions": { "...": "...", "allowJs": true },
  "include": ["src", "aem-visual-checker/changes.js"]
}
```

The new module then does a normal ESM import:

```ts
import { scripts, dependenciesToAdd, devDependenciesToAdd, gitignoreLines, hlxignoreLines } from '../../aem-visual-checker/changes.js';
```

### New file: `src/workflows/update-project-config.ts`

Pure, unit-testable helpers — no Mastra dependency, mirroring how
`copyRequiredFiles` is a plain function independent of the step that calls
it:

```ts
export async function mergePackageJson(
  targetDir: string,
  additions: { scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> },
): Promise<void>
```

- Reads `targetDir/package.json`, `JSON.parse`s it.
- `pkg.scripts = { ...(pkg.scripts ?? {}), ...additions.scripts }` (same for
  `dependencies`/`devDependencies`) — our keys win on conflict.
- Writes back with `JSON.stringify(pkg, null, 2) + '\n'`.

```ts
export async function appendMissingLines(filePath: string, lines: string[]): Promise<void>
```

- Reads `filePath` if it exists (empty string if `ENOENT`), splits on `\n`.
- Determines which of `lines` are not already present verbatim among the
  existing lines.
- If there's nothing missing, does nothing (no write).
- Otherwise appends the missing lines (each on its own line) to the end of
  the file's content, ensuring a single trailing newline, and writes it back
  (creating the file, including any needed directories — none needed here
  since both targets are project-root files — if it didn't exist).
- Used for both `.gitignore` and `.hlxignore`.

### Step: `updateProjectConfigStep` (added to `aem-visual-test-install.ts`)

The step definition itself stays in `aem-visual-test-install.ts` next to the
other three steps — it needs `getStepResult` references to
`checkPrerequisitesStep`, `checkProjectStructureStep`, and
`copyRequiredFilesStep`, all defined in that file. Putting the step in
`update-project-config.ts` instead would require that file to import those
three steps back from `aem-visual-test-install.ts`, creating a circular
import between the two modules. `aem-visual-test-install.ts` importing the
*pure helpers* (one-directional) avoids that.

```ts
import { mergePackageJson, appendMissingLines } from './update-project-config.js';
import { scripts, dependenciesToAdd, devDependenciesToAdd, gitignoreLines, hlxignoreLines } from '../../aem-visual-checker/changes.js';

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

### Workflow wiring

`aemVisualTestInstallWorkflow` gains `.then(updateProjectConfigStep)` after
`.then(copyRequiredFilesStep)`, and its `outputSchema`/`.map()` gain
`configUpdated`/`configUpdatedMessage`.

## Out of scope

- Any conflict-resolution strategy other than overwrite for `package.json`
  keys (e.g. prompting, versioned merge of semver ranges).
- Formatting/style preservation of the target's existing `package.json`
  beyond standard `JSON.stringify(..., null, 2)` (e.g. original key
  ordering beyond object-spread order, trailing commas, comments — none of
  which JSON supports anyway).
- Validating that the merged `package.json` is installable (e.g. running
  `npm install`) — that's a separate concern from this step.

## Testing

- Unit tests for `mergePackageJson` against temp directories:
  - Merges scripts/dependencies/devDependencies into an existing
    `package.json` that already has all three keys.
  - Creates `scripts`/`dependencies`/`devDependencies` keys when the target's
    `package.json` doesn't have them yet.
  - Overwrites a key that exists in both target and additions.
- Unit tests for `appendMissingLines` against temp files:
  - Creates the file with the given lines when it doesn't exist.
  - Appends only the lines not already present when the file exists with
    partial overlap.
  - Leaves the file unchanged (no lines added) when everything is already
    present (idempotency / re-run safety).
- Manual verification of `updateProjectConfigStep`'s gating (skipped when any
  of the three upstream booleans is false) and of the full four-step workflow
  run end-to-end against a scratch target directory.
