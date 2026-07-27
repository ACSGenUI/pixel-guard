# pixel-guard

An MCP server that installs and drives automated visual regression testing for AEM Edge Delivery Services (EDS) projects.

It scaffolds a Playwright-based visual test suite into a target AEM project, generates tests from the block variations defined in the project's Sidekick Library, runs them, and helps diagnose and fix failures — all through MCP tools an agent (e.g. Claude Code) can call directly.

Every block variation in the Sidekick Library is rendered at multiple viewports and screenshotted; each screenshot is compared against a committed baseline image to catch unintended visual regressions.

## Prerequisites

- Node.js
- Docker (the Playwright test runner executes inside a Docker container, matching CI exactly)

## Setup

```
npm install
```

## Running the server

pixel-guard runs as an MCP server. There are two ways to use it:

### As a stdio MCP server (Claude Code, Claude Desktop, etc.)

```
npm start          # or: npm run dev (restarts on file changes)
```

Connect it as an MCP server in your client, e.g. via Claude Code's `.mcp.json`:

```json
{
  "mcpServers": {
    "pixel-guard": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/pixel-guard/src/index.ts"]
    }
  }
}
```

Claude Code sets `CLAUDE_PROJECT_DIR` in the spawned server's environment, which pixel-guard uses to resolve the target AEM project automatically — no extra configuration needed when Claude Code is launched from within that project.

### Mastra Studio (call tools directly, no LLM agent needed)

```
npm run studio
```

Opens Studio at `http://localhost:4111`. Go to **MCP Servers → pixelGuard → Tools** to call any tool directly with a form — no API key required. Since Studio has no notion of "the current project," pass `projectDir` explicitly in the tool's input.

## Tools

| Tool | What it does | Example prompt |
|---|---|---|
| `aemVisualTestInstall` | Installs/scaffolds the visual-test environment in the target project. If that succeeds, its response tells the agent to ask the user about a GitHub Actions workflow and/or a Husky pre-commit hook, and to call `installVisualTestAutomation` if they want either | "Set up visual regression testing for this AEM project." |
| `generateVisualTests` | Regenerates Playwright specs from the Sidekick Library's current blocks | "I added a new block variation, regenerate the visual tests." |
| `runVisualTests` | Runs the visual tests (all, or a single block) and lists every block/viewport test that passed or failed. `mode` controls what happens beyond that on failure: `quick` (default) just the pass/fail breakdown, `diagnose` adds each failure's error message and diff-image file path, `interactive` adds the same plus a reminder to confirm with the user before attempting a fix | "Run the visual tests and fix any issues." |
| `updateVisualSnapshots` | Updates the baseline screenshots (all, or a single block) | "Update the visual snapshots, the Columns redesign is intentional." |
| `installVisualTestAutomation` | Sets up a GitHub Actions workflow and/or a Husky pre-commit hook in an already-installed project, based on explicit `githubWorkflow`/`huskyPreCommitHook` flags | "Add the GitHub Actions workflow and the pre-commit hook." |
| `installPageDiff` | Installs the page-diff environment in the target project (copies `tools/page-diff/`, adds its npm scripts/dependencies, runs `npm install`) -- independent of `aemVisualTestInstall` | "Set up page-diff for this project." |
| `comparePageDiff` | Screenshots each live/migrated URL pair (from a CSV/JSON mapping file) at every configured viewport, pixel-diffs them, and reports which page regions differ, with cropped before/after/diff images and a browsable HTML report; leads with a ranked per-block impact roll-up (coverage-first) so you can see which block to fix first | "Compare the live and migrated homepage and show me what's different." |
| `localizePageDiff` | For each failing region from a `comparePageDiff` run, finds the overlapping migrated-page DOM element(s) and reports their selector, computed style, and outerHTML | "Localize the diffs from that last comparison to the actual elements." |
| `captureLiveBlock` | Locates a broken block on the live site (content-anchor matching, with a `liveSelector` override) and saves its rendering as a durable per-block baseline | "Capture the live baseline for the hero-spotlight block." |
| `compareBlock` | Re-diffs one migrated block against its saved live baseline, per viewport, for a fast offline fix loop | "Compare the hero-spotlight block against its live baseline." |

See [AGENTS.md](./AGENTS.md) for the full input schema and more example prompts per tool.

> **Pre-screenshot hook:** drop an optional `tools/page-diff/prepare.js` in the target project to clean up each page before it's captured — remove cookie-consent banners, ads, or chat widgets, or perform actions (click/scroll/wait). It exports `async (page, ctx) => {}` (`ctx = { side, url, pairSlug, viewport }`, `side` is `'live'`/`'migrated'`) and runs across all page-diff tools. See [AGENTS.md](./AGENTS.md) for an example.

> **Note:** the per-block pass/fail breakdown and diff-image paths in `runVisualTests` need Playwright's JSON reporter, which `aemVisualTestInstall` configures in the target project. If you installed pixel-guard into a project before this was added, re-run `aemVisualTestInstall` to pick it up.

> **Note:** these tools deliberately don't use MCP elicitation (mid-tool-call interactive prompts) to ask yes/no questions — in practice, calls to it were silently failing through Claude Code, and the agent would improvise its own (worse, template-less) version of the feature instead of noticing anything had gone wrong. Anywhere a decision is needed, the tool's response instead tells the agent to ask the user through its own normal means, then call a follow-up tool with an explicit input reflecting the answer.

## Development

```
npm test           # run unit tests
npx tsc --noEmit   # type-check
```
