import { MCPServer } from '@mastra/mcp';
import { echoTool } from './tools/echo-tool.js';
import { aemVisualTestInstallWorkflow } from './workflows/aem-visual-test-install.js';
import { generateVisualTestsWorkflow } from './workflows/generate-visual-tests.js';

const server = new MCPServer({
  name: 'pixel-guard',
  version: '1.0.0',
  tools: { echo: echoTool },
  workflows: {
    aemVisualTestInstall: aemVisualTestInstallWorkflow,
    generateVisualTests: generateVisualTestsWorkflow,
  },
});

await server.startStdio();
