import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (match) {
            const value = match[2].replace(/^["']|["']$/g, "").trim();
            if (!process.env[match[1]])
                process.env[match[1]] = value;
        }
    }
}
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express from "express";
import { PAGE_COMPARE_REPORTS_DIR } from "./compare-pages.js";
import { PLAYWRIGHT_REPORT_DIR } from "./paths.js";
import { createServer, getLastReportStatus, getLastPageComparisonStatus } from "./server.js";
export async function startStreamableHTTPServer(createServerFn) {
    const port = parseInt(process.env.PORT ?? "3003", 10);
    const app = createMcpExpressApp({
        host: "0.0.0.0",
        allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
    });
    app.use(cors());
    if (!fs.existsSync(PAGE_COMPARE_REPORTS_DIR)) {
        fs.mkdirSync(PAGE_COMPARE_REPORTS_DIR, { recursive: true });
    }
    app.use("/page-comparison-reports", express.static(PAGE_COMPARE_REPORTS_DIR));
    if (fs.existsSync(PLAYWRIGHT_REPORT_DIR)) {
        app.use("/playwright-report", express.static(PLAYWRIGHT_REPORT_DIR));
        console.log(`Serving Playwright report from repo: ${PLAYWRIGHT_REPORT_DIR}`);
    }
    else {
        console.log(`Playwright report not found at ${PLAYWRIGHT_REPORT_DIR} (run visual tests in the repo first)`);
    }
    app.get("/api/last-report", (_req, res) => {
        const status = getLastReportStatus();
        res.setHeader("Cache-Control", "no-store");
        res.json({ url: status.url ?? null, running: status.running });
    });
    app.get("/api/last-page-comparison", (_req, res) => {
        const status = getLastPageComparisonStatus();
        res.setHeader("Cache-Control", "no-store");
        res.json({
            report: status.report ?? null,
            running: status.running,
        });
    });
    app.all("/mcp", async (req, res) => {
        const server = createServerFn();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        res.on("close", () => {
            transport.close().catch(() => { });
            server.close().catch(() => { });
        });
        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        }
        catch (error) {
            console.error("MCP error:", error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Internal server error" },
                    id: null,
                });
            }
        }
    });
    const baseUrl = `http://localhost:${port}/mcp`;
    const httpServer = app.listen(port, (err) => {
        if (err) {
            console.error("Failed to start server:", err);
            process.exit(1);
        }
        console.log(`Pixel Guard MCP server listening on ${baseUrl}`);
        console.log(`  → Use this URL in Cursor/Claude MCP config: ${baseUrl}`);
    });
    const shutdown = () => {
        console.log("\nShutting down...");
        httpServer.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
export async function startStdioServer(createServerFn) {
    await createServerFn().connect(new StdioServerTransport());
}
async function main() {
    if (process.argv.includes("--stdio")) {
        await startStdioServer(createServer);
    }
    else {
        await startStreamableHTTPServer(createServer);
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
