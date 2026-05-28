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
import {
  comparePages,
  PAGE_COMPARE_VIEWPORTS,
  type PageCompareViewport,
} from "./compare-pages.js";
import { PLAYWRIGHT_REPORT_DIR, PLAYWRIGHT_REPORT_INDEX, REPO_ROOT } from "./paths.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");

const DEFAULT_BASE_URL = process.env.VISUAL_TEST_BASE_URL ?? "http://localhost:3000";
const VISUAL_TEST_SERVER_URL =
  (process.env.VISUAL_TEST_SERVER_URL ?? "http://localhost:3001").replace(/\/$/, "");
const TEMPLATES_PATH = "/tools/sidekick/library/templates/";

/** Last Playwright report URL from a successful runVisualTest; used by the report resource. */
let lastPlaywrightReportUrl: string | undefined;

/** True while runVisualTest is executing (API call + delay). Report view uses this to wait before rendering. */
let visualTestRunning = false;

/** Last page comparison report from comparePageVisuals. */
let lastPageComparisonReport:
  | {
      reportId: string;
      reportUrl: string;
      manifest: Record<string, unknown>;
    }
  | undefined;

/** True while comparePageVisuals is executing. */
let pageComparisonRunning = false;

/** Called by main.ts GET /api/last-report so the report page can poll until test completes. */
export function getLastReportStatus(): { url: string | undefined; running: boolean } {
  return { url: lastPlaywrightReportUrl, running: visualTestRunning };
}

/** Called by main.ts GET /api/last-page-comparison for the page comparison report UI. */
export function getLastPageComparisonStatus(): {
  report: typeof lastPageComparisonReport;
  running: boolean;
} {
  return { report: lastPageComparisonReport, running: pageComparisonRunning };
}

/** Delay (ms) to wait after test run so Playwright can finish writing the HTML report. */
const REPORT_READY_DELAY_MS = Math.max(
  0,
  parseInt(process.env.VISUAL_TEST_REPORT_READY_DELAY_MS ?? "2500", 10) || 2500
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PAGE_COMPARE_PARAM_HELP = {
  sourceUrl:
    "Baseline page URL before visual corrections (must be http or https), e.g. https://www.example.com/page-before",
  destinationUrl:
    "Corrected page URL after visual corrections (must be http or https), e.g. https://www.example.com/page-after",
  viewport: `Viewport preset: ${PAGE_COMPARE_VIEWPORTS.join(", ")} (optional, default: desktop)`,
  maxDiffPixelRatio:
    "Maximum allowed pixel diff ratio from 0 to 1 (optional, default: 0.01 = 1%)",
  fullPage: "Capture full-page screenshots (optional, default: true)",
} as const;

type ComparePageVisualsArgs = {
  sourceUrl?: string;
  destinationUrl?: string;
  viewport?: string;
  maxDiffPixelRatio?: number;
  fullPage?: boolean;
};

function parseComparePageVisualsArgs(raw: unknown): ComparePageVisualsArgs {
  if (typeof raw !== "object" || raw === null) return {};
  if ("sourceUrl" in raw || "destinationUrl" in raw) {
    return raw as ComparePageVisualsArgs;
  }
  if ("arguments" in raw) {
    const nested = (raw as { arguments?: ComparePageVisualsArgs }).arguments;
    return nested ?? {};
  }
  return {};
}

function validateHttpUrl(value: string | undefined, field: keyof typeof PAGE_COMPARE_PARAM_HELP): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return `${field} is required`;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return `${field} must use http or https`;
    }
    return null;
  } catch {
    return `${field} must be a valid URL`;
  }
}

function buildMissingParametersResponse(
  missing: string[],
  errors: string[]
): CallToolResult {
  const lines = [
    "Cannot run page comparison until required parameters are provided.",
    "",
    "Ask the user explicitly for each missing value, then call comparePageVisuals again with the full arguments.",
    "",
    "Required parameters:",
    `  • sourceUrl — ${PAGE_COMPARE_PARAM_HELP.sourceUrl}`,
    `  • destinationUrl — ${PAGE_COMPARE_PARAM_HELP.destinationUrl}`,
    "",
    "Optional parameters:",
    `  • viewport — ${PAGE_COMPARE_PARAM_HELP.viewport}`,
    `  • maxDiffPixelRatio — ${PAGE_COMPARE_PARAM_HELP.maxDiffPixelRatio}`,
    `  • fullPage — ${PAGE_COMPARE_PARAM_HELP.fullPage}`,
  ];
  if (missing.length > 0) {
    lines.push("", "Missing:", ...missing.map((m) => `  • ${m}`));
  }
  if (errors.length > 0) {
    lines.push("", "Validation errors:", ...errors.map((e) => `  • ${e}`));
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          action: "request_parameters",
          missingParameters: missing,
          validationErrors: errors,
          parameterHelp: PAGE_COMPARE_PARAM_HELP,
          message: lines.join("\n"),
        }),
      },
    ],
    isError: true,
  };
}

function validateComparePageVisualsArgs(args: ComparePageVisualsArgs):
  | {
      ok: true;
      sourceUrl: string;
      destinationUrl: string;
      viewport: PageCompareViewport;
      maxDiffPixelRatio: number;
      fullPage: boolean;
    }
  | { ok: false; missing: string[]; errors: string[] } {
  const missing: string[] = [];
  const errors: string[] = [];

  const sourceUrl = typeof args.sourceUrl === "string" ? args.sourceUrl.trim() : "";
  const destinationUrl =
    typeof args.destinationUrl === "string" ? args.destinationUrl.trim() : "";

  if (!sourceUrl) missing.push("sourceUrl");
  else {
    const sourceErr = validateHttpUrl(sourceUrl, "sourceUrl");
    if (sourceErr) errors.push(sourceErr);
  }

  if (!destinationUrl) missing.push("destinationUrl");
  else {
    const destErr = validateHttpUrl(destinationUrl, "destinationUrl");
    if (destErr) errors.push(destErr);
  }

  if (sourceUrl && destinationUrl && sourceUrl === destinationUrl) {
    errors.push("sourceUrl and destinationUrl must be different pages");
  }

  let viewport: PageCompareViewport = "desktop";
  if (args.viewport !== undefined && args.viewport !== "") {
    const v = String(args.viewport).toLowerCase();
    if (!PAGE_COMPARE_VIEWPORTS.includes(v as PageCompareViewport)) {
      errors.push(
        `viewport must be one of: ${PAGE_COMPARE_VIEWPORTS.join(", ")} (got "${args.viewport}")`
      );
    } else {
      viewport = v as PageCompareViewport;
    }
  }

  let maxDiffPixelRatio = 0.01;
  if (args.maxDiffPixelRatio !== undefined) {
    const ratio = args.maxDiffPixelRatio;
    if (typeof ratio !== "number" || Number.isNaN(ratio) || ratio < 0 || ratio > 1) {
      errors.push("maxDiffPixelRatio must be a number between 0 and 1");
    } else {
      maxDiffPixelRatio = ratio;
    }
  }

  const fullPage = args.fullPage !== false;

  if (missing.length > 0 || errors.length > 0) {
    return { ok: false, missing, errors };
  }

  return {
    ok: true,
    sourceUrl,
    destinationUrl,
    viewport,
    maxDiffPixelRatio,
    fullPage,
  };
}

function buildComparePagePromptAskUserMessage(
  missing: string[],
  errors: string[]
): string {
  const parts = [
    "I need a few details before I can compare the two pages visually.",
    "",
    "**Required** (please provide both):",
    `1. **sourceUrl** — ${PAGE_COMPARE_PARAM_HELP.sourceUrl}`,
    `2. **destinationUrl** — ${PAGE_COMPARE_PARAM_HELP.destinationUrl}`,
    "",
    "**Optional**:",
    `3. **viewport** — ${PAGE_COMPARE_PARAM_HELP.viewport}`,
  ];
  if (errors.length > 0) {
    parts.push("", "**Please fix these issues:**", ...errors.map((e) => `- ${e}`));
  }
  if (missing.length > 0) {
    parts.push("", `**Still needed:** ${missing.join(", ")}`);
  }
  parts.push(
    "",
    "Reply with the URLs (and optional viewport). I will then run comparePageVisuals and openPageComparisonReport."
  );
  return parts.join("\n");
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
  const pgOriginClean = pixelGuardOrigin.replace(/\/$/, "");
  const reportResourceDomains = [pgOriginClean, VISUAL_TEST_SERVER_URL, ...resourceDomains];
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
                  frameDomains: [pgOriginClean, ...frameDomains],
                },
              },
            },
          },
        ],
      };
    }
  );

  const pageComparisonResourceUri = "ui://pixel-guard/page-comparison-report.html";
  let lastPageComparisonForResource: typeof lastPageComparisonReport;

  registerAppResource(
    server,
    pageComparisonResourceUri,
    pageComparisonResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const report = lastPageComparisonForResource ?? lastPageComparisonReport;
      const manifest = report?.manifest ?? {};
      const reportUrl = report?.reportUrl ?? "";
      const safeUrl = escapeAttr(reportUrl);
      const safeOrigin = escapeAttr(pixelGuardOrigin.replace(/\/$/, ""));
      const status = typeof manifest.status === "string" ? manifest.status : "";
      const summary = typeof manifest.summary === "string" ? manifest.summary : "";
      const sourceUrl = typeof manifest.sourceUrl === "string" ? manifest.sourceUrl : "";
      const destinationUrl =
        typeof manifest.destinationUrl === "string" ? manifest.destinationUrl : "";
      const diffRatio =
        typeof manifest.diffPixelRatio === "number"
          ? (manifest.diffPixelRatio * 100).toFixed(2)
          : "—";
      const basePath =
        typeof manifest.reportBasePath === "string" ? manifest.reportBasePath : "";
      const pgOrigin = pixelGuardOrigin.replace(/\/$/, "");
      const imgBase = basePath ? `${pgOrigin}${basePath}` : "";

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Page Comparison – Pixel Guard</title>
  <style>
    html, body { margin: 0; min-height: 100%; font-family: system-ui, sans-serif; background: #f3f4f6; box-sizing: border-box; }
    body { display: flex; flex-direction: column; }
    .bar { padding: 12px 16px; background: #fff; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
    .bar h1 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
    .meta { font-size: 13px; color: #4b5563; line-height: 1.5; word-break: break-all; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; margin-left: 8px; }
    .badge.passed { background: #d1fae5; color: #065f46; }
    .badge.failed { background: #fee2e2; color: #991b1b; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 16px; flex: 1; }
    .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
    .panel h2 { margin: 0; padding: 10px 12px; font-size: 13px; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
    .panel img { display: block; width: 100%; height: auto; }
    .waiting { padding: 48px; text-align: center; color: #6b7280; flex: 1; }
    .waiting .spinner { width: 32px; height: 32px; margin: 0 auto 12px; border: 3px solid #e5e7eb; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div id="root">
    ${reportUrl
      ? `<div class="bar">
          <h1>Page visual comparison <span class="badge ${status}">${status || "unknown"}</span></h1>
          <div class="meta">${summary}<br/>Diff: ${diffRatio}% · <a href="${safeUrl}" target="_blank" rel="noopener">Open manifest</a></div>
          <div class="meta"><strong>Source:</strong> ${escapeAttr(sourceUrl)}</div>
          <div class="meta"><strong>Destination:</strong> ${escapeAttr(destinationUrl)}</div>
        </div>
        <div class="grid">
          <div class="panel"><h2>Source (baseline)</h2><img src="${escapeAttr(imgBase)}/source.png" alt="Source" /></div>
          <div class="panel"><h2>Destination (corrected)</h2><img src="${escapeAttr(imgBase)}/destination.png" alt="Destination" /></div>
          <div class="panel"><h2>Diff</h2><img src="${escapeAttr(imgBase)}/diff.png" alt="Diff" /></div>
        </div>`
      : `<div class="waiting" id="waiting"><div class="spinner"></div><p>Comparison is running, please wait…</p></div>`}
  </div>
  <script>
(function(){
  var origin = "${safeOrigin}";
  var hasReport = ${reportUrl ? "true" : "false"};
  if (hasReport) return;
  var interval = setInterval(function() {
    fetch(origin + '/api/last-page-comparison', { cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.running && d.report && d.report.reportUrl) {
          clearInterval(interval);
          location.reload();
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
            uri: pageComparisonResourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                csp: {
                  resourceDomains: [pgOrigin, ...reportResourceDomains],
                  frameDomains: reportResourceDomains,
                },
              },
            },
          },
        ],
      };
    }
  );

  const comparePageVisualsInputSchema = {
    sourceUrl: z
      .string()
      .optional()
      .describe(PAGE_COMPARE_PARAM_HELP.sourceUrl),
    destinationUrl: z
      .string()
      .optional()
      .describe(PAGE_COMPARE_PARAM_HELP.destinationUrl),
    viewport: z
      .enum(PAGE_COMPARE_VIEWPORTS)
      .optional()
      .describe(PAGE_COMPARE_PARAM_HELP.viewport),
    maxDiffPixelRatio: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(PAGE_COMPARE_PARAM_HELP.maxDiffPixelRatio),
    fullPage: z
      .boolean()
      .optional()
      .describe(PAGE_COMPARE_PARAM_HELP.fullPage),
  };

  registerAppTool(
    server,
    "comparePageVisuals",
    {
      title: "Compare Page Visuals (Step 1)",
      description:
        "Step 1: Compare visual corrections between a source page and a destination page using Playwright (no visual-test server required). Requires sourceUrl and destinationUrl (http/https). If either is missing or invalid, ask the user for the parameters explicitly before calling again. On completion, call openPageComparisonReport (Step 2).",
      inputSchema: comparePageVisualsInputSchema,
      _meta: { ui: {} },
    },
    async (params): Promise<CallToolResult> => {
      const args = parseComparePageVisualsArgs(params);
      const validated = validateComparePageVisualsArgs(args);

      if (!validated.ok) {
        return buildMissingParametersResponse(validated.missing, validated.errors);
      }

      const { sourceUrl, destinationUrl, viewport, maxDiffPixelRatio, fullPage } = validated;

      pageComparisonRunning = true;
      lastPageComparisonReport = undefined;
      lastPageComparisonForResource = undefined;

      const pgOrigin = pixelGuardOrigin.replace(/\/$/, "");

      try {
        const data = await comparePages({
          sourceUrl,
          destinationUrl,
          viewport,
          maxDiffPixelRatio,
          fullPage,
        });

        const reportId = data.reportId;
        const reportUrl = `${pgOrigin}/page-comparison-reports/${reportId}/manifest.json`;
        const manifest = { ...data, reportUrl, reportBasePath: data.reportBasePath };

        lastPageComparisonReport = { reportId, reportUrl, manifest };
        lastPageComparisonForResource = lastPageComparisonReport;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                status: data.status,
                summary: data.summary,
                diffPixelCount: data.diffPixelCount,
                diffPixelRatio: data.diffPixelRatio,
                maxDiffPixelRatio: data.maxDiffPixelRatio,
                sourceUrl: data.sourceUrl,
                destinationUrl: data.destinationUrl,
                viewport: data.viewport,
                viewportName: data.viewportName,
                reportId,
                reportUrl,
                reportBasePath: data.reportBasePath,
                pageComparisonResourceUri,
                nextStep: "Call openPageComparisonReport to open the comparison report view.",
              }),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const needsBrowser =
          /executable doesn't exist|browser.*not found|Failed to launch/i.test(message);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "Page comparison failed",
                details: message,
                hint: needsBrowser
                  ? "Install Playwright Chromium: cd mcp-apps/pixel-guard && npm run playwright:install"
                  : "Check that both URLs are reachable and return valid pages.",
              }),
            },
          ],
          isError: true,
        };
      } finally {
        pageComparisonRunning = false;
      }
    }
  );

  registerAppTool(
    server,
    "openPageComparisonReport",
    {
      title: "Open Page Comparison Report (Step 2)",
      description:
        "Step 2: Call this after comparePageVisuals has completed to open the page comparison report view. Returns report URL and resource URI.",
      inputSchema: {
        reportId: z.string().optional().describe("Report ID from comparePageVisuals (uses latest if omitted)"),
      },
      _meta: { ui: { resourceUri: pageComparisonResourceUri } },
    },
    async (params): Promise<CallToolResult> => {
      type Args = { reportId?: string };
      const raw = params as unknown;
      const args: Args =
        typeof raw === "object" && raw !== null
          ? "reportId" in raw
            ? (raw as Args)
            : "arguments" in raw
              ? ((raw as { arguments?: Args }).arguments ?? {})
              : {}
          : {};

      const report = lastPageComparisonReport;
      lastPageComparisonForResource = report;

      const hasReport = Boolean(report?.reportUrl);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              hasReport,
              reportId: report?.reportId ?? null,
              reportUrl: report?.reportUrl ?? null,
              manifest: report?.manifest ?? null,
              pageComparisonResourceUri: hasReport ? pageComparisonResourceUri : null,
              message: hasReport
                ? "Open the page comparison view using pageComparisonResourceUri."
                : "No page comparison report available. Run comparePageVisuals first, then call this tool again.",
            }),
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
      const pgOrigin = pixelGuardOrigin.replace(/\/$/, "");
      const reportUrl = `${pgOrigin}/playwright-report/index.html`;
      const reportPath = PLAYWRIGHT_REPORT_INDEX;
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
                  reportPath,
                  repoRoot: REPO_ROOT,
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
                reportPath,
                reportDir: PLAYWRIGHT_REPORT_DIR,
                repoRoot: REPO_ROOT,
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
                reportPath,
                repoRoot: REPO_ROOT,
                hint: "Ensure the visual test server is running (e.g. npm run test:visual:server from repo root). The HTML report is written under playwright-report/ in the site repo.",
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
              reportPath: PLAYWRIGHT_REPORT_INDEX,
              reportDir: PLAYWRIGHT_REPORT_DIR,
              repoRoot: REPO_ROOT,
              reportResourceUri: hasReport ? reportResourceUri : null,
              message: hasReport
                ? "Open the report view using reportResourceUri, or open reportUrl in a new tab. Report files live in the site repo under playwright-report/."
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
    "compare-page-visuals",
    {
      title: "Compare Page Visuals",
      description:
        "Compare visual corrections between two page URLs. If sourceUrl or destinationUrl are not provided, ask the user for them explicitly before running tools. Two steps: (1) comparePageVisuals, (2) openPageComparisonReport.",
      argsSchema: {
        sourceUrl: z.string().optional().describe(PAGE_COMPARE_PARAM_HELP.sourceUrl),
        destinationUrl: z
          .string()
          .optional()
          .describe(PAGE_COMPARE_PARAM_HELP.destinationUrl),
        viewport: z
          .enum(PAGE_COMPARE_VIEWPORTS)
          .optional()
          .describe(PAGE_COMPARE_PARAM_HELP.viewport),
      },
    },
    async (args) => {
      const validated = validateComparePageVisualsArgs({
        sourceUrl: args.sourceUrl,
        destinationUrl: args.destinationUrl,
        viewport: args.viewport,
      });

      if (!validated.ok) {
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: buildComparePagePromptAskUserMessage(
                  validated.missing,
                  validated.errors
                ),
              },
            },
          ],
        };
      }

      const { sourceUrl, destinationUrl, viewport } = validated;
      const viewportArg = viewport !== "desktop" ? `, viewport "${viewport}"` : "";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Compare visual corrections between two pages:
- Source (baseline): ${sourceUrl}
- Destination (corrected): ${destinationUrl}

1. Call comparePageVisuals with sourceUrl "${sourceUrl}", destinationUrl "${destinationUrl}"${viewportArg}.
2. If comparePageVisuals returns action "request_parameters", ask the user for the missing values and do not proceed until both URLs are provided.
3. When comparison completes, summarize pass/fail, diff pixel ratio, and summary from the tool result.
4. Call openPageComparisonReport to open the interactive report (source, destination, diff images).
5. If the comparison failed, suggest likely correction areas based on the diff — do not invent metrics not present in the tool output.`,
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
