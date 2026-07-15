import { MCPServer } from '@mastra/mcp';
import { echoTool } from './tools/echo-tool.js';
import { playwrightReportAppResources } from './tools/playwright-report-app.js';
import { runVisualTestsTool } from './tools/run-visual-tests-tool.js';
import { updateVisualSnapshotsTool } from './tools/update-visual-snapshots-tool.js';
import { aemVisualTestInstallWorkflow } from './workflows/aem-visual-test-install.js';
import { generateVisualTestsWorkflow } from './workflows/generate-visual-tests.js';

const server = new MCPServer({
  name: 'pixel-guard',
  version: '1.0.0',
  tools: {
    echo: echoTool,
    runVisualTests: runVisualTestsTool,
    updateVisualSnapshots: updateVisualSnapshotsTool,
  },
  workflows: {
    aemVisualTestInstall: aemVisualTestInstallWorkflow,
    generateVisualTests: generateVisualTestsWorkflow,
  },
  appResources: playwrightReportAppResources,
});

await server.startStdio();
