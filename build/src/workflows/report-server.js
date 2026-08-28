import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.zip': 'application/zip',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
    '.map': 'application/json; charset=utf-8',
};
// Reused across calls so repeated visual-test runs don't accumulate one static server per
// invocation. Stored on globalThis rather than a module-level binding: some hosts (e.g.
// mastra dev) re-evaluate this module per tool call, which would otherwise reset a plain
// `let` back to null on every call, losing the reference to the previous server and
// leaking a listening socket (and, under watch-mode process restarts, a stray process)
// every single run instead of ever reusing or closing it.
const GLOBAL_KEY = Symbol.for('pixel-guard.report-server');
const globalState = globalThis;
function getActiveServer() {
    return globalState[GLOBAL_KEY] ?? null;
}
function setActiveServer(value) {
    globalState[GLOBAL_KEY] = value;
}
// Registered exactly once per process (guarded via globalThis, for the same reload-safety
// reason as above) as a last-resort cleanup: if the process is exiting anyway, make sure
// the listening socket doesn't outlive it.
const EXIT_HANDLER_KEY = Symbol.for('pixel-guard.report-server.exit-handler-registered');
const globalExitFlag = globalThis;
if (!globalExitFlag[EXIT_HANDLER_KEY]) {
    globalExitFlag[EXIT_HANDLER_KEY] = true;
    process.on('exit', () => {
        getActiveServer()?.server.close();
    });
}
export async function serveReport(reportDir) {
    try {
        await stat(join(reportDir, 'index.html'));
    }
    catch {
        return null;
    }
    const activeServer = getActiveServer();
    if (activeServer && activeServer.reportDir === reportDir) {
        return { url: activeServer.url };
    }
    if (activeServer) {
        activeServer.server.close();
        setActiveServer(null);
    }
    const server = createServer((req, res) => {
        const requestPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
        const relativePath = requestPath === '/' ? '/index.html' : requestPath;
        const filePath = normalize(join(reportDir, relativePath));
        if (!filePath.startsWith(normalize(reportDir))) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        readFile(filePath)
            .then((data) => {
            res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream' });
            res.end(data);
        })
            .catch(() => {
            res.writeHead(404);
            res.end('Not found');
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    server.unref();
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const url = `http://localhost:${port}/`;
    setActiveServer({ server, reportDir, url });
    return { url };
}
// Playwright writes its HTML report on every run, whether tests pass or fail; serve it
// locally so the report is always reachable, and surface the link clearly in plain-text
// responses -- the primary channel most MCP clients (e.g. Claude Code) actually render.
export async function getReportUrl(targetDir) {
    const reportDir = join(targetDir, 'tools', 'visual-tests', 'playwright-report');
    const report = await serveReport(reportDir);
    return report?.url ?? null;
}
