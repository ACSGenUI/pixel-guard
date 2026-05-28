import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function startStreamableHTTPServer(createServerFn: () => McpServer): Promise<void>;
export declare function startStdioServer(createServerFn: () => McpServer): Promise<void>;
