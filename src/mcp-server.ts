import { MCPServer } from '@mastra/mcp';
import { aemVisualTestInstallTool } from './tools/aem-visual-test-install-tool.js';
import { echoTool } from './tools/echo-tool.js';
import { generateVisualTestsTool } from './tools/generate-visual-tests-tool.js';
import { runVisualTestsTool } from './tools/run-visual-tests-tool.js';
import { updateVisualSnapshotsTool } from './tools/update-visual-snapshots-tool.js';

export const mcpServer = new MCPServer({
  name: 'pixel-guard',
  version: '1.0.0',
  tools: {
    echo: echoTool,
    aemVisualTestInstall: aemVisualTestInstallTool,
    generateVisualTests: generateVisualTestsTool,
    runVisualTests: runVisualTestsTool,
    updateVisualSnapshots: updateVisualSnapshotsTool,
  },
});
