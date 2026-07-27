# AGENTS.md

This file helps AI agents (Claude Code and other MCP-compatible agents) understand pixel-guard's MCP tools: what each one does, when to call it, and what input it expects.

> **Note:** pixel-guard is normally connected as an MCP server from within a *different* project (the target AEM project being tested), so this file won't be discovered there. The condensed version of this guidance is also sent to any connecting client via the MCP `instructions` field (`src/mcp-server.ts`) — that's what actually reaches an agent working in the target project. Keep the two in sync when either changes.

## What this MCP server is for

pixel-guard installs and drives a Playwright-based visual regression test suite for AEM Edge Delivery Services (EDS) projects. It renders every block variation from the project's Sidekick Library at multiple viewports, screenshots them, and compares against committed baselines to catch unintended visual changes.

## `projectDir` resolution

Every tool accepts an optional `projectDir` (absolute path to the target AEM project). If omitted, it resolves in this order:

1. The `projectDir` argument, if given.
2. `CLAUDE_PROJECT_DIR` — set automatically by Claude Code, no action needed when Claude Code is running from within the target project.
3. The server process's own working directory.

Only pass `projectDir` explicitly when calling from a host that doesn't set `CLAUDE_PROJECT_DIR` (e.g. Mastra Studio).

## Typical order of operations

1. `aemVisualTestInstall` — once, to set up the environment. If it succeeds, ask the user about CI/hook setup (see below) and call `installVisualTestAutomation` if they want either.
2. `generateVisualTests` — whenever blocks/variations are added or changed in the Sidekick Library.
3. `runVisualTests` — to check for regressions. Pick `mode` based on what the user asked for (see below).
4. `updateVisualSnapshots` — only when a visual change is intentional, to accept it as the new baseline.

## A note on interactivity

None of these tools use MCP elicitation (mid-tool-call interactive prompts) to ask yes/no questions. That was tried and dropped: calls to it silently failed through Claude Code with no visible error, and — because the tool's own description said it *would* ask — the agent would try to compensate by asking the question itself and then hand-writing its own (worse, template-less, un-tested) version of whatever the tool was supposed to install. Wherever a decision is needed, the tool's response instead tells you (the agent) to ask the user through your own normal means, then call a specific follow-up tool with an explicit input reflecting their answer — never improvise the underlying files yourself; the dedicated tool installs the real, tested templates.

## Tools

### `aemVisualTestInstall`

Installs/scaffolds the AEM Visual Test environment in the target project: checks prerequisites, copies required files, updates project config, installs dependencies, and generates visual tests.

If (and only if) that all succeeds, the response tells you to ask the user whether they also want:
- a **GitHub Actions workflow** (`.github/workflows/visual-tests.yaml`) that runs the visual tests on pull requests and posts results as a PR comment, and/or
- a **Husky pre-commit hook** (`.husky/pre-commit`) that runs the visual tests before each commit.

If they want either, call `installVisualTestAutomation` (below) with the corresponding flag(s) set — don't hand-write these files yourself.

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

Runs the Playwright visual tests — the full suite, or a single block when `blockName` is given. Whenever a per-test breakdown is available, the response lists **every** block/viewport test with ✅/❌ (not just an aggregate pass/fail), so you can see what passed as well as what failed — this shows up automatically, in every mode, whenever the run produces one.

The `mode` input controls what happens beyond that if the tests fail:

- `quick` (default) — just the pass/fail summary (plus the per-test breakdown, if available).
- `diagnose` — for each failing test, also includes its clean error message and the file path to its Playwright screenshot-diff image (`*-diff.png`). Paths are given, not embedded image data — read a specific path with your own file-reading tool if you need to look at one; embedding every diff image inline routinely exceeded the response size/token limit on any run with more than a couple of failures.
- `interactive` — same as `diagnose`, plus an explicit line telling you to confirm with the user before attempting a fix based on the error output.

The per-test breakdown and diff-image paths require the target project's `tools/visual-tests/playwright.config.ts` to have Playwright's JSON reporter configured (added by `aemVisualTestInstall`). Projects installed before this was added won't have it — re-run `aemVisualTestInstall` to pick it up (it force-overwrites `tools/`). Until then, `runVisualTests` falls back to a coarser aggregate pass/fail plus raw command output.

**Input:** `blockName?` (string), `projectDir?` (string), `mode?` (`"quick" | "diagnose" | "interactive"`, default `"quick"`)

**Example prompts:**
- "Run the visual tests." → `mode: "quick"`
- "Run visual tests for the Columns block." → `mode: "quick"`, `blockName: "Columns"`
- "Run the visual tests and show me why they're failing." → `mode: "diagnose"`
- "Diagnose the failing visual test for the Columns block." → `mode: "diagnose"`, `blockName: "Columns"`
- "Run the visual tests and fix any issues." → `mode: "interactive"`
- "Test and fix the visual regressions." → `mode: "interactive"`

### `updateVisualSnapshots`

Updates the visual snapshot baselines — the full suite, or a single block when `blockName` is given. Use only when a visual change is intentional.

**Input:** `blockName?` (string), `projectDir?` (string)

**Example prompts:**
- "Update the visual snapshots, the Columns redesign is intentional."
- "Accept the new baseline for the Hero block."
- "Update all the visual baselines."

### `installVisualTestAutomation`

Sets up automatic visual-test runs in a project already installed via `aemVisualTestInstall`: a GitHub Actions workflow and/or a Husky pre-commit hook. Takes explicit flags rather than asking itself — ask the user first (e.g. after `aemVisualTestInstall` prompts you to), then call this with the corresponding flag(s) set to `true`.

**Input:** `githubWorkflow?` (boolean, default `false`), `huskyPreCommitHook?` (boolean, default `false`), `projectDir?` (string)

**Example prompts:**
- "Add the GitHub Actions workflow." → `githubWorkflow: true`
- "Set up the pre-commit hook too." → `huskyPreCommitHook: true`
- "Set up both CI and the pre-commit hook." → `githubWorkflow: true`, `huskyPreCommitHook: true`

### `installPageDiff`

Installs the page-diff environment in the target project: copies `tools/page-diff/`, merges its npm scripts and dependencies (`playwright`, `pixelmatch`, `pngjs`) into `package.json`, and runs `npm install`. Fully independent of `aemVisualTestInstall` -- does not require the block-testing suite to be installed, and vice versa. No Docker or dev server involved (unlike `aemVisualTestInstall`), since page-diff only screenshots already-reachable URLs.

**Input:** `projectDir?` (string)

**Example prompts:**
- "Set up page-diff for this project."
- "Install the URL comparison tool."

### `comparePageDiff`

Screenshots each `{liveUrl, migratedUrl}` pair from a mapping file at every configured viewport (mobile/tablet/desktop/large), pixel-diffs the two full-page screenshots, and clusters differences into regions. Produces cropped live/migrated/diff images per region and a browsable HTML report. Supports an ignore mechanism (`tools/page-diff/ignore.json`, user-authored) for known/expected differences, scoped by pair and/or viewport, matched by CSS selector or explicit pixel region. Requires `installPageDiff` to have been run first.

The response and the HTML report now lead with a **Blocks affected (ranked)** roll-up: failing regions are aggregated per block across all viewports and ranked by a coverage-first composite (share of the block's own area that differs, then how many viewports it breaks in, then total diff pixels), grouped Blocks → Landmarks → Sections. Use it to decide which block to fix first. It covers only blocks that appear in a failing region — it does not enumerate clean blocks or detect blocks that are missing entirely (that remains a judgment call from comparing the live and migrated pages).

**Input:** `mappingFile` (string, path to a CSV or JSON file of `{liveUrl, migratedUrl}` pairs), `projectDir?` (string)

**Example prompts:**
- "Compare the live and migrated homepage and show me what's different."
- "Run a page diff for the URLs in migration-urls.csv."

### `localizePageDiff`

For each failing region from a `comparePageDiff` run, navigates to the migrated page and finds the overlapping DOM element(s), attaching their selector, curated computed style (position, size, color, background, font, padding/margin, display, transform, opacity, z-index), and outerHTML — turning a blurry diff crop into "this `.hero > h1` lost its top padding." Only inspects the migrated page's DOM, since that's the page whose code can actually be fixed.

**Input:** `runId?` (string, an existing `comparePageDiff` run), `mappingFile?` (string, run a fresh comparison first if `runId` is omitted), `projectDir?` (string)

**Example prompts:**
- "Localize the diffs from that last comparison to the actual elements."
- "Run a fresh page diff on urls.csv and localize the results."

### `captureLiveBlock`

For a block the roll-up flagged as broken, locates that block on the **live** site — whose DOM doesn't match the migrated EDS structure — by **content-anchor matching**: it reads the migrated block's distinctive content (heading text, text snippets, image `src`/`alt`), searches the live DOM for the same content, and takes the bounding box enclosing the matches. It screenshots that live region per viewport and saves it as a durable per-block baseline under `tools/page-diff/baselines/<pairSlug>/`, plus a `manifest.json` entry (anchors, selector, box, confidence, source URL). Baselines are captured **once** and meant to be committed. When match confidence is below threshold (or no anchors match), the response says so and asks you to re-run with an explicit `liveSelector` — supply a CSS selector you pick from the live page and it screenshots that instead.

**Input:** `block` (string, `name` or `kind:name`, e.g. `hero-spotlight` / `landmark:nav`), `runId?` (string, an existing `comparePageDiff` run supplying the URL pair), `mappingFile?` (string, run a fresh comparison first if `runId` is omitted), `viewport?` (string, a single label; default all), `liveSelector?` (string, override for low-confidence matches), `projectDir?` (string)

**Example prompts:**
- "Capture the live baseline for the hero-spotlight block."
- "The auto-match was wrong — capture hero-spotlight from the live selector `.hero-banner`."

### `compareBlock`

Re-screenshots **only** the migrated block and pixel-diffs it against its saved live baseline, per viewport — a fast, offline check (it never touches the live site). Widths are normalized to the common width; a height difference is reported as a `heightDelta` (mirroring page-diff's page-length mismatch). Requires a baseline from `captureLiveBlock` (missing → it tells you to capture first). Serves a compact block-comparison report (baseline / migrated / diff per viewport).

**Input:** `block` (string, `name` or `kind:name`), `runId?` (string) or `mappingFile?` (string), `viewport?` (string, a single label; default all captured), `projectDir?` (string)

**Example prompts:**
- "Compare the hero-spotlight block against its live baseline."
- "Re-check hero-spotlight at Desktop after my CSS change."

### The block-fix loop

These two tools plus the `comparePageDiff` roll-up form an end-to-end migration-fix loop:

1. `comparePageDiff` → the **Blocks affected (ranked)** roll-up names the broken blocks worst-first.
2. Pick the top block; `captureLiveBlock` to save its live baseline (validate/override the match once).
3. `compareBlock` to see the current gap, fix the migrated block's CSS/markup, and re-run `compareBlock` until every viewport passes.
4. Move to the next broken block and repeat.

`captureLiveBlock` hits the live site once per block; the fix loop after that runs entirely against the migrated page.
