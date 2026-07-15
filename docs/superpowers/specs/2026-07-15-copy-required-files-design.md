# Design: Copy Required Files Step

## Context

`pixel-guard` is a Mastra MCP server that scaffolds/installs the AEM Visual
Test environment into a target AEM Edge Delivery Services (EDS) project. It's
run as an MCP server (stdio) spawned by an AI coding client (Claude Code,
Cursor) whose working directory is the target project — so `process.cwd()`
inside the server process is the project being scaffolded, not the
`pixel-guard` repo itself.

The `aem-visual-test-install` workflow currently has two steps:
`checkPrerequisitesStep` (Docker installed) and `checkProjectStructureStep`
(target project looks like an AEM EDS project). We're adding a third step
that copies the visual-test tooling into the target project once both checks
pass.

The source of these files lives in `aem-visual-checker/` at the root of the
`pixel-guard` repo:

- `tools/` — `sidekick/`, `visual-overlay/`, `visual-tests/` (Playwright +
  Docker based visual regression tooling)
- `.dockerignore`
- `.env.example`
- `changes.js` — reference snippets (package.json scripts/deps to merge,
  `.gitignore` lines to append) for a **future** step that modifies the
  target project's `package.json` and `.gitignore`. Out of scope here; not
  copied by this step.

## Requirements

- Copy, from `aem-visual-checker/` (relative to the `pixel-guard` package
  itself) into the target project root (`process.cwd()`):
  - `tools/` folder, recursively
  - `.dockerignore`
  - `.env.example`
- Exclude OS junk (`.DS_Store`) anywhere under `tools/` from the copy.
- Do not copy `changes.js` — it belongs to a later step.
- If the target already has any of these paths, overwrite them. For `tools/`
  specifically, this is a merge-overwrite: files that exist in both source
  and target are replaced, but files already in the target's `tools/` that
  aren't part of the source tree are left untouched (the target directory is
  not deleted/cleaned first).
- Only run the copy if both prior checks passed (`dockerInstalled` and
  `projectStructureValid`); otherwise skip without touching the filesystem
  and report why.
- Report a single pass/fail boolean plus a message, mirroring the shape of
  the existing two steps (`{ booleanFlag, message }`).

## Design

### Locating the source files

Because `process.cwd()` is the *target* project, not `pixel-guard`, the
source directory can't be found relative to cwd. It's resolved relative to
the workflow module's own file location instead:

```ts
import { fileURLToPath } from 'node:url';

const ASSETS_SOURCE_DIR = fileURLToPath(
  new URL('../../aem-visual-checker', import.meta.url),
);
```

(`src/workflows/aem-visual-test-install.ts` → up to `src/` → up to the repo
root → into `aem-visual-checker/`.) This works regardless of the directory
the MCP server process is launched from.

### Pure helper: `copyRequiredFiles`

```ts
export async function copyRequiredFiles(sourceDir: string, targetDir: string): Promise<void>
```

Copies, from `sourceDir` into `targetDir`:

- `tools/` (recursive), via `fs.cp` with `recursive: true, force: true`, and
  a `filter` that excludes any path whose basename is `.DS_Store`
- `.dockerignore` (single file copy, overwrite)
- `.env.example` (single file copy, overwrite)

Unit-testable in isolation against temp directories, independent of Mastra
and independent of the real `aem-visual-checker/` source tree.

### New step: `copyRequiredFilesStep`

Added to `src/workflows/aem-visual-test-install.ts`:

- `id`: `copy-required-files`
- `inputSchema`: `checkProjectStructureStep.outputSchema` (unused in
  `execute`, matching the existing convention of `checkProjectStructureStep`
  — required so `.then()` type-checks against the preceding step)
- `outputSchema`: `z.object({ filesCopied: z.boolean(), message: z.string() })`
- `execute`: uses the `getStepResult` helper provided by Mastra's
  `ExecuteFunctionParams` to read `checkPrerequisitesStep` and
  `checkProjectStructureStep`'s results directly (rather than threading them
  through `inputSchema`, since `inputSchema` here just satisfies the type
  chain and doesn't carry the needed booleans from two steps back):
  - If `dockerInstalled` is `false` or `projectStructureValid` is `false`:
    return `{ filesCopied: false, message: 'Skipped copying required files because prerequisites were not met.' }`
    without calling `copyRequiredFiles`.
  - Otherwise call `copyRequiredFiles(ASSETS_SOURCE_DIR, process.cwd())` and
    return `{ filesCopied: true, message: 'Copied tools/, .dockerignore, and .env.example to the project.' }`.
  - Filesystem errors from `copyRequiredFiles` are allowed to propagate
    (fail the step) rather than being caught — there's no expected recoverable
    failure mode here beyond the gating already handled above.

### Workflow wiring

```ts
export const aemVisualTestInstallWorkflow = createWorkflow({
  id: 'aem-visual-test-install',
  description: '...',
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

## Out of scope

- Modifying the target project's `package.json` (scripts/deps) or
  `.gitignore` — the `changes.js` reference snippets are for that future
  step.
- Any copy strategy other than overwrite (e.g. skip-existing, conflict
  detection/backup).
- Validating the contents of `tools/`, `.dockerignore`, or `.env.example`
  after copying — existence of the copy operation succeeding is sufficient.

## Testing

- Unit tests for `copyRequiredFiles` against temp source/target directories:
  - All expected files/folders present in the target after copying.
  - `.DS_Store` under `tools/` in the source is not copied.
  - A pre-existing file at the target path is overwritten.
- Manual verification of `copyRequiredFilesStep`'s gating (skipped when
  Docker missing or project structure invalid) and of the full workflow run
  end-to-end against a scratch target directory.
