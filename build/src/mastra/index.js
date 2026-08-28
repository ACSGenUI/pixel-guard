import { Mastra } from '@mastra/core/mastra';
import { mcpServer } from '../mcp-server.js';
// Lets `mastra dev` discover this server so its Tools tab can call any of
// pixel-guard's tools directly, no LLM agent or API key needed.
export const mastra = new Mastra({
    mcpServers: { pixelGuard: mcpServer },
});
