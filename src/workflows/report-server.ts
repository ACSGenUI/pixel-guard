import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const MIME_TYPES: Record<string, string> = {
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

// Reused across calls so repeated visual-test runs don't accumulate one static
// server per invocation; the same server just serves whatever is currently on disk.
let activeServer: { server: Server; reportDir: string; url: string } | null = null;

export async function serveReport(reportDir: string): Promise<{ url: string } | null> {
  try {
    await stat(join(reportDir, 'index.html'));
  } catch {
    return null;
  }

  if (activeServer && activeServer.reportDir === reportDir) {
    return { url: activeServer.url };
  }

  if (activeServer) {
    activeServer.server.close();
    activeServer = null;
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

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://localhost:${port}/`;
  activeServer = { server, reportDir, url };
  return { url };
}
