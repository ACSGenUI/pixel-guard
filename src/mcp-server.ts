import { MCPServer } from '@mastra/mcp';
import { aemVisualTestInstallTool } from './tools/aem-visual-test-install-tool.js';
import { generateVisualTestsTool } from './tools/generate-visual-tests-tool.js';
import { installVisualTestAutomationTool } from './tools/install-visual-test-automation-tool.js';
import { runVisualTestsTool } from './tools/run-visual-tests-tool.js';
import { updateVisualSnapshotsTool } from './tools/update-visual-snapshots-tool.js';

// Surfaced to the connecting client via the MCP protocol handshake itself (MCPServerConfig's
// `instructions` field), not a file in this repo -- this server is typically connected from
// within a DIFFERENT project (the target AEM project being tested), so AGENTS.md here would
// never be discovered by an agent working there. This is the guidance that actually reaches
// it, regardless of which project it's running in.
const INSTRUCTIONS = `pixel-guard installs and drives a Playwright-based visual regression test suite for AEM Edge Delivery Services (EDS) projects. It renders every block variation from the target project's Sidekick Library at multiple viewports, screenshots them, and compares against committed baselines to catch unintended visual changes.

Typical order of operations:
1. aemVisualTestInstall -- once, to set up the environment in the target project. If it succeeds, its response asks you to check with the user about setting up a GitHub Actions workflow and/or a Husky pre-commit hook; if they want either, call installVisualTestAutomation to actually set it up (don't hand-write those files yourself -- that tool installs the real, tested templates).
2. generateVisualTests -- whenever blocks/variations are added or changed in the Sidekick Library.
3. runVisualTests -- to check for regressions. The response lists every block/viewport test's pass/fail, not just an aggregate result. Use the "mode" input to control what happens beyond that on failure: "quick" (default) is just the pass/fail breakdown, "diagnose" also includes each failure's error message and its Playwright screenshot-diff image file path (read that path with your own file-reading tool if you need to look at it -- it is not embedded in the response), "interactive" includes the same plus a reminder to confirm with the user before attempting a fix.
4. updateVisualSnapshots -- only when a visual change is intentional, to accept it as the new baseline.

Every runVisualTests and updateVisualSnapshots response includes a "Playwright report" line -- a URL to a local server hosting the full HTML report. Surface this link to the user so they can open it in a browser.

Every tool accepts an optional projectDir (absolute path to the target AEM project). It resolves automatically via CLAUDE_PROJECT_DIR when Claude Code is running from within that project; only pass it explicitly when calling from a host with no such notion (e.g. Mastra Studio).`;

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
  },
});
