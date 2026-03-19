import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import * as z from "zod";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";

const DIST_DIR = path.join(import.meta.dirname, "dist");

const DEFAULT_BASE_URL = process.env.VISUAL_TEST_BASE_URL ?? "http://localhost:3000";
const VISUAL_TEST_SERVER_URL =
  (process.env.VISUAL_TEST_SERVER_URL ?? "http://localhost:3001").replace(/\/$/, "");
const TEMPLATES_PATH = "/tools/sidekick/library/templates/";

/** Last Playwright report URL from a successful runVisualTest; used by the report resource. */
let lastPlaywrightReportUrl: string | undefined;

/** True while runVisualTest is executing (API call + delay). Report view uses this to wait before rendering. */
let visualTestRunning = false;

/** Called by main.ts GET /api/last-report so the report page can poll until test completes. */
export function getLastReportStatus(): { url: string | undefined; running: boolean } {
  return { url: lastPlaywrightReportUrl, running: visualTestRunning };
}

/** Delay (ms) to wait after test run so Playwright can finish writing the HTML report. */
const REPORT_READY_DELAY_MS = Math.max(
  0,
  parseInt(process.env.VISUAL_TEST_REPORT_READY_DELAY_MS ?? "2500", 10) || 2500
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const SNAPSHOTS_PATH = "/tools/visual-tests/visual.spec.js-snapshots";

function buildLibraryUrl(
  blockName: string,
  baseUrl: string,
  variationIndex: number
): string {
  const block = blockName.toLowerCase().trim().replace(/\s+/g, "-");
  const pathSeg = `${TEMPLATES_PATH}${block}`;
  const origin = baseUrl.replace(/\/$/, "");
  return `${origin}/tools/sidekick/library.html?plugin=blocks&path=${encodeURIComponent(pathSeg)}&index=${variationIndex}&vtest=true`;
}

function buildSnapshotUrl(
  blockName: string,
  baseUrl: string,
  variationIndex: number,
  viewport: string
): string {
  const block = blockName.toLowerCase().trim().replace(/\s+/g, "-");
  const viewportLabel =
    viewport.length > 0
      ? viewport.charAt(0).toUpperCase() + viewport.slice(1).toLowerCase()
      : "Desktop";
  const fileName = `${block}-${variationIndex}-${viewportLabel}.png`;
  const origin = baseUrl.replace(/\/$/, "");
  return `${origin}${SNAPSHOTS_PATH}/${fileName}`;
}

/** Fetch image from URL and return base64 string, or undefined on failure. */
async function fetchImageAsBase64(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { headers: { Accept: "image/*" } });
    if (!res.ok) return undefined;
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    return b64;
  } catch {
    return undefined;
  }
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Pixel Guard - UI Visual Validator",
    version: "1.0.0",
  });

  const resourceUri = "ui://pixel-guard/pixel-guard.html";

  const pixelGuardOrigin =
    process.env.PIXEL_GUARD_ORIGIN ??
    `http://localhost:${process.env.PORT ?? "3003"}`;
  const visualTestOrigin = (process.env.VISUAL_TEST_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");

  const resourceDomains = [
    pixelGuardOrigin.replace(/\/$/, ""),
    visualTestOrigin,
    VISUAL_TEST_SERVER_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ].filter((origin, i, arr) => arr.indexOf(origin) === i);

  // Same origins for nested iframes (library page loads in iframe; maps to CSP frame-src)
  const frameDomains = [...resourceDomains];

  // Resource: The built HTML file (Pixel Guard UI with overlay)
  // Request CSP so the host allows images (resourceDomains) and iframe (frameDomains) from localhost:3000
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "pixel-guard.html"),
        "utf-8"
      );
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                csp: {
                  resourceDomains,
                  frameDomains,
                },
              },
            },
          },
        ],
      };
    }
  );

  const reportResourceUri = "ui://pixel-guard/playwright-report.html";
  const escapeAttr = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const reportResourceDomains = [pixelGuardOrigin.replace(/\/$/, ""), VISUAL_TEST_SERVER_URL, ...resourceDomains];
  // Resource: Playwright report viewer – waits for test to complete (like visual-test.js), then renders report
  registerAppResource(
    server,
    reportResourceUri,
    reportResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const reportUrl = lastPlaywrightReportUrl ?? "";
      const safeUrl = escapeAttr(reportUrl);
      const safeOrigin = escapeAttr(pixelGuardOrigin.replace(/\/$/, ""));
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Playwright Report – Pixel Guard</title>
  <style>
    html, body { margin: 0; height: 100%; min-height: 100%; font-family: system-ui, sans-serif; background: #f3f4f6; box-sizing: border-box; }
    .bar { padding: 12px 16px; background: #fff; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .bar a { color: #2563eb; font-size: 14px; }
    .report-frame { display: block; width: 100%; height: calc(100vh - 49px); min-height: 600px; border: none; flex: 1; }
    body { display: flex; flex-direction: column; }
    .empty, .waiting { padding: 24px; color: #6b7280; text-align: center; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
    .waiting .spinner { width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="root">
    ${reportUrl
      ? `<div class="bar"><span style="font-weight: 600; font-size: 14px;">Playwright report</span><a id="report-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">Open in new tab</a></div><iframe class="report-frame" id="report-iframe" title="Playwright report" data-src="${safeUrl}"></iframe>`
      : `<div class="waiting" id="waiting"><div class="spinner"></div><p>Test is running, please wait…</p></div>`}
  </div>
  <script>
(function(){
  var origin = "${safeOrigin}";
  var hasUrl = ${reportUrl ? "true" : "false"};
  function setReport(url) {
    var t = url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
    var root = document.getElementById('root');
    root.innerHTML = '<div class="bar"><span style="font-weight: 600; font-size: 14px;">Playwright report</span><a id="report-link" href="' + t.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener noreferrer">Open in new tab</a></div><iframe class="report-frame" id="report-iframe" title="Playwright report" src="' + t.replace(/"/g, '&quot;') + '"></iframe>';
  }
  if (hasUrl) {
    var u = document.getElementById('report-iframe');
    if (u && u.dataset.src) { var s = u.dataset.src + (u.dataset.src.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(); u.src = s; document.getElementById('report-link').href = s; }
    return;
  }
  var interval = setInterval(function() {
    fetch(origin + '/api/last-report', { cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.running && d.url) {
          clearInterval(interval);
          setReport(d.url);
        }
      })
      .catch(function() {});
  }, 1000);
})();
<\/script>
</body>
</html>`;
      return {
        contents: [
          {
            uri: reportResourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                csp: {
                  resourceDomains: reportResourceDomains,
                  frameDomains: [VISUAL_TEST_SERVER_URL, ...frameDomains],
                },
              },
            },
          },
        ],
      };
    }
  );

  const validateVisualInputSchema = {
    blockName: z
      .string()
      .min(1, "blockName is required")
      .describe("Block name to validate (e.g. tabs, cards, hero)"),
    variationIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Variation index (default 0)"),
    viewport: z
      .string()
      .optional()
      .describe("Viewport for snapshot: mobile, tablet, desktop, or large"),
    baseUrl: z
      .string()
      .url()
      .optional()
      .describe("Base URL of the site (default from env or http://localhost:3000)"),
  };

  // Tool: validateVisual - Validate a block visually; takes block name and constructs library + snapshot URLs
  // registerAppTool(
  //   server,
  //   "validateVisual",
  //   {
  //     title: "Validate Visual",
  //     description:
  //       "Run visual validation for a block. Requires block name (e.g. cards, tabs, hero). Optionally pass variationIndex, viewport, baseUrl. Constructs the library page URL and baseline snapshot URL and opens the Pixel Guard UI with the overlay.",
  //     inputSchema: validateVisualInputSchema,
  //     _meta: { ui: { resourceUri } },
  //   },
  //   async (params): Promise<CallToolResult> => {
  //     type Args = {
  //       blockName: string;
  //       variationIndex?: number;
  //       viewport?: string;
  //       baseUrl?: string;
  //     };
  //     // SDK passes parsed args as first param when inputSchema is set
  //     const maybeArgs = params as unknown;
  //     const args: Args =
  //       typeof maybeArgs === "object" &&
  //       maybeArgs !== null &&
  //       "blockName" in maybeArgs &&
  //       typeof (maybeArgs as Args).blockName === "string"
  //         ? (maybeArgs as Args)
  //         : (typeof maybeArgs === "object" && maybeArgs !== null && "arguments" in maybeArgs
  //             ? (maybeArgs as { arguments?: Args }).arguments
  //             : undefined) ?? ({} as Args);
  //     const blockName = typeof args.blockName === "string" ? args.blockName.trim() : "";
  //     if (!blockName) {
  //       return {
  //         content: [
  //           {
  //             type: "text",
  //             text: JSON.stringify({
  //               success: false,
  //               message: "Missing required argument: blockName (e.g. cards, tabs, hero).",
  //             }),
  //           },
  //         ],
  //         isError: true,
  //       };
  //     }

  //     const baseUrl =
  //       typeof args.baseUrl === "string" && args.baseUrl
  //         ? args.baseUrl
  //         : DEFAULT_BASE_URL;
  //     const variationIndex =
  //       typeof args.variationIndex === "number" && args.variationIndex >= 0
  //         ? args.variationIndex
  //         : 0;
  //     const viewport =
  //       typeof args.viewport === "string" && args.viewport
  //         ? args.viewport
  //         : "desktop";

  //     const libraryUrl = buildLibraryUrl(blockName, baseUrl, variationIndex);
  //     const imageUrl = buildSnapshotUrl(
  //       blockName,
  //       baseUrl,
  //       variationIndex,
  //       viewport
  //     );
  //     const componentName = blockName.toLowerCase().replace(/\s+/g, "-");
  //     const imageData = await fetchImageAsBase64(imageUrl);

  //     return {
  //       content: [
  //         {
  //           type: "text",
  //           text: JSON.stringify({
  //             success: true,
  //             message: `Visual validation for block "${blockName}". Use the overlay to compare baseline with current.`,
  //             blockName,
  //             componentName,
  //             viewport,
  //             variationIndex,
  //             libraryUrl,
  //             imageUrl,
  //             imageData,
  //           }),
  //         },
  //       ],
  //     };
  //   }
  // );

  const getBlockSnapshotInputSchema = {
    blockName: z.string().min(1).describe("Block name (e.g. tabs, cards, hero)"),
    variationIndex: z.number().int().min(0).optional().describe("Variation index (default 0)"),
    viewport: z.string().optional().describe("Viewport: mobile, tablet, desktop, large"),
    baseUrl: z.string().url().optional().describe("Base URL of the site"),
  };

  server.registerTool(
    "getBlockSnapshot",
    {
      title: "Get Block Snapshot",
      description: "Returns the baseline snapshot image for a block as base64 (for use in Pixel Guard UI under strict CSP).",
      inputSchema: getBlockSnapshotInputSchema,
    },
    async (params): Promise<CallToolResult> => {
      type Args = { blockName: string; variationIndex?: number; viewport?: string; baseUrl?: string };
      const raw = params as Args | { arguments?: Args };
      const args: Args =
        "blockName" in raw && typeof (raw as Args).blockName === "string"
          ? (raw as Args)
          : ("arguments" in raw ? (raw as { arguments?: Args }).arguments ?? {} : {}) as Args;
      const blockName = typeof args.blockName === "string" ? args.blockName.trim() : "";
      if (!blockName) {
        return {
          content: [{ type: "text", text: JSON.stringify({ imageData: undefined, error: "blockName required" }) }],
          isError: true,
        };
      }
      const baseUrl = typeof args.baseUrl === "string" && args.baseUrl ? args.baseUrl : DEFAULT_BASE_URL;
      const variationIndex = typeof args.variationIndex === "number" && args.variationIndex >= 0 ? args.variationIndex : 0;
      const viewport = typeof args.viewport === "string" && args.viewport ? args.viewport : "desktop";
      const imageUrl = buildSnapshotUrl(blockName, baseUrl, variationIndex, viewport);
      const imageData = await fetchImageAsBase64(imageUrl);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(imageData ? { imageData } : { imageData: undefined, error: "Failed to fetch snapshot" }),
          },
        ],
      };
    }
  );

  const runVisualTestInputSchema = {
    blockName: z
      .string()
      .min(1, "blockName is required")
      .describe("Block name to run visual test for (e.g. tabs, cards, hero)"),
  };

  registerAppTool(
    server,
    "runVisualTest",
    {
      title: "Run Visual Test (Step 1)",
      description:
        "Step 1: Run the Playwright visual test for a block by name. Requires the visual test server to be running (e.g. npm run test:visual:server). Upon completion, call openVisualTestReport (Step 2) to open the report UI.",
      inputSchema: runVisualTestInputSchema,
      _meta: { ui: {} },
    },
    async (params): Promise<CallToolResult> => {
      type Args = { blockName: string };
      const raw = params as unknown;
      const args: Args =
        typeof raw === "object" &&
        raw !== null &&
        "blockName" in raw &&
        typeof (raw as Args).blockName === "string"
          ? (raw as Args)
          : (typeof raw === "object" && raw !== null && "arguments" in raw
              ? (raw as { arguments?: Args }).arguments
              : undefined) ?? ({} as Args);
      const blockName = typeof args.blockName === "string" ? args.blockName.trim() : "";
      if (!blockName) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                message: "Missing required argument: blockName (e.g. tabs, cards, hero).",
              }),
            },
          ],
          isError: true,
        };
      }

      const component = blockName.toLowerCase().replace(/\s+/g, "-");
      const reportUrl = `${VISUAL_TEST_SERVER_URL}/playwright-report/index.html`;
      visualTestRunning = true;

      try {
        const res = await fetch(`${VISUAL_TEST_SERVER_URL}/api/run-visual-test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: "test:visual:blocks",
            component,
          }),
        });
        const data = (await res.json()) as {
          success?: boolean;
          error?: string;
          details?: string;
          output?: string;
          stderr?: string;
        };
        if (!res.ok) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: data.error ?? "Request failed",
                  details: data.details,
                  output: data.output,
                  stderr: data.stderr,
                  reportUrl,
                }),
              },
            ],
            isError: true,
          };
        }
        if (data.success === true) {
          await sleep(REPORT_READY_DELAY_MS);
          lastPlaywrightReportUrl = reportUrl;
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: data.success === true,
                output: data.output ?? "",
                stderr: data.stderr ?? "",
                reportUrl,
                blockName,
                component,
                reportResourceUri,
                nextStep: "Call openVisualTestReport to open the report view.",
              }),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "Visual test server request failed",
                details: message,
                reportUrl,
                hint: "Ensure the visual test server is running (e.g. npm run test:visual:server from repo root).",
              }),
            },
          ],
          isError: true,
        };
      } finally {
        visualTestRunning = false;
      }
    }
  );

  // Step 2: Call after runVisualTest completes; opens the report UI.
  registerAppTool(
    server,
    "openVisualTestReport",
    {
      title: "Open Visual Test Report (Step 2)",
      description:
        "Step 2: Call this after runVisualTest has completed to open the Playwright report view. Returns report URL and resource URI. Opens the report UI when invoked.",
      inputSchema: {},
      _meta: { ui: { resourceUri: reportResourceUri } },
    },
    async (): Promise<CallToolResult> => {
      const reportUrl = lastPlaywrightReportUrl ?? "";
      const hasReport = reportUrl.length > 0;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              hasReport,
              reportUrl: reportUrl || null,
              reportResourceUri: hasReport ? reportResourceUri : null,
              message: hasReport
                ? "Open the report view using reportResourceUri, or open reportUrl in a new tab."
                : "No report available. Run runVisualTest for a block first, then call this tool again.",
            }),
          },
        ],
      };
    }
  );

  server.registerPrompt(
    "run-visual-test",
    {
      title: "Run Visual Test",
      description:
        "Run the visual test for a block in two steps: (1) runVisualTest to execute the test, (2) openVisualTestReport to open the report when done.",
      argsSchema: {
        blockName: z.string().min(1).describe("Block name to run visual test for (e.g. tabs, cards, hero)"),
      },
    },
    async ({ blockName }) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Run the visual test for the ${blockName} block: first call the runVisualTest tool with blockName "${blockName}", and when it completes successfully call openVisualTestReport to open the report view.`,
            },
          },
        ],
      };
    }
  );

  server.registerPrompt(
    "suggest-fix",
    {
      title: "Suggest Fix",
      description: "Verify the issue by comparing the original snapshot and current snapshot of the given block and suggest the fix.",
      argsSchema: {
        blockName: z.string().min(1).describe("Block name (e.g. tabs, cards, hero)"),
      },
    },
    async ({ blockName }) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `verify the issue by comparing the original snapshot and current snapshot of the ${blockName} block and provide the fix`,
            },
          },
        ],
      };
    }
  );

  return server;
}
