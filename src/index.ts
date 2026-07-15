import { MCPServer } from '@mastra/mcp';
import { echoTool } from './tools/echo-tool.js';
import { aemVisualTestInstallWorkflow } from './workflows/aem-visual-test-install.js';

const server = new MCPServer({
  name: 'pixel-guard',
  version: '1.0.0',
  tools: { echo: echoTool },
  workflows: { aemVisualTestInstall: aemVisualTestInstallWorkflow },
});

await server.startStdio();
