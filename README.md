# Pixel Guard

Pixel Guard is an MCP app for UI visual validation.

It serves a local MCP server, runs page-to-page visual comparisons with Playwright, and exposes report artifacts for review.

## Requirements

- Node.js 20+ (Node 22 recommended)
- npm
- Chromium (installed via Playwright; see [Installation](#installation))

## Installation

1. **Clone or open the repo** and go to the Pixel Guard package:

   ```bash
   cd <<pixel-guard-source-directory>>
   ```

   `<<pixel-guard-source-directory>>` is the absolute path to this folder (for example `.../aem-visual-cheker/mcp-apps/pixel-guard`).

2. **Install npm dependencies:**

   ```bash
   npm install
   ```

3. **Install Playwright Chromium** (required for page screenshots and comparisons):

   ```bash
   npm run playwright:install
   ```

4. **Build** (required for stdio MCP and production-like runs):

   ```bash
   npm run build
   ```

   This writes compiled server files under `<<pixel-guard-source-directory>>/output/` (for example `output/main.js`).

5. **Verify** (optional):

   ```bash
   npm start
   ```

   You should see `Pixel Guard MCP server listening on http://localhost:3003/mcp`.

## Pixel Guard MCP setup

Pixel Guard supports **stdio** (editor launches the process) and **HTTP** (you run a server, editor connects via URL).

Replace placeholders with your paths:

| Placeholder | Meaning |
|-------------|---------|
| `<<pixel-guard-source-directory>>` | Absolute path to `mcp-apps/pixel-guard` |
| `<<PROJECT_ROOT>>` | Absolute path to the repo/workspace where reports and artifacts are stored |

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `PROJECT_ROOT` | Remote stdio / HTTP (recommended) | Writes reports to `<<PROJECT_ROOT>>/<report-id>/` |
| `PIXEL_GUARD_ORIGIN` | Optional (stdio) | Set to `http://localhost:3003` when an HTTP server is also running, so tool output uses HTTP report URLs |
| `PORT` | Optional | HTTP server port (default `3003`) |

---

### 1) Local stdio (`pixel-guard-local`)

Editor launches Pixel Guard. Reports default to `process.cwd()` unless `PROJECT_ROOT` is set.

```json
{
  "mcpServers": {
    "pixel-guard-local": {
      "command": "node",
      "args": [
        "<<pixel-guard-source-directory>>/output/main.js"
      ],
      "env": {
        "PROJECT_ROOT": "<<PROJECT_ROOT>>"
      }
    }
  }
}
```

Run `npm run build` first so `output/main.js` exists.

Do **not** point `node` at `output/server.js` — that module defines the server but does not start stdio transport.

---

### 2) Remote stdio via `npx` (`pixel-guard-remote`)

Same as ui-audit remote pattern. Reports are written under `PROJECT_ROOT`, not the npx cache.

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
- Do **not** pass `--stdio` or `--http` in `args`; `output/main.js` defaults to stdio for MCP.
- Without `PIXEL_GUARD_ORIGIN`, `reportUrl` in tool output is a filesystem path under `PROJECT_ROOT`.
- Clear stale npx cache after GitHub updates: `rm -rf ~/.npm/_npx/*`

---

### 3) Local HTTP server (`pixel-guard-app`)

Run the server yourself, then connect via URL. Best for dev with hot reload.

**Terminal** (from `<<pixel-guard-source-directory>>`):

```bash
npm install
npm run playwright:install
npm run build
PROJECT_ROOT=<<PROJECT_ROOT>> npm run dev
```

**MCP config:**

```json
{
  "mcpServers": {
    "pixel-guard-app": {
      "url": "http://localhost:3003/mcp"
    }
  }
}
```

Report URLs in tool output: `http://localhost:3003/reports/<report-id>/manifest.json`

---

### 4) Remote HTTP server (`pixel-guard-remote-server`)

Run Pixel Guard as a **standalone HTTP MCP server** (e.g. from a cloned repo or CI host). The editor connects via `url`; no stdio process is spawned by the editor.

**Start the server** (pick one):

```bash
# Option A — cloned repo
cd <<pixel-guard-source-directory>>
npm install && npm run playwright:install && npm run build
PROJECT_ROOT=<<PROJECT_ROOT>> PORT=3003 node output/main.js --http

# Option B — install from GitHub once, then run HTTP (no --stdio)
mkdir -p ~/pixel-guard-server && cd ~/pixel-guard-server
npm install github:ACSGenUI/pixel-guard#site-compare
PROJECT_ROOT=<<PROJECT_ROOT>> PORT=3003 \
  node node_modules/pixel-guard/output/main.js --http
```

**MCP config** (on your machine or any client that can reach the host):

```json
{
  "mcpServers": {
    "pixel-guard-remote-server": {
      "url": "http://localhost:3003/mcp"
    }
  }
}
```

For a server on another host, replace `localhost` with the host/IP (and ensure the port is reachable):

```json
{
  "mcpServers": {
    "pixel-guard-remote-server": {
      "url": "http://your-server.example.com:3003/mcp"
    }
  }
}
```

**Optional `.env`** in `<<PROJECT_ROOT>>`:

```env
PROJECT_ROOT=<<PROJECT_ROOT>>
PORT=3003
PIXEL_GUARD_ORIGIN=http://localhost:3003
```

---

### Which mode should I use?

| Config | Transport | Who starts the process | Reports location | Report URLs |
|--------|-----------|------------------------|------------------|-------------|
| `pixel-guard-local` | stdio | Editor | `PROJECT_ROOT` or `cwd` | Filesystem (or HTTP if `PIXEL_GUARD_ORIGIN` set) |
| `pixel-guard-remote` | stdio | Editor via `npx` | `PROJECT_ROOT` | Filesystem (or HTTP if `PIXEL_GUARD_ORIGIN` set) |
| `pixel-guard-app` | HTTP | You (`npm run dev`) | `PROJECT_ROOT/<report-id>/` | `http://localhost:3003/reports/...` |
| `pixel-guard-remote-server` | HTTP | You (node / npx) | `PROJECT_ROOT/<report-id>/` | `http://<host>:3003/reports/...` |

## Scripts

- `npm run dev` — Client watch build and HTTP server (recommended for local development).
- `npm run build` — Type-checks, builds the UI bundle, and compiles server TypeScript to `output/`.
- `npm run serve` — Starts the server with `tsx main.ts` (no compile step).
- `npm start` — Runs `build` then `serve`.
- `npm run playwright:install` — Downloads Chromium for Playwright.

## HTTP server routes

When the HTTP MCP server is running (`npm start` or `npm run dev`):

- MCP: `http://localhost:3003/mcp`
- Page comparison artifacts: `http://localhost:3003/reports/<report-id>/...`
- Playwright report assets (when available): `http://localhost:3003/playwright-report/...`

## Page visual comparisons

Page comparison runs are saved under:

- `<<PROJECT_ROOT>>/<report-id>/` (contains `manifest.json`, `source.png`, `destination.png`, `diff.png`)

Set `PROJECT_ROOT` in MCP config `env` (remote) or rely on process `cwd` (local fallback).

Each report directory contains:

- `source.png`
- `destination.png`
- `diff.png`
- `manifest.json`

The manifest includes diff statistics such as:

- `status` (`passed` / `failed`)
- `diffPixelCount`
- `diffPixelRatio`
- `summary`

## Notes

- Viewport presets: `mobile`, `tablet`, `desktop`, `large`.
- Default comparison threshold: `maxDiffPixelRatio = 0.01` (1%).
- Full-page screenshots are enabled by default.

## FAQ

### `import: command not found` from `.bin/pixel-guard`

`npx` ran a JavaScript file with `sh` instead of Node. Ensure the package `"bin"` points at `output/main.js` (with `#!/usr/bin/env node`) and rebuild.

**Fix (local):**

```json
{
  "command": "node",
  "args": ["<<pixel-guard-source-directory>>/output/main.js"],
  "cwd": "<<pixel-guard-source-directory>>"
}
```

**Fix for remote `npx`:**

```json
"args": ["-y", "https://github.com/ACSGenUI/pixel-guard#site-compare"]
```

Clear the old npx cache folder under `~/.npm/_npx/` before reconnecting.

### MCP server does not show up in Cursor / Claude

- Confirm the config path: `cwd` must be `<<pixel-guard-source-directory>>` (the folder that contains `package.json`).
- For stdio: run `npm run build` and confirm `<<pixel-guard-source-directory>>/output/main.js` exists.
- For HTTP: run `npm run dev` or `npm start` and confirm `http://localhost:3003/mcp` responds.
- Restart the editor or reload MCP servers after changing config.

### `Cannot find module` or `output/main.js` not found

- Run `npm run build` from `<<pixel-guard-source-directory>>`.
- In MCP config, use `<<pixel-guard-source-directory>>/output/main.js`, not `output/server.js`.
- Ensure `args` and `cwd` use your real absolute paths, not the literal `<<...>>` placeholders.

### `npm install` fails (dependency errors)

- Use Node.js 20 or newer: `node -v`.
- Remove a broken install and retry:

  ```bash
  cd <<pixel-guard-source-directory>>
  rm -rf node_modules package-lock.json
  npm install
  ```

- On corporate networks, configure npm proxy/registry if installs time out or return 403/407.
- If you see peer dependency warnings, they are usually safe unless `npm install` exits with a non-zero code.

### Playwright / Chromium errors

- Run `npm run playwright:install` after `npm install`.
- If the browser is missing at runtime, reinstall:

  ```bash
  npx playwright install chromium
  ```

- On Linux CI or headless environments, you may need system libraries documented in [Playwright’s install guide](https://playwright.dev/docs/browsers#installing-browsers).

### Page comparison hangs or times out

- Production pharma sites can be slow; comparisons wait for `networkidle` (up to 120s per page).
- Check that both URLs load in a normal browser.
- Cookie banners, geo blocks, or auth walls can cause large diffs or stalled loads.

### Very high diff percentage (e.g. 30–70%)

- Often caused by different content, fonts, images, or consent modals—not a broken tool.
- Compare the same path on source and destination.
- Try another viewport or inspect `diff.png` in the report folder.

### `EADDRINUSE` on port 3003

- Another Pixel Guard or process is using the port. Stop it or set `PORT` in `.env`:

  ```bash
  PORT=3004 npm run dev
  ```

  Then point MCP HTTP config at `http://localhost:3004/mcp`.

### Should I use stdio or HTTP?

See [Which mode should I use?](#which-mode-should-i-use) above.
