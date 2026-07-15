# AGENTS.md

This file helps AI agents (Claude Code and other MCP-compatible agents) understand pixel-guard's MCP tools: what each one does, when to call it, and what input it expects.

## What this MCP server is for

pixel-guard installs and drives a Playwright-based visual regression test suite for AEM Edge Delivery Services (EDS) projects. It renders every block variation from the project's Sidekick Library at multiple viewports, screenshots them, and compares against committed baselines to catch unintended visual changes.

## `projectDir` resolution

Every tool accepts an optional `projectDir` (absolute path to the target AEM project). If omitted, it resolves in this order:

1. The `projectDir` argument, if given.
2. `CLAUDE_PROJECT_DIR` — set automatically by Claude Code, no action needed when Claude Code is running from within the target project.
3. The server process's own working directory.

Only pass `projectDir` explicitly when calling from a host that doesn't set `CLAUDE_PROJECT_DIR` (e.g. Mastra Studio).

## Typical order of operations

1. `aemVisualTestInstall` — once, to set up the environment.
2. `generateVisualTests` — whenever blocks/variations are added or changed in the Sidekick Library.
3. `runVisualTests` / `runVisualTestsAndFix` — to check for regressions.
4. `updateVisualSnapshots` — only when a visual change is intentional, to accept it as the new baseline.
5. `diagnoseVisualTests` — when a failure needs a closer look.

## Tools

### `aemVisualTestInstall`

Installs/scaffolds the AEM Visual Test environment in the target project: checks prerequisites, copies required files, updates project config, installs dependencies, and generates visual tests.

**Input:** `projectDir?` (string)

**Example prompts:**
- "Set up visual regression testing for this AEM project."
- "Install pixel-guard here."
- "Scaffold the visual test environment."

### `generateVisualTests`

Regenerates Playwright visual tests from the current Sidekick Library blocks. Assumes the environment was already installed via `aemVisualTestInstall`.

**Input:** `projectDir?` (string)

**Example prompts:**
- "I added a new block variation, regenerate the visual tests."
- "Regenerate the Playwright tests from the sidekick library."

### `runVisualTests`

Runs the Playwright visual tests — the full suite, or a single block when `blockName` is given.

**Input:** `blockName?` (string), `projectDir?` (string)

**Example prompts:**
- "Run the visual tests."
- "Run visual tests for the Columns block."
- "Check if the Hero block still renders correctly."

### `updateVisualSnapshots`

Updates the visual snapshot baselines — the full suite, or a single block when `blockName` is given. Use only when a visual change is intentional.

**Input:** `blockName?` (string), `projectDir?` (string)

**Example prompts:**
- "Update the visual snapshots, the Columns redesign is intentional."
- "Accept the new baseline for the Hero block."
- "Update all the visual baselines."

### `diagnoseVisualTests`

Runs the visual tests and, if they fail, returns the raw test output (assertion diffs, stack traces) so the failure can be diagnosed and fixed.

**Input:** `blockName?` (string), `projectDir?` (string)

**Example prompts:**
- "Run the visual tests and show me why they're failing."
- "Diagnose the failing visual test for the Columns block."

### `runVisualTestsAndFix`

Runs the visual tests. If they fail, asks (via MCP elicitation) whether to reveal the detailed error output, then asks again whether a fix should be attempted for the underlying issue. If approved, the tool's response instructs the agent to analyze the error output and fix it.

**Input:** `blockName?` (string), `projectDir?` (string)

**Example prompts:**
- "Run the visual tests and fix any issues."
- "Test and fix the visual regressions."
- "Run the tests — if something's broken, help me fix it."

### `echo`

Echoes back the provided message. Mainly useful for verifying the MCP connection is working.

**Input:** `message` (string)

**Example prompts:**
- "Ping pixel-guard."
- "Check the MCP connection to pixel-guard."
