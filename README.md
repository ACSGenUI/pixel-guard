# Pixel Guard

Pixel Guard is an MCP app for UI visual validation. It compares source and destination pages with Playwright, writes report artifacts under your project workspace, and opens an interactive diff view in the MCP host.

## Quick start (remote — recommended)

Add this to your MCP config. **No clone, no manual server, no `--stdio` flag.**

```json
{
  "mcpServers": {
    "pixel-guard-remote": {
      "command": "npx",
      "args": ["-y", "https://github.com/ACSGenUI/pixel-guard#site-compare"],
      "env": {
        "PROJECT_ROOT": "/absolute/path/to/your-repo"
      }
    }
  }
}
```

The editor launches Pixel Guard via `npx` in stdio mode. Reports are written to:

```
PROJECT_ROOT/page-compare-<timestamp>/
  manifest.json
  source.png
  destination.png
  diff.png
```

You do **not** need to run `node output/main.js --http` or clone the repo for this setup.

---

## Requirements

- Node.js 20+ (Node 22 recommended)
- npm
- Chromium (installed automatically by Playwright on first comparison, or via `npm run playwright:install` for local dev)

## Local development installation

Only needed if you work on Pixel Guard itself or use **local** stdio/HTTP configs — **not** required for remote `npx` above.

```bash
cd <<pixel-guard-source-directory>>
npm install
npm run playwright:install
npm run build
```

`npm run build` compiles the server to `output/` (including `output/main.js`, the MCP entrypoint).

Optional — verify the HTTP server locally:

```bash
PROJECT_ROOT=<<PROJECT_ROOT>> npm start
# → Pixel Guard MCP server listening on http://localhost:3003/mcp
```

## Entrypoint

The npm bin is `output/main.js`:

```json
"bin": { "pixel-guard": "output/main.js" }
```

| Invocation | Mode |
|------------|------|
| `npx -y https://github.com/ACSGenUI/pixel-guard#site-compare` | **stdio** (remote MCP — default) |
| `node output/main.js` | **stdio** (local MCP — default) |
| `node output/main.js --http` | **HTTP** server on port 3003 (optional) |

Do **not** use `output/server.js` as the entrypoint — it exports the MCP server factory but does not start transport.

---

## MCP configuration

Replace placeholders:

| Placeholder | Meaning |
|-------------|---------|
| `<<pixel-guard-source-directory>>` | Absolute path to `mcp-apps/pixel-guard` (local dev only) |
| `<<PROJECT_ROOT>>` | Absolute path to the repo/workspace where reports are written |

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `PROJECT_ROOT` | Recommended | Report output root — files go to `<<PROJECT_ROOT>>/<report-id>/` |
| `PIXEL_GUARD_ORIGIN` | Optional | HTTP base URL for report links (e.g. `http://localhost:3003`) |
| `PORT` | Optional | HTTP server port (default `3003`) |

---

### Recommended: Remote stdio via `npx` — `pixel-guard-remote`

Same pattern as ui-audit. The editor starts Pixel Guard; reports go to `PROJECT_ROOT`, not the npx cache.

```json
{
  "mcpServers": {
    "pixel-guard-remote": {
      "command": "npx",
      "args": ["-y", "https://github.com/ACSGenUI/pixel-guard#site-compare"],
      "env": {
        "PROJECT_ROOT": "<<PROJECT_ROOT>>"
      }
    }
  }
}
```

- Use `-y` so `npx` does not prompt.
- **No `--stdio` arg needed** — `output/main.js` defaults to stdio.
- Do **not** pass `--http` — that starts an HTTP server instead of MCP stdio.
- Clear stale cache after GitHub updates: `rm -rf ~/.npm/_npx/*`

---

### Optional: Local stdio — `pixel-guard-local`

For contributors or offline use. Requires [local installation](#local-development-installation).

```json
{
  "mcpServers": {
    "pixel-guard-local": {
      "command": "node",
      "args": ["<<pixel-guard-source-directory>>/output/main.js"],
      "env": {
        "PROJECT_ROOT": "<<PROJECT_ROOT>>"
      }
    }
  }
}
```

---

### Optional: Local HTTP server — `pixel-guard-app`

For local development with hot reload. **You** start the server; the editor connects via URL.

```bash
cd <<pixel-guard-source-directory>>
PROJECT_ROOT=<<PROJECT_ROOT>> npm run dev
```

```json
{
  "mcpServers": {
    "pixel-guard-app": {
      "url": "http://localhost:3003/mcp"
    }
  }
}
```

Report URLs: `http://localhost:3003/reports/<report-id>/manifest.json`

---

### Optional: Remote HTTP server — `pixel-guard-remote-server`

**Only if you need a long-running HTTP MCP server** (shared host, multiple clients, CI). **Not required** for the recommended `pixel-guard-remote` npx config above.

1. Start the server on a machine that stays running:

   ```bash
   cd <<pixel-guard-source-directory>>
   npm install && npm run playwright:install && npm run build
   PROJECT_ROOT=<<PROJECT_ROOT>> PORT=3003 node output/main.js --http
   ```

2. Point MCP clients at it:

   ```json
   {
     "mcpServers": {
       "pixel-guard-remote-server": {
         "url": "http://your-server.example.com:3003/mcp"
       }
     }
   }
   ```

---

### Which mode should I use?

| Config | When to use | You run a server? |
|--------|-------------|-------------------|
| **`pixel-guard-remote`** | **Most users — remote MCP via npx** | No |
| `pixel-guard-local` | Local clone / offline dev | No (editor launches stdio) |
| `pixel-guard-app` | Local dev with hot reload | Yes (`npm run dev`) |
| `pixel-guard-remote-server` | Shared HTTP MCP on a host | Yes (`node output/main.js --http`) |

| Config | Transport | Reports | Report URLs |
|--------|-----------|---------|-------------|
| `pixel-guard-remote` | stdio | `<<PROJECT_ROOT>>/<report-id>/` | Filesystem path (images embedded in MCP UI) |
| `pixel-guard-local` | stdio | `<<PROJECT_ROOT>>/<report-id>/` | Filesystem path (images embedded in MCP UI) |
| `pixel-guard-app` | HTTP | `<<PROJECT_ROOT>>/<report-id>/` | `http://localhost:3003/reports/<report-id>/...` |
| `pixel-guard-remote-server` | HTTP | `<<PROJECT_ROOT>>/<report-id>/` | `http://<host>:3003/reports/<report-id>/...` |

---

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Type-check, build UI bundle, compile server to `output/` |
| `npm run dev` | Watch UI + HTTP server (`tsx main.ts --http`) |
| `npm run serve` | HTTP server only (`tsx main.ts --http`) |
| `npm start` | `build` then `serve` |
| `npm run playwright:install` | Install Chromium for Playwright |

## HTTP routes

Only relevant when running with `--http` (`npm run dev`, `npm start`, or remote HTTP server):

| Route | Content |
|-------|---------|
| `http://localhost:3003/mcp` | MCP endpoint |
| `http://localhost:3003/reports/<report-id>/` | Comparison artifacts (PNG + manifest) |
| `http://localhost:3003/playwright-report/` | Playwright HTML report (if present) |

## Page comparisons

Each comparison creates a folder under `PROJECT_ROOT`:

```
<<PROJECT_ROOT>>/
  page-compare-<timestamp>/
    manifest.json
    source.png
    destination.png
    diff.png
```

The MCP report view renders images from:

- **stdio mode** (`pixel-guard-remote`, `pixel-guard-local`) — base64 embedded in HTML from disk
- **HTTP mode** (`pixel-guard-app`, `pixel-guard-remote-server`) — served at `/reports/<report-id>/`

### Defaults

- Viewports: `mobile`, `tablet`, `desktop`, `large`
- Diff threshold: `maxDiffPixelRatio = 0.01` (1%)
- Full-page screenshots: enabled

---

## FAQ

### Do I need to clone the repo or run `node output/main.js --http`?

**No**, for the recommended remote setup (`pixel-guard-remote`). Just add the npx MCP config with `PROJECT_ROOT`.

Clone / build / `--http` are only for local development or the optional HTTP-server modes.

### Do I need `--stdio` in the npx config?

**No.** `output/main.js` defaults to stdio. Only pass `--http` when you intentionally want the HTTP server.

### `import: command not found` from `.bin/pixel-guard`

`npx` ran JavaScript with `sh` instead of Node. Ensure:

1. Package `"bin"` points to `output/main.js` (not `output/server.js`)
2. `output/main.js` starts with `#!/usr/bin/env node` (run `npm run build` on the published branch)
3. Clear npx cache: `rm -rf ~/.npm/_npx/*`

### MCP server does not show up

- **Remote stdio:** confirm `PROJECT_ROOT` is an absolute path; clear npx cache
- **Local stdio:** confirm `output/main.js` exists (`npm run build`)
- **HTTP:** confirm server is running and `http://localhost:3003/mcp` responds
- Reload MCP servers in the editor after config changes

### Reports not in my project folder

Set `PROJECT_ROOT` in MCP config `env`:

```json
"env": { "PROJECT_ROOT": "/absolute/path/to/your-audited-repo" }
```

Without it, reports fall back to `process.cwd()`.

### Playwright / Chromium errors

On first remote run, Playwright may need to download Chromium. For local dev:

```bash
npm run playwright:install
```

### Page comparison hangs or times out

Sites may be slow; comparisons wait for `networkidle` (up to 120s per page). Verify both URLs load in a browser.

### Very high diff percentage

Usually caused by different content, fonts, consent modals, or loading timing — not a tool bug. Inspect `diff.png` in the report folder.

### `EADDRINUSE` on port 3003

Only applies to HTTP mode:

```bash
PORT=3004 node output/main.js --http
```

Then use `http://localhost:3004/mcp` in MCP config.
