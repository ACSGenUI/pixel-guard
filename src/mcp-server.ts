import { MCPServer } from '@mastra/mcp';
import { aemVisualTestInstallTool } from './tools/aem-visual-test-install-tool.js';
import { diagnoseVisualTestsTool } from './tools/diagnose-visual-tests-tool.js';
import { generateVisualTestsTool } from './tools/generate-visual-tests-tool.js';
import { runVisualTestsAndFixTool } from './tools/run-visual-tests-and-fix-tool.js';
import { runVisualTestsTool } from './tools/run-visual-tests-tool.js';
import { updateVisualSnapshotsTool } from './tools/update-visual-snapshots-tool.js';

export const mcpServer = new MCPServer({
  name: 'pixel-guard',
  version: '1.0.0',
  tools: {
    aemVisualTestInstall: aemVisualTestInstallTool,
    generateVisualTests: generateVisualTestsTool,
    runVisualTests: runVisualTestsTool,
    updateVisualSnapshots: updateVisualSnapshotsTool,
    diagnoseVisualTests: diagnoseVisualTestsTool,
    runVisualTestsAndFix: runVisualTestsAndFixTool,
  },
});
