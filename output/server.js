#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import * as z from "zod";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE, } from "@modelcontextprotocol/ext-apps/server";
import { captureComponentScreenshots, inventoryPageComponents, importComponentInventoryFromCsv, writeComponentInventoryCsvTemplate, readBundledComponentInventoryTemplate, validateComponentWorkflow, COMPONENT_INVENTORY_CSV_FILENAME, COMPONENT_INVENTORY_TEMPLATES_DIR, COMPONENT_INVENTORY_TEMPLATE_RESOURCE_URI, PAGE_COMPARE_VIEWPORTS as COMPONENT_VIEWPORTS, } from "./component-workflow.js";
import { comparePages, PAGE_COMPARE_VIEWPORTS, } from "./compare-pages.js";
import { DIST_DIR, getPageComparisonReportUrl, getReportArtifactUrl, PLAYWRIGHT_REPORT_DIR, PLAYWRIGHT_REPORT_INDEX, PROJECT_ROOT, } from "./paths.js";
const isStdioMode = !process.argv.includes("--http");
const DEFAULT_BASE_URL = process.env.VISUAL_TEST_BASE_URL ?? "http://localhost:3000";
const VISUAL_TEST_SERVER_URL = (process.env.VISUAL_TEST_SERVER_URL ?? "http://localhost:3001").replace(/\/$/, "");
const TEMPLATES_PATH = "/tools/sidekick/library/templates/";
/** Last Playwright report URL from a successful runVisualTest; used by the report resource. */
let lastPlaywrightReportUrl;
/** True while runVisualTest is executing (API call + delay). Report view uses this to wait before rendering. */
let visualTestRunning = false;
/** Last page comparison report from comparePageVisuals. */
let lastPageComparisonReport;
/** True while comparePageVisuals is executing. */
let pageComparisonRunning = false;
/** Called by main.ts GET /api/last-report so the report page can poll until test completes. */
export function getLastReportStatus() {
    return { url: lastPlaywrightReportUrl, running: visualTestRunning };
}
/** Called by main.ts GET /api/last-page-comparison for the page comparison report UI. */
export function getLastPageComparisonStatus() {
    return { report: lastPageComparisonReport, running: pageComparisonRunning };
}
/** Delay (ms) to wait after test run so Playwright can finish writing the HTML report. */
const REPORT_READY_DELAY_MS = Math.max(0, parseInt(process.env.VISUAL_TEST_REPORT_READY_DELAY_MS ?? "2500", 10) || 2500);
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
const PAGE_COMPARE_PARAM_HELP = {
    sourceUrl: "Baseline page URL before visual corrections (must be http or https), e.g. https://www.example.com/page-before",
    destinationUrl: "Corrected page URL after visual corrections (must be http or https), e.g. https://www.example.com/page-after",
    viewport: `Viewport preset: ${PAGE_COMPARE_VIEWPORTS.join(", ")} (optional, default: desktop)`,
    maxDiffPixelRatio: "Maximum allowed pixel diff ratio from 0 to 1 (optional, default: 0.01 = 1%)",
    fullPage: "Capture full-page screenshots (optional, default: true)",
};
function parseComparePageVisualsArgs(raw) {
    if (typeof raw !== "object" || raw === null)
        return {};
    if ("sourceUrl" in raw || "destinationUrl" in raw) {
        return raw;
    }
    if ("arguments" in raw) {
        const nested = raw.arguments;
        return nested ?? {};
    }
    return {};
}
function validateHttpUrl(value, field) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed)
        return `${field} is required`;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return `${field} must use http or https`;
        }
        return null;
    }
    catch {
        return `${field} must be a valid URL`;
    }
}
function buildMissingParametersResponse(missing, errors) {
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
function validateComparePageVisualsArgs(args) {
    const missing = [];
    const errors = [];
    const sourceUrl = typeof args.sourceUrl === "string" ? args.sourceUrl.trim() : "";
    const destinationUrl = typeof args.destinationUrl === "string" ? args.destinationUrl.trim() : "";
    if (!sourceUrl)
        missing.push("sourceUrl");
    else {
        const sourceErr = validateHttpUrl(sourceUrl, "sourceUrl");
        if (sourceErr)
            errors.push(sourceErr);
    }
    if (!destinationUrl)
        missing.push("destinationUrl");
    else {
        const destErr = validateHttpUrl(destinationUrl, "destinationUrl");
        if (destErr)
            errors.push(destErr);
    }
    if (sourceUrl && destinationUrl && sourceUrl === destinationUrl) {
        errors.push("sourceUrl and destinationUrl must be different pages");
    }
    let viewport = "desktop";
    if (args.viewport !== undefined && args.viewport !== "") {
        const v = String(args.viewport).toLowerCase();
        if (!PAGE_COMPARE_VIEWPORTS.includes(v)) {
            errors.push(`viewport must be one of: ${PAGE_COMPARE_VIEWPORTS.join(", ")} (got "${args.viewport}")`);
        }
        else {
            viewport = v;
        }
    }
    let maxDiffPixelRatio = 0.01;
    if (args.maxDiffPixelRatio !== undefined) {
        const ratio = args.maxDiffPixelRatio;
        if (typeof ratio !== "number" || Number.isNaN(ratio) || ratio < 0 || ratio > 1) {
            errors.push("maxDiffPixelRatio must be a number between 0 and 1");
        }
        else {
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
function buildComparePagePromptAskUserMessage(missing, errors) {
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
    parts.push("", "Reply with the URLs (and optional viewport). I will then run comparePageVisuals and openPageComparisonReport.");
    return parts.join("\n");
}
const SNAPSHOTS_PATH = "/tools/visual-tests/visual.spec.js-snapshots";
function buildLibraryUrl(blockName, baseUrl, variationIndex) {
    const block = blockName.toLowerCase().trim().replace(/\s+/g, "-");
    const pathSeg = `${TEMPLATES_PATH}${block}`;
    const origin = baseUrl.replace(/\/$/, "");
    return `${origin}/tools/sidekick/library.html?plugin=blocks&path=${encodeURIComponent(pathSeg)}&index=${variationIndex}&vtest=true`;
}
function buildSnapshotUrl(blockName, baseUrl, variationIndex, viewport) {
    const block = blockName.toLowerCase().trim().replace(/\s+/g, "-");
    const viewportLabel = viewport.length > 0
        ? viewport.charAt(0).toUpperCase() + viewport.slice(1).toLowerCase()
        : "Desktop";
    const fileName = `${block}-${variationIndex}-${viewportLabel}.png`;
    const origin = baseUrl.replace(/\/$/, "");
    return `${origin}${SNAPSHOTS_PATH}/${fileName}`;
}
/** Fetch image from URL and return base64 string, or undefined on failure. */
async function fetchImageAsBase64(url) {
    try {
        const res = await fetch(url, { headers: { Accept: "image/*" } });
        if (!res.ok)
            return undefined;
        const buf = await res.arrayBuffer();
        const b64 = Buffer.from(buf).toString("base64");
        return b64;
    }
    catch {
        return undefined;
    }
}
export function createServer() {
    const server = new McpServer({
        name: "Pixel Guard - UI Visual Validator",
        version: "1.0.0",
    });
    const resourceUri = "ui://pixel-guard/pixel-guard.html";
    const pixelGuardOrigin = process.env.PIXEL_GUARD_ORIGIN ??
        (isStdioMode ? "" : `http://localhost:${process.env.PORT ?? "3003"}`);
    const visualTestOrigin = (process.env.VISUAL_TEST_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    const resourceDomains = [
        pixelGuardOrigin.replace(/\/$/, ""),
        visualTestOrigin,
        VISUAL_TEST_SERVER_URL,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ].filter((origin, i, arr) => Boolean(origin) && arr.indexOf(origin) === i);
    // Same origins for nested iframes (library page loads in iframe; maps to CSP frame-src)
    const frameDomains = [...resourceDomains];
    // Resource: The built HTML file (Pixel Guard UI with overlay)
    // Request CSP so the host allows images (resourceDomains) and iframe (frameDomains) from localhost:3000
    registerAppResource(server, resourceUri, resourceUri, { mimeType: RESOURCE_MIME_TYPE }, async () => {
        const html = await fs.readFile(path.join(DIST_DIR, "pixel-guard.html"), "utf-8");
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
    });
    server.registerResource("component-inventory-template", COMPONENT_INVENTORY_TEMPLATE_RESOURCE_URI, {
        description: "Bundled CSV template for component inventory. Columns: pageUrl|componentName|selector. Fill rows, copy to PROJECT_ROOT/templates/, then call importComponentInventoryFromCsv.",
        mimeType: "text/csv",
    }, async () => {
        const text = await readBundledComponentInventoryTemplate();
        return {
            contents: [
                {
                    uri: COMPONENT_INVENTORY_TEMPLATE_RESOURCE_URI,
                    mimeType: "text/csv",
                    text,
                },
            ],
        };
    });
    const reportResourceUri = "ui://pixel-guard/playwright-report.html";
    const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const pgOriginClean = pixelGuardOrigin.replace(/\/$/, "");
    const reportResourceDomains = [pgOriginClean, VISUAL_TEST_SERVER_URL, ...resourceDomains];
    // Resource: Playwright report viewer – waits for test to complete (like visual-test.js), then renders report
    registerAppResource(server, reportResourceUri, reportResourceUri, { mimeType: RESOURCE_MIME_TYPE }, async () => {
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
    });
    const pageComparisonResourceUri = "ui://pixel-guard/page-comparison-report.html";
    let lastPageComparisonForResource;
    registerAppResource(server, pageComparisonResourceUri, pageComparisonResourceUri, { mimeType: RESOURCE_MIME_TYPE }, async () => {
        const report = lastPageComparisonForResource ?? lastPageComparisonReport;
        const manifest = report?.manifest ?? {};
        const reportUrl = report?.reportUrl ?? "";
        const safeUrl = escapeAttr(reportUrl);
        const safeOrigin = escapeAttr(pixelGuardOrigin.replace(/\/$/, ""));
        const status = typeof manifest.status === "string" ? manifest.status : "";
        const summary = typeof manifest.summary === "string" ? manifest.summary : "";
        const sourceUrl = typeof manifest.sourceUrl === "string" ? manifest.sourceUrl : "";
        const destinationUrl = typeof manifest.destinationUrl === "string" ? manifest.destinationUrl : "";
        const diffRatio = typeof manifest.diffPixelRatio === "number"
            ? (manifest.diffPixelRatio * 100).toFixed(2)
            : "—";
        const basePath = typeof manifest.reportBasePath === "string" ? manifest.reportBasePath : "";
        const reportDir = typeof manifest.reportDir === "string" ? manifest.reportDir : "";
        const pgOrigin = pixelGuardOrigin.replace(/\/$/, "");
        const httpImgBase = pgOrigin && basePath ? `${pgOrigin}${basePath}` : "";
        async function reportImageSrc(filename) {
            if (httpImgBase) {
                return `${httpImgBase}/${filename}`;
            }
            if (!reportDir)
                return "";
            try {
                const buf = await fs.readFile(path.join(reportDir, filename));
                return `data:image/png;base64,${buf.toString("base64")}`;
            }
            catch {
                return "";
            }
        }
        const [sourceImgSrc, destinationImgSrc, diffImgSrc] = reportUrl
            ? await Promise.all([
                reportImageSrc("source.png"),
                reportImageSrc("destination.png"),
                reportImageSrc("diff.png"),
            ])
            : ["", "", ""];
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
          <div class="panel"><h2>Source (baseline)</h2><img src="${escapeAttr(sourceImgSrc)}" alt="Source" /></div>
          <div class="panel"><h2>Destination (corrected)</h2><img src="${escapeAttr(destinationImgSrc)}" alt="Destination" /></div>
          <div class="panel"><h2>Diff</h2><img src="${escapeAttr(diffImgSrc)}" alt="Diff" /></div>
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
    });
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
    registerAppTool(server, "comparePageVisuals", {
        title: "Compare Page Visuals (Step 1)",
        description: "Step 1: Compare visual corrections between a source page and a destination page using Playwright (no visual-test server required). Requires sourceUrl and destinationUrl (http/https). If either is missing or invalid, ask the user for the parameters explicitly before calling again. On completion, call openPageComparisonReport (Step 2).",
        inputSchema: comparePageVisualsInputSchema,
        _meta: { ui: {} },
    }, async (params) => {
        const args = parseComparePageVisualsArgs(params);
        const validated = validateComparePageVisualsArgs(args);
        if (!validated.ok) {
            return buildMissingParametersResponse(validated.missing, validated.errors);
        }
        const { sourceUrl, destinationUrl, viewport, maxDiffPixelRatio, fullPage } = validated;
        pageComparisonRunning = true;
        lastPageComparisonReport = undefined;
        lastPageComparisonForResource = undefined;
        try {
            const data = await comparePages({
                sourceUrl,
                destinationUrl,
                viewport,
                maxDiffPixelRatio,
                fullPage,
            });
            const reportId = data.reportId;
            const reportUrl = getPageComparisonReportUrl(reportId, data.reportDir);
            const manifest = {
                ...data,
                reportUrl,
                reportBasePath: data.reportBasePath,
                projectRoot: PROJECT_ROOT,
            };
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
                            reportDir: data.reportDir,
                            projectRoot: PROJECT_ROOT,
                            reportBasePath: data.reportBasePath,
                            pageComparisonResourceUri,
                            nextStep: "Call openPageComparisonReport to open the comparison report view.",
                        }),
                    },
                ],
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const needsBrowser = /executable doesn't exist|browser.*not found|Failed to launch/i.test(message);
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
        }
        finally {
            pageComparisonRunning = false;
        }
    });
    registerAppTool(server, "openPageComparisonReport", {
        title: "Open Page Comparison Report (Step 2)",
        description: "Step 2: Call this after comparePageVisuals has completed to open the page comparison report view. Returns report URL and resource URI.",
        inputSchema: {
            reportId: z.string().optional().describe("Report ID from comparePageVisuals (uses latest if omitted)"),
        },
        _meta: { ui: { resourceUri: pageComparisonResourceUri } },
    }, async (params) => {
        const raw = params;
        const args = typeof raw === "object" && raw !== null
            ? "reportId" in raw
                ? raw
                : "arguments" in raw
                    ? (raw.arguments ?? {})
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
    });
    const captureComponentScreenshotsInputSchema = {
        inventoryId: z
            .string()
            .optional()
            .describe("Inventory ID from inventoryPageComponents (recommended). Captures using stored selectors."),
        componentIds: z
            .array(z.string())
            .optional()
            .describe("Subset of inventory component ids to capture (e.g. hero-0, cards-1)"),
        captureReportId: z
            .string()
            .optional()
            .describe("Existing component-capture-* report id. Pass from prior batch to append PNGs to the same folder."),
        batchIndex: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Zero-based batch index (default 0). For 13 components with batchSize 4, call batchIndex 0..3."),
        batchSize: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe("Components per batch (default 4). Keeps each tool call under MCP timeout."),
        pageUrl: z
            .string()
            .optional()
            .describe("Page URL (legacy one-step mode when inventoryId omitted). Runs inventory + capture together."),
        components: z
            .array(z.string())
            .optional()
            .describe("Component/block names for inventory (e.g. hero, cards). Omit to auto-discover all EDS blocks."),
        viewport: z
            .enum(PAGE_COMPARE_VIEWPORTS)
            .optional()
            .describe(`Viewport preset: ${PAGE_COMPARE_VIEWPORTS.join(", ")} (optional, default: desktop)`),
    };
    const inventoryPageComponentsInputSchema = {
        pageUrl: z
            .string()
            .optional()
            .describe("Page URL to analyze (must be http or https)"),
        components: z
            .array(z.string())
            .optional()
            .describe("Component/block names to inventory. Omit to auto-discover all EDS blocks on the page."),
        viewport: z
            .enum(PAGE_COMPARE_VIEWPORTS)
            .optional()
            .describe(`Viewport preset: ${PAGE_COMPARE_VIEWPORTS.join(", ")} (optional, default: desktop)`),
    };
    registerAppTool(server, "inventoryPageComponents", {
        title: "Inventory Page Components (Step 1)",
        description: "Step 1: Analyze a page and build a component inventory with selectors, bounding boxes, and confidence scores. Writes inventory.json and overview.png to PROJECT_ROOT/<inventory-id>/. Call captureComponentScreenshots (Step 2) to screenshot from the inventory.",
        inputSchema: inventoryPageComponentsInputSchema,
        _meta: { ui: {} },
    }, async (params) => {
        const raw = params;
        const args = typeof raw === "object" && raw !== null && "pageUrl" in raw
            ? raw
            : ("arguments" in raw ? raw.arguments ?? {} : {});
        const pageUrl = typeof args.pageUrl === "string" ? args.pageUrl.trim() : "";
        if (!pageUrl) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            action: "request_parameters",
                            missingParameters: ["pageUrl"],
                            message: "pageUrl is required to inventory page components.",
                        }),
                    },
                ],
                isError: true,
            };
        }
        let viewport = "desktop";
        if (args.viewport) {
            const v = String(args.viewport).toLowerCase();
            if (!PAGE_COMPARE_VIEWPORTS.includes(v)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: `viewport must be one of: ${PAGE_COMPARE_VIEWPORTS.join(", ")}`,
                            }),
                        },
                    ],
                    isError: true,
                };
            }
            viewport = v;
        }
        const components = Array.isArray(args.components)
            ? args.components.filter((c) => typeof c === "string" && c.trim())
            : undefined;
        try {
            const data = await inventoryPageComponents({ pageUrl, components, viewport });
            const inventoryUrl = getReportArtifactUrl(data.inventoryId, data.reportDir, "inventory.json");
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            summary: data.summary,
                            inventoryId: data.inventoryId,
                            inventoryUrl,
                            reportDir: data.reportDir,
                            reportBasePath: data.reportBasePath,
                            projectRoot: data.projectRoot,
                            pageUrl: data.pageUrl,
                            discoveryMode: data.discoveryMode,
                            viewport: data.viewport,
                            viewportName: data.viewportName,
                            components: data.components,
                            nextStep: "Review inventory.json, then call captureComponentScreenshots with inventoryId. Call validateComponentWorkflow with inventoryId to check completeness.",
                        }),
                    },
                ],
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const needsBrowser = /executable doesn't exist|browser.*not found|Failed to launch/i.test(message);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            error: "Component inventory failed",
                            details: message,
                            hint: needsBrowser
                                ? "Install Playwright Chromium: npm run playwright:install"
                                : "Check that the page URL is reachable.",
                        }),
                    },
                ],
                isError: true,
            };
        }
    });
    const defaultComponentInventoryCsvPath = path.join(COMPONENT_INVENTORY_TEMPLATES_DIR, COMPONENT_INVENTORY_CSV_FILENAME);
    const getComponentInventoryCsvTemplateInputSchema = {
        outputPath: z
            .string()
            .optional()
            .describe(`Optional path for the template CSV. Default: PROJECT_ROOT/${defaultComponentInventoryCsvPath}`),
        overwrite: z
            .boolean()
            .optional()
            .describe("Overwrite an existing template file (default: false)"),
    };
    const importComponentInventoryFromCsvInputSchema = {
        csvPath: z
            .string()
            .optional()
            .describe(`Path to filled CSV. Default: PROJECT_ROOT/${defaultComponentInventoryCsvPath}`),
        csvContent: z
            .string()
            .optional()
            .describe("Filled CSV content (pageUrl|componentName|selector). Use when not writing a file."),
        viewport: z
            .enum(PAGE_COMPARE_VIEWPORTS)
            .optional()
            .describe(`Viewport preset: ${PAGE_COMPARE_VIEWPORTS.join(", ")} (optional, default: desktop)`),
    };
    registerAppTool(server, "getComponentInventoryCsvTemplate", {
        title: "Get Component Inventory CSV Template",
        description: `Copy bundled CSV template to PROJECT_ROOT/${defaultComponentInventoryCsvPath}. Template is also exposed as MCP resource ${COMPONENT_INVENTORY_TEMPLATE_RESOURCE_URI}.`,
        inputSchema: getComponentInventoryCsvTemplateInputSchema,
        _meta: { ui: {} },
    }, async (params) => {
        const raw = params;
        const args = typeof raw === "object" && raw !== null
            ? ("arguments" in raw ? raw.arguments ?? raw : raw)
            : {};
        try {
            const { templatePath, content, resourceUri } = await writeComponentInventoryCsvTemplate({
                outputPath: args.outputPath,
                overwrite: args.overwrite === true,
            });
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            templatePath,
                            resourceUri,
                            projectRoot: PROJECT_ROOT,
                            columns: ["pageUrl", "componentName", "selector"],
                            delimiter: "|",
                            content,
                            nextStep: `Read resource ${resourceUri}, fill rows, copy to ${defaultComponentInventoryCsvPath}, then call importComponentInventoryFromCsv.`,
                        }),
                    },
                ],
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            error: "Failed to write component inventory CSV template",
                            details: message,
                        }),
                    },
                ],
                isError: true,
            };
        }
    });
    registerAppTool(server, "importComponentInventoryFromCsv", {
        title: "Import Component Inventory from CSV",
        description: "Import a filled CSV (pageUrl|componentName|selector), validate selectors on each page, and write inventory.json. Then call captureComponentScreenshots with the returned inventoryId.",
        inputSchema: importComponentInventoryFromCsvInputSchema,
        _meta: { ui: {} },
    }, async (params) => {
        const raw = params;
        const args = typeof raw === "object" && raw !== null
            ? ("arguments" in raw ? raw.arguments ?? raw : raw)
            : {};
        const csvPath = typeof args.csvPath === "string" ? args.csvPath.trim() : "";
        const csvContent = typeof args.csvContent === "string" ? args.csvContent : "";
        let viewport = "desktop";
        if (args.viewport) {
            const v = String(args.viewport).toLowerCase();
            if (!PAGE_COMPARE_VIEWPORTS.includes(v)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: `viewport must be one of: ${PAGE_COMPARE_VIEWPORTS.join(", ")}`,
                            }),
                        },
                    ],
                    isError: true,
                };
            }
            viewport = v;
        }
        try {
            const data = await importComponentInventoryFromCsv({
                csvPath: csvPath || undefined,
                csvContent: csvContent.trim() || undefined,
                viewport,
            });
            const inventoryUrl = getReportArtifactUrl(data.inventoryId, data.reportDir, "inventory.json");
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            summary: data.summary,
                            inventoryId: data.inventoryId,
                            inventoryUrl,
                            reportDir: data.reportDir,
                            projectRoot: data.projectRoot,
                            pageUrl: data.pageUrl,
                            discoveryMode: data.discoveryMode,
                            viewport: data.viewport,
                            viewportName: data.viewportName,
                            components: data.components,
                            nextStep: "Call captureComponentScreenshots with inventoryId, then validateComponentWorkflow with inventoryId and captureReportId.",
                        }),
                    },
                ],
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const needsBrowser = /executable doesn't exist|browser.*not found|Failed to launch/i.test(message);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            error: "CSV inventory import failed",
                            details: message,
                            hint: needsBrowser
                                ? "Install Playwright Chromium: npm run playwright:install"
                                : "Check CSV format and selectors.",
                        }),
                    },
                ],
                isError: true,
            };
        }
    });
    registerAppTool(server, "captureComponentScreenshots", {
        title: "Capture Component Screenshots (Step 2)",
        description: "Step 2: Capture component screenshots from inventory. Large inventories are captured in batches (default 4 per call) — use batchIndex and captureReportId from the prior response until hasMoreBatches is false.",
        inputSchema: captureComponentScreenshotsInputSchema,
        _meta: { ui: {} },
    }, async (params) => {
        const raw = params;
        const args = typeof raw === "object" &&
            raw !== null &&
            ("inventoryId" in raw || "pageUrl" in raw || "componentIds" in raw)
            ? raw
            : ("arguments" in raw ? raw.arguments ?? {} : {});
        const inventoryId = typeof args.inventoryId === "string" ? args.inventoryId.trim() : "";
        const pageUrl = typeof args.pageUrl === "string" ? args.pageUrl.trim() : "";
        if (!inventoryId && !pageUrl) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            action: "request_parameters",
                            missingParameters: ["inventoryId"],
                            message: "inventoryId (from inventoryPageComponents) is required, or pass pageUrl for legacy one-step capture.",
                        }),
                    },
                ],
                isError: true,
            };
        }
        if (!inventoryId && pageUrl) {
            try {
                new URL(pageUrl);
            }
            catch {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: "pageUrl must be a valid http or https URL",
                            }),
                        },
                    ],
                    isError: true,
                };
            }
        }
        let viewport = "desktop";
        if (args.viewport) {
            const v = String(args.viewport).toLowerCase();
            if (!PAGE_COMPARE_VIEWPORTS.includes(v)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: `viewport must be one of: ${PAGE_COMPARE_VIEWPORTS.join(", ")}`,
                            }),
                        },
                    ],
                    isError: true,
                };
            }
            viewport = v;
        }
        const components = Array.isArray(args.components)
            ? args.components.filter((c) => typeof c === "string" && c.trim())
            : undefined;
        const componentIds = Array.isArray(args.componentIds)
            ? args.componentIds.filter((c) => typeof c === "string" && c.trim())
            : undefined;
        const batchIndex = typeof args.batchIndex === "number" && Number.isFinite(args.batchIndex)
            ? Math.max(0, Math.floor(args.batchIndex))
            : undefined;
        const batchSize = typeof args.batchSize === "number" && Number.isFinite(args.batchSize)
            ? Math.max(1, Math.floor(args.batchSize))
            : undefined;
        const captureReportId = typeof args.captureReportId === "string" ? args.captureReportId.trim() : undefined;
        try {
            const data = await captureComponentScreenshots({
                inventoryId: inventoryId || undefined,
                componentIds,
                captureReportId: captureReportId || undefined,
                batchIndex,
                batchSize,
                pageUrl: pageUrl || undefined,
                components,
                viewport,
            });
            const reportUrl = getPageComparisonReportUrl(data.reportId, data.reportDir);
            const nextStep = data.hasMoreBatches
                ? `Call captureComponentScreenshots with inventoryId "${data.inventoryId}", captureReportId "${data.reportId}", batchIndex ${(data.batchIndex ?? 0) + 1}, batchSize ${data.batchSize ?? 4}. Remaining: ${data.remainingComponentIds?.join(", ")}`
                : "Call validateComponentWorkflow with inventoryId and captureReportId to verify captures.";
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            summary: data.summary,
                            reportId: data.reportId,
                            inventoryId: data.inventoryId,
                            reportUrl,
                            reportDir: data.reportDir,
                            reportBasePath: data.reportBasePath,
                            projectRoot: data.projectRoot,
                            pageUrl: data.pageUrl,
                            viewport: data.viewport,
                            viewportName: data.viewportName,
                            components: data.components,
                            batchedCapture: data.batchedCapture,
                            batchIndex: data.batchIndex,
                            totalBatches: data.totalBatches,
                            batchSize: data.batchSize,
                            hasMoreBatches: data.hasMoreBatches,
                            remainingComponentIds: data.remainingComponentIds,
                            nextStep,
                        }),
                    },
                ],
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const needsBrowser = /executable doesn't exist|browser.*not found|Failed to launch/i.test(message);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            error: "Component screenshot capture failed",
                            details: message,
                            hint: needsBrowser
                                ? "Install Playwright Chromium: npm run playwright:install"
                                : "Check that the page URL is reachable.",
                        }),
                    },
                ],
                isError: true,
            };
        }
    });
    const validateComponentWorkflowInputSchema = {
        inventoryId: z
            .string()
            .min(1)
            .describe("Inventory folder id from Step 1 (e.g. component-inventory-<timestamp>)"),
        captureReportId: z
            .string()
            .optional()
            .describe("Capture folder id from Step 2 (e.g. component-capture-<timestamp>)"),
        writeReport: z
            .boolean()
            .optional()
            .describe("Write validation-report.json under inventory/capture dirs (default: true)"),
    };
    registerAppTool(server, "validateComponentWorkflow", {
        title: "Validate Component Workflow",
        description: "Feedback loop: validate inventory completeness (selectors, visibility, bounding boxes) and optionally capture outputs (PNG files, coverage vs inventory). Writes validation-report.json with issues and next steps.",
        inputSchema: validateComponentWorkflowInputSchema,
        _meta: { ui: {} },
    }, async (params) => {
        const raw = params;
        const args = typeof raw === "object" && raw !== null && "inventoryId" in raw
            ? raw
            : ("arguments" in raw ? raw.arguments ?? {} : {});
        const inventoryId = typeof args.inventoryId === "string" ? args.inventoryId.trim() : "";
        if (!inventoryId) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            action: "request_parameters",
                            missingParameters: ["inventoryId"],
                            message: "inventoryId is required.",
                        }),
                    },
                ],
                isError: true,
            };
        }
        try {
            const data = await validateComponentWorkflow({
                inventoryId,
                captureReportId: typeof args.captureReportId === "string" ? args.captureReportId.trim() : undefined,
                writeReport: args.writeReport !== false,
            });
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            complete: data.complete,
                            inventoryId: data.inventoryId,
                            captureReportId: data.captureReportId,
                            validationReportPath: data.validationReportPath,
                            inventory: data.inventory,
                            capture: data.capture,
                            nextSteps: data.nextSteps,
                        }),
                    },
                ],
                isError: !data.complete,
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            error: "Component workflow validation failed",
                            details: message,
                        }),
                    },
                ],
                isError: true,
            };
        }
    });
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
    server.registerTool("getBlockSnapshot", {
        title: "Get Block Snapshot",
        description: "Returns the baseline snapshot image for a block as base64 (for use in Pixel Guard UI under strict CSP).",
        inputSchema: getBlockSnapshotInputSchema,
    }, async (params) => {
        const raw = params;
        const args = "blockName" in raw && typeof raw.blockName === "string"
            ? raw
            : ("arguments" in raw ? raw.arguments ?? {} : {});
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
    });
    const runVisualTestInputSchema = {
        blockName: z
            .string()
            .min(1, "blockName is required")
            .describe("Block name to run visual test for (e.g. tabs, cards, hero)"),
    };
    registerAppTool(server, "runVisualTest", {
        title: "Run Visual Test (Step 1)",
        description: "Step 1: Run the Playwright visual test for a block by name. Requires the visual test server to be running (e.g. npm run test:visual:server). Upon completion, call openVisualTestReport (Step 2) to open the report UI.",
        inputSchema: runVisualTestInputSchema,
        _meta: { ui: {} },
    }, async (params) => {
        const raw = params;
        const args = typeof raw === "object" &&
            raw !== null &&
            "blockName" in raw &&
            typeof raw.blockName === "string"
            ? raw
            : (typeof raw === "object" && raw !== null && "arguments" in raw
                ? raw.arguments
                : undefined) ?? {};
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
            const data = (await res.json());
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
                                repoRoot: PROJECT_ROOT,
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
                            repoRoot: PROJECT_ROOT,
                            blockName,
                            component,
                            reportResourceUri,
                            nextStep: "Call openVisualTestReport to open the report view.",
                        }),
                    },
                ],
            };
        }
        catch (err) {
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
                            repoRoot: PROJECT_ROOT,
                            hint: "Ensure the visual test server is running (e.g. npm run test:visual:server from repo root). The HTML report is written under playwright-report/ in the site repo.",
                        }),
                    },
                ],
                isError: true,
            };
        }
        finally {
            visualTestRunning = false;
        }
    });
    // Step 2: Call after runVisualTest completes; opens the report UI.
    registerAppTool(server, "openVisualTestReport", {
        title: "Open Visual Test Report (Step 2)",
        description: "Step 2: Call this after runVisualTest has completed to open the Playwright report view. Returns report URL and resource URI. Opens the report UI when invoked.",
        inputSchema: {},
        _meta: { ui: { resourceUri: reportResourceUri } },
    }, async () => {
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
                        repoRoot: PROJECT_ROOT,
                        reportResourceUri: hasReport ? reportResourceUri : null,
                        message: hasReport
                            ? "Open the report view using reportResourceUri, or open reportUrl in a new tab. Report files live in the site repo under playwright-report/."
                            : "No report available. Run runVisualTest for a block first, then call this tool again.",
                    }),
                },
            ],
        };
    });
    server.registerPrompt("run-visual-test", {
        title: "Run Visual Test",
        description: "Run the visual test for a block in two steps: (1) runVisualTest to execute the test, (2) openVisualTestReport to open the report when done.",
        argsSchema: {
            blockName: z.string().min(1).describe("Block name to run visual test for (e.g. tabs, cards, hero)"),
        },
    }, async ({ blockName }) => {
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
    });
    server.registerPrompt("compare-page-visuals", {
        title: "Compare Page Visuals",
        description: "Compare visual corrections between two page URLs. If sourceUrl or destinationUrl are not provided, ask the user for them explicitly before running tools. Two steps: (1) comparePageVisuals, (2) openPageComparisonReport.",
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
    }, async (args) => {
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
                            text: buildComparePagePromptAskUserMessage(validated.missing, validated.errors),
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
    });
    server.registerPrompt("component-inventory-from-csv", {
        title: "Component Inventory from CSV",
        description: "Recommended for production or custom pages: get CSV template, agent fills pageUrl|componentName|selector, import inventory, then capture screenshots.",
        argsSchema: {
            csvPath: z.string().optional().describe("Path to filled CSV"),
            viewport: z
                .enum(COMPONENT_VIEWPORTS)
                .optional()
                .describe(`Viewport: ${COMPONENT_VIEWPORTS.join(", ")}`),
        },
    }, async (args) => {
        const csvPath = typeof args.csvPath === "string" && args.csvPath.trim()
            ? args.csvPath.trim()
            : path.join(COMPONENT_INVENTORY_TEMPLATES_DIR, COMPONENT_INVENTORY_CSV_FILENAME);
        const viewport = args.viewport ?? "desktop";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Build a component inventory from CSV and capture screenshots.

1. Call getComponentInventoryCsvTemplate — writes PROJECT_ROOT/${csvPath}.
2. Or read MCP resource ${COMPONENT_INVENTORY_TEMPLATE_RESOURCE_URI} for the bundled template.
3. Open the target page(s), inspect the DOM, and fill one row per component with a stable CSS selector.
4. Call importComponentInventoryFromCsv${viewport !== "desktop" ? ` with viewport "${viewport}"` : ""} — no csvPath needed when using the default project copy.
5. Review imported components (visible vs missing selectors).
6. Call validateComponentWorkflow with inventoryId — fix any errors (update CSV, re-import).
7. Call captureComponentScreenshots with the returned inventoryId.
8. Call validateComponentWorkflow with inventoryId and captureReportId — re-capture if captures failed.

CSV example:
pageUrl|componentName|selector
https://www.example.com/page|hero|.container_hero-home
https://www.example.com/page|footer|footer.site-footer`,
                    },
                },
            ],
        };
    });
    server.registerPrompt("inventory-page-components", {
        title: "Inventory Page Components",
        description: "Step 1: Analyze a page and build a component inventory. Review inventory.json, then capture screenshots with capture-component-screenshots.",
        argsSchema: {
            pageUrl: z.string().optional().describe("Page URL (http or https)"),
            components: z
                .array(z.string())
                .optional()
                .describe("Component names to inventory. Omit to auto-discover all EDS blocks."),
            viewport: z
                .enum(COMPONENT_VIEWPORTS)
                .optional()
                .describe(`Viewport: ${COMPONENT_VIEWPORTS.join(", ")}`),
        },
    }, async (args) => {
        const pageUrl = typeof args.pageUrl === "string" ? args.pageUrl.trim() : "";
        if (!pageUrl) {
            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Inventory components on a page (Step 1 of 2).

**Required:**
- **pageUrl** — full page URL (http or https)

**Optional:**
- **components** — block names (e.g. hero, cards). Omit to auto-discover all EDS blocks.
- **viewport** — mobile, tablet, desktop (default), or large

Reply with pageUrl and optional components/viewport. I will call inventoryPageComponents and show the inventory for review before capturing screenshots.`,
                        },
                    },
                ],
            };
        }
        const components = Array.isArray(args.components) && args.components.length > 0
            ? args.components
            : undefined;
        const viewport = args.viewport ?? "desktop";
        const componentsLine = components
            ? `components: ${components.join(", ")}`
            : "components: (auto-discover all blocks)";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Inventory page components:
- pageUrl: ${pageUrl}
- ${componentsLine}
- viewport: ${viewport}

1. Call inventoryPageComponents with pageUrl "${pageUrl}"${components ? `, components ${JSON.stringify(components)}` : ""}${viewport !== "desktop" ? `, viewport "${viewport}"` : ""}.
2. Call validateComponentWorkflow with the returned inventoryId; fix issues before capture.
3. Present the inventory summary (component ids, names, confidence, visibility) from the tool result.
4. Ask the user to confirm or select componentIds to capture.
5. Call captureComponentScreenshots with inventoryId from Step 1 (and optional componentIds filter).
6. Call validateComponentWorkflow with inventoryId and captureReportId; re-capture if incomplete.`,
                    },
                },
            ],
        };
    });
    server.registerPrompt("capture-component-screenshots", {
        title: "Capture Component Screenshots",
        description: "Capture component screenshots. Recommended: run inventory-page-components first, then pass inventoryId. Legacy: pass pageUrl for one-step inventory + capture.",
        argsSchema: {
            inventoryId: z
                .string()
                .optional()
                .describe("Inventory ID from inventoryPageComponents (recommended)"),
            componentIds: z
                .array(z.string())
                .optional()
                .describe("Subset of inventory component ids to capture"),
            pageUrl: z.string().optional().describe("Page URL for legacy one-step mode"),
            components: z
                .array(z.string())
                .optional()
                .describe("Component names (legacy one-step mode only)"),
            viewport: z
                .enum(COMPONENT_VIEWPORTS)
                .optional()
                .describe(`Viewport: ${COMPONENT_VIEWPORTS.join(", ")}`),
        },
    }, async (args) => {
        const inventoryId = typeof args.inventoryId === "string" ? args.inventoryId.trim() : "";
        const pageUrl = typeof args.pageUrl === "string" ? args.pageUrl.trim() : "";
        if (!inventoryId && !pageUrl) {
            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Capture component screenshots (Step 2).

**Recommended:** pass **inventoryId** from a prior inventoryPageComponents run.

**Legacy one-step:** pass **pageUrl** (and optional components) to inventory + capture together.

**Optional:**
- **componentIds** — subset of ids to capture (e.g. hero-0, cards-1)
- **viewport** — mobile, tablet, desktop (default), or large

If you have not run inventory yet, use the inventory-page-components prompt first.`,
                        },
                    },
                ],
            };
        }
        const componentIds = Array.isArray(args.componentIds) && args.componentIds.length > 0
            ? args.componentIds
            : undefined;
        const components = Array.isArray(args.components) && args.components.length > 0
            ? args.components
            : undefined;
        const viewport = args.viewport ?? "desktop";
        if (inventoryId) {
            const idsLine = componentIds
                ? `componentIds: ${componentIds.join(", ")}`
                : "componentIds: (all from inventory)";
            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Capture component screenshots from inventory:
- inventoryId: ${inventoryId}
- ${idsLine}
- viewport: ${viewport}

1. Call captureComponentScreenshots with inventoryId "${inventoryId}"${componentIds ? `, componentIds ${JSON.stringify(componentIds)}` : ""}${viewport !== "desktop" ? `, viewport "${viewport}"` : ""} (batchIndex 0, default batchSize 4).
2. While hasMoreBatches is true, repeat with the same captureReportId and increment batchIndex (e.g. 0, 1, 2, 3 for 13 components).
3. Call validateComponentWorkflow with inventoryId and final captureReportId.
4. Report paths: PROJECT_ROOT/component-capture-<timestamp>/ (manifest.json + PNG per component).`,
                        },
                    },
                ],
            };
        }
        const componentsLine = components
            ? `components: ${components.join(", ")}`
            : "components: (auto-discover all blocks)";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Capture component screenshots (legacy one-step):
- pageUrl: ${pageUrl}
- ${componentsLine}
- viewport: ${viewport}

1. Call captureComponentScreenshots with pageUrl "${pageUrl}"${components ? `, components ${JSON.stringify(components)}` : ""}${viewport !== "desktop" ? `, viewport "${viewport}"` : ""}.
2. Summarize captured vs skipped components from the tool result.
3. Report paths are under PROJECT_ROOT/component-capture-<timestamp>/ (manifest.json + PNG per component).`,
                    },
                },
            ],
        };
    });
    server.registerPrompt("validate-component-workflow", {
        title: "Validate Component Workflow",
        description: "Feedback loop: validate inventory completeness and capture outputs before trusting PNGs.",
        argsSchema: {
            inventoryId: z.string().optional().describe("Inventory id from Step 1"),
            captureReportId: z
                .string()
                .optional()
                .describe("Capture report id from Step 2 (component-capture-<timestamp>)"),
        },
    }, async (args) => {
        const inventoryId = typeof args.inventoryId === "string" ? args.inventoryId.trim() : "";
        const captureReportId = typeof args.captureReportId === "string" ? args.captureReportId.trim() : "";
        if (!inventoryId) {
            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Validate component inventory and captures.

**Required:** inventoryId (e.g. component-inventory-<timestamp> from Step 1)
**Optional:** captureReportId (e.g. component-capture-<timestamp> from Step 2)

Reply with both ids when available. I will call validateComponentWorkflow and act on issues/nextSteps.`,
                        },
                    },
                ],
            };
        }
        const captureLine = captureReportId
            ? `captureReportId: ${captureReportId}`
            : "captureReportId: (inventory only — run capture first for full validation)";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Validate component workflow:
- inventoryId: ${inventoryId}
- ${captureLine}

1. Call validateComponentWorkflow with inventoryId "${inventoryId}"${captureReportId ? `, captureReportId "${captureReportId}"` : ""}.
2. If complete is false, follow nextSteps: fix CSV/selectors, re-import inventory, or re-run captureComponentScreenshots (creates a new capture folder).
3. Read validation-report.json in the inventory folder for the full issue list.
4. Only proceed to visual comparison when complete is true.`,
                    },
                },
            ],
        };
    });
    server.registerPrompt("suggest-fix", {
        title: "Suggest Fix",
        description: "Verify the issue by comparing the original snapshot and current snapshot of the given block and suggest the fix.",
        argsSchema: {
            blockName: z.string().min(1).describe("Block name (e.g. tabs, cards, hero)"),
        },
    }, async ({ blockName }) => {
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
    });
    return server;
}
