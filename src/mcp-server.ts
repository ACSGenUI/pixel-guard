import { MCPServer } from '@mastra/mcp';
import { aemVisualTestInstallTool } from './tools/aem-visual-test-install-tool.js';
import { generateVisualTestsTool } from './tools/generate-visual-tests-tool.js';
import { installVisualTestAutomationTool } from './tools/install-visual-test-automation-tool.js';
import { runVisualTestsTool } from './tools/run-visual-tests-tool.js';
import { updateVisualSnapshotsTool } from './tools/update-visual-snapshots-tool.js';
import { installPageDiffTool } from './tools/install-page-diff-tool.js';
import { comparePageDiffTool } from './tools/compare-page-diff-tool.js';
import { localizePageDiffTool } from './tools/localize-page-diff-tool.js';
import { captureLiveBlockTool } from './tools/capture-live-block-tool.js';
import { compareBlockTool } from './tools/compare-block-tool.js';

// Surfaced to the connecting client via the MCP protocol handshake itself (MCPServerConfig's
// `instructions` field), not a file in this repo -- this server is typically connected from
// within a DIFFERENT project (the target AEM project being tested), so AGENTS.md here would
// never be discovered by an agent working there. This is the guidance that actually reaches
// it, regardless of which project it's running in.
const INSTRUCTIONS = `pixel-guard bundles two independent capabilities for AEM Edge Delivery Services (EDS) projects, each with its own installer -- installing one does not require or affect the other.

BLOCK TESTING: renders every block variation from the target project's Sidekick Library at multiple viewports, screenshots them, and compares against committed baselines to catch unintended visual changes.
1. aemVisualTestInstall -- once, to set up the environment in the target project. If it succeeds, its response asks you to check with the user about setting up a GitHub Actions workflow and/or a Husky pre-commit hook; if they want either, call installVisualTestAutomation to actually set it up (don't hand-write those files yourself -- that tool installs the real, tested templates).
2. generateVisualTests -- whenever blocks/variations are added or changed in the Sidekick Library.
3. runVisualTests -- to check for regressions. The response lists every block/viewport test's pass/fail, not just an aggregate result. Use the "mode" input to control what happens beyond that on failure: "quick" (default) is just the pass/fail breakdown, "diagnose" also includes each failure's error message and its Playwright screenshot-diff image file path, "interactive" includes the same plus a reminder to confirm with the user before attempting a fix.
4. updateVisualSnapshots -- only when a visual change is intentional, to accept it as the new baseline.

PAGE-DIFF: given a mapping of live URLs to their migrated counterparts, screenshots and pixel-diffs both sides and can localize each visual difference to the migrated page's DOM element(s).
1. installPageDiff -- once, to set up the page-diff environment in the target project (copies tools/page-diff/, adds its npm scripts/dependencies, runs npm install). Independent of aemVisualTestInstall -- do not run that instead, and do not assume it's needed first.
2. comparePageDiff -- given a CSV/JSON mapping file of { liveUrl, migratedUrl } pairs, screenshots and pixel-diffs both sides at every configured viewport, reporting which page regions differ with cropped before/after/diff images and a browsable HTML report.
3. localizePageDiff -- after comparePageDiff finds failing regions, finds the migrated page's overlapping DOM element(s) for each region and reports their selector, computed style, and outerHTML, so a fix can be reasoned about precisely instead of guessed from a diff image alone.
4. captureLiveBlock -- for a block the roll-up flagged as broken, locate it on the LIVE site by content-anchor matching and save its rendering as a durable per-block baseline (tools/page-diff/baselines/). On low confidence it returns candidates; re-run with an explicit liveSelector to override.
5. compareBlock -- re-screenshot just that migrated block and diff it against the saved live baseline, per viewport. Fast and offline. After each fix to the block's CSS/markup, re-run compareBlock until every viewport passes, then move to the next broken block.

After comparePageDiff runs, review the page-diff report (full-page comparison, then block roll-up, then per-region detail) and give the user a complete summary: where the differences come from, the major fixes, and the quick fixes. Then fix broken blocks worst-first using captureLiveBlock -> compareBlock for each one -- do NOT take your own screenshots of the live or migrated pages, since those tools already capture, locate, and diff each block. (captureLiveBlock and compareBlock ship inside tools/page-diff/, so re-run installPageDiff in the target project after upgrading pixel-guard to make them available.)

Every runVisualTests and updateVisualSnapshots response includes a "Playwright report" line -- a URL to a local server hosting the full HTML report. Every comparePageDiff and localizePageDiff response includes a "page-diff report" line the same way. Surface these links to the user so they can open them in a browser.

Every tool accepts an optional projectDir (absolute path to the target AEM project). It resolves automatically via CLAUDE_PROJECT_DIR when Claude Code is running from within that project; only pass it explicitly when calling from a host with no such notion (e.g. Mastra Studio).

comparePageDiff supports an ignore mechanism for expected differences: a tools/page-diff/ignore.json file (user-authored, not installed automatically) listing rules that suppress specific regions -- by CSS selector on the migrated page, an explicit pixel region, or both -- scoped to a pairSlug or urlPattern and optionally a single viewport. Ignored regions still show up in the report (marked ignored) but don't count toward pass/fail.`;

export const mcpServer = new MCPServer({
  name: 'pixel-guard',
  version: '1.0.0',
  instructions: INSTRUCTIONS,
  tools: {
    aemVisualTestInstall: aemVisualTestInstallTool,
    generateVisualTests: generateVisualTestsTool,
    runVisualTests: runVisualTestsTool,
    updateVisualSnapshots: updateVisualSnapshotsTool,
    installVisualTestAutomation: installVisualTestAutomationTool,
    installPageDiff: installPageDiffTool,
    comparePageDiff: comparePageDiffTool,
    localizePageDiff: localizePageDiffTool,
    captureLiveBlock: captureLiveBlockTool,
    compareBlock: compareBlockTool,
  },
});
