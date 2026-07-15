# Design: Project Structure Check Step

## Context

`pixel-guard` is a Mastra MCP server that scaffolds/installs the AEM Visual Test
environment into a target AEM Edge Delivery Services (EDS) project. It's run as
an MCP server (stdio) spawned by an AI coding client (Claude Code, Cursor)
whose working directory is the target project — so `process.cwd()` inside the
server process is the project being scaffolded.

The `aem-visual-test-install` workflow currently has one step,
`checkPrerequisitesStep`, which checks that Docker is installed. We're adding a
second step that checks the target project actually looks like an AEM EDS
project before the install/scaffold logic proceeds.

## Requirements

- Check, relative to `process.cwd()`, that the following exist (standard AEM
  EDS boilerplate layout):
  - `blocks/` folder
  - `scripts/aem.js` file
  - `package.json` file
  - `head.html` file
- Report a single pass/fail boolean plus a message, mirroring the shape of
  `checkPrerequisitesStep` (`{ booleanFlag, message }`).
- On failure, the message names exactly which of the four items are missing.
- This check must always run, regardless of whether the Docker check passed or
  failed, so a single workflow run surfaces every prerequisite problem at once
  rather than requiring multiple round trips.
- No new workflow input is needed — `process.cwd()` is sufficient, matching
  the existing no-input convention of `checkPrerequisitesStep`.

## Design

### New step: `checkProjectStructureStep`

Added to `src/workflows/aem-visual-test-install.ts`:

- `id`: `check-project-structure`
- `inputSchema`: `z.object({})`
- `outputSchema`: `z.object({ projectStructureValid: z.boolean(), message: z.string() })`
- `execute`: checks existence (via `fs.access`, from `node:fs/promises`) of the
  four required paths under `process.cwd()`. Existence-only checks are
  sufficient — this is a lightweight sanity check, not a strict validator, so
  we don't distinguish file vs. directory type.
  - All four present → `{ projectStructureValid: true, message: 'Project structure is valid.' }`
  - Any missing → `{ projectStructureValid: false, message: 'Missing required project files: <comma-separated list of missing item labels>.' }`

### Workflow wiring

`checkPrerequisitesStep` and `checkProjectStructureStep` are independent of
each other's output, so they chain via `.then()` and their results are merged
into a single final shape via `.map()`, rather than the workflow's output
being defined solely by the last step (the existing single-step pattern):

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

Both checks always execute (no short-circuiting), and the final workflow
output reports both results independently.

## Out of scope

- Verifying that `blocks/`, `scripts/aem.js`, etc. contain valid/expected
  content — existence only.
- Any actual scaffold/install logic (copying/modifying files) — that remains
  a future step in this workflow, not part of this change.
- Accepting an explicit project path input — deferred until there's a
  concrete need to run this against a project other than `process.cwd()`.

## Testing

Manual verification: run the workflow (or its `checkProjectStructureStep` in
isolation) against a directory with a full EDS structure (expect valid) and
against one missing one or more items (expect the missing items named in the
message).
