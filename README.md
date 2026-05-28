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

Pixel Guard lives in `mcp-apps/pixel-guard` and can be used in two ways.

In the examples below, replace placeholders with your machine’s paths:

| Placeholder | Meaning |
|-------------|---------|
| `<<pixel-guard-source-directory>>` | Absolute path to the `mcp-apps/pixel-guard` folder |
| `<<current working directory>>` | Same as `<<pixel-guard-source-directory>>` when configuring MCP `cwd` |

### 1) Local stdio MCP server (`pixel-guard-local`)

Use `<<pixel-guard-source-directory>>/output/main.js --stdio` as the entrypoint.

```json
{
  "mcpServers": {
    "pixel-guard-local": {
      "command": "node",
      "args": [
        "<<pixel-guard-source-directory>>/output/main.js",
        "--stdio"
      ],
      "cwd": "<<current working directory>>"
    }
  }
}
```

Set `cwd` to `<<pixel-guard-source-directory>>` so `.env`, reports, and relative paths resolve correctly.

Do not point `npx` or `node` directly at `<<pixel-guard-source-directory>>/output/server.js`; that module defines the server but does not start stdio transport.

Run `npm run build` before enabling this config so `output/main.js` exists.

### 2) HTTP MCP server (`pixel-guard-app`)

From `<<pixel-guard-source-directory>>`:

```sh
npm install
npm run dev
```

Then use:

```json
{
  "mcpServers": {
    "pixel-guard-app": {
      "url": "http://localhost:3003/mcp"
    }
  }
}
```

## Scripts

- `npm run dev` — Client watch build and HTTP server (recommended for local development).
- `npm run build` — Type-checks, builds the UI bundle, and compiles server TypeScript to `output/`.
- `npm run serve` — Starts the server with `tsx main.ts` (no compile step).
- `npm start` — Runs `build` then `serve`.
- `npm run playwright:install` — Downloads Chromium for Playwright.

## HTTP server routes

When the HTTP MCP server is running (`npm start` or `npm run dev`):

- MCP: `http://localhost:3003/mcp`
- Page comparison artifacts: `http://localhost:3003/page-comparison-reports/...`
- Playwright report assets (when available): `http://localhost:3003/playwright-report/...`

## Page visual comparisons

Page comparison runs are saved under:

- `<<pixel-guard-source-directory>>/page-comparison-reports/<report-id>/`

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

| Mode | Best for |
|------|----------|
| **stdio** (`pixel-guard-local`) | Editor-launched MCP, no separate server process to manage |
| **HTTP** (`pixel-guard-app`) | Dev with hot reload (`npm run dev`), sharing one server across tools |
