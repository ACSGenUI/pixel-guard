/**
 * Component inventory, capture, validation, and CSV workflow.
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { PAGE_COMPARE_VIEWPORTS, VIEWPORT_PRESETS, } from "./compare-pages.js";
import { getPageComparisonReportBasePath, getBundledComponentInventoryTemplatePath, getReportDir, PROJECT_ROOT, } from "./paths.js";
import { COMPONENT_DISCOVERY_FUNCTION, discoverComponentsViaChromeDevtoolsMcp, screenshotComponentsViaChromeDevtoolsMcp, } from "./component-devtools.js";
// --- CSV ---
/** Subfolder under PROJECT_ROOT for the agent's editable copy. */
export const COMPONENT_INVENTORY_TEMPLATES_DIR = "templates";
export const COMPONENT_INVENTORY_CSV_FILENAME = "component-inventory-template.csv";
export const COMPONENT_INVENTORY_TEMPLATE_RESOURCE_URI = "pixel-guard://templates/component-inventory-template.csv";
export function getDefaultComponentInventoryCsvPath() {
    return path.join(PROJECT_ROOT, COMPONENT_INVENTORY_TEMPLATES_DIR, COMPONENT_INVENTORY_CSV_FILENAME);
}
/** Read the bundled template shipped with the MCP server package. */
export async function readBundledComponentInventoryTemplate() {
    return fs.readFile(getBundledComponentInventoryTemplatePath(), "utf-8");
}
function normalizeHeader(value) {
    return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}
function mapHeader(value) {
    const normalized = normalizeHeader(value);
    if (normalized === "pageurl" || normalized === "url")
        return "pageUrl";
    if (normalized === "componentname" ||
        normalized === "component" ||
        normalized === "name" ||
        normalized === "blockname") {
        return "componentName";
    }
    if (normalized === "selector" || normalized === "cssselector")
        return "selector";
    return null;
}
function detectDelimiter(headerLine) {
    if (headerLine.includes("|"))
        return "|";
    if (headerLine.includes("\t"))
        return "\t";
    return ",";
}
function splitDelimitedLine(line, delimiter) {
    const fields = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            }
            else {
                inQuotes = !inQuotes;
            }
        }
        else if (ch === delimiter && !inQuotes) {
            fields.push(current.trim());
            current = "";
        }
        else {
            current += ch;
        }
    }
    fields.push(current.trim());
    return fields.map((field) => field.replace(/^"|"$/g, ""));
}
export function parseComponentInventoryCsv(content) {
    const lines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
    if (lines.length === 0) {
        throw new Error("CSV is empty. Expected header: pageUrl|componentName|selector");
    }
    const delimiter = detectDelimiter(lines[0]);
    const headerFields = splitDelimitedLine(lines[0], delimiter);
    const columnMap = headerFields.map((header) => mapHeader(header));
    if (!columnMap.includes("pageUrl") || !columnMap.includes("componentName") || !columnMap.includes("selector")) {
        throw new Error("CSV header must include pageUrl, componentName, and selector (pipe, comma, or tab delimited).");
    }
    const rows = [];
    for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
        const fields = splitDelimitedLine(lines[lineIndex], delimiter);
        const row = {};
        columnMap.forEach((key, index) => {
            if (!key)
                return;
            row[key] = fields[index]?.trim() ?? "";
        });
        const pageUrl = row.pageUrl?.trim() ?? "";
        const componentName = row.componentName?.trim() ?? "";
        const selector = row.selector?.trim() ?? "";
        if (!pageUrl && !componentName && !selector)
            continue;
        if (!pageUrl || !componentName || !selector) {
            throw new Error(`CSV row ${lineIndex + 1} is incomplete. Each row needs pageUrl, componentName, and selector.`);
        }
        try {
            const parsed = new URL(pageUrl);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                throw new Error("invalid protocol");
            }
        }
        catch {
            throw new Error(`CSV row ${lineIndex + 1}: pageUrl must be a valid http or https URL.`);
        }
        rows.push({ pageUrl, componentName, selector });
    }
    if (rows.length === 0) {
        throw new Error("CSV has a header but no component rows.");
    }
    return rows;
}
export function serializeComponentInventoryCsv(rows) {
    const lines = ["pageUrl|componentName|selector"];
    for (const row of rows) {
        const escape = (value) => value.includes("|") || value.includes('"') ? `"${value.replace(/"/g, '""')}"` : value;
        lines.push([escape(row.pageUrl), escape(row.componentName), escape(row.selector)].join("|"));
    }
    return `${lines.join("\n")}\n`;
}
/** Copy bundled template into PROJECT_ROOT for the agent to edit. */
export async function writeComponentInventoryCsvTemplate(options = {}) {
    const templatePath = path.resolve(options.outputPath ?? getDefaultComponentInventoryCsvPath());
    const content = await readBundledComponentInventoryTemplate();
    if (!options.overwrite) {
        try {
            await fs.access(templatePath);
            return {
                templatePath,
                content: await fs.readFile(templatePath, "utf-8"),
                resourceUri: COMPONENT_INVENTORY_TEMPLATE_RESOURCE_URI,
            };
        }
        catch {
            // write new copy from bundled template
        }
    }
    await fs.mkdir(path.dirname(templatePath), { recursive: true });
    await fs.writeFile(templatePath, content, "utf-8");
    return {
        templatePath,
        content,
        resourceUri: COMPONENT_INVENTORY_TEMPLATE_RESOURCE_URI,
    };
}
export async function readComponentInventoryCsv(csvPath, csvContent) {
    if (csvContent?.trim()) {
        return { rows: parseComponentInventoryCsv(csvContent) };
    }
    const resolvedPath = path.resolve(csvPath?.trim()
        ? path.isAbsolute(csvPath)
            ? csvPath
            : path.join(PROJECT_ROOT, csvPath)
        : getDefaultComponentInventoryCsvPath());
    let content;
    try {
        content = await fs.readFile(resolvedPath, "utf-8");
    }
    catch {
        throw new Error(csvPath?.trim()
            ? `CSV not found at ${resolvedPath}.`
            : `CSV not found at ${resolvedPath}. Read resource ${COMPONENT_INVENTORY_TEMPLATE_RESOURCE_URI}, fill it, copy to that path, or pass csvContent to import.`);
    }
    return {
        rows: parseComponentInventoryCsv(content),
        sourcePath: resolvedPath,
    };
}
/** Dismiss cookie/consent banners that can block or delay content. */
async function dismissCommonOverlays(page) {
    const selectors = [
        "#onetrust-accept-btn-handler",
        "button#onetrust-accept-btn-handler",
        '[data-testid="cookie-policy-dialog-accept-button"]',
        'button:has-text("Accept All Cookies")',
        'button:has-text("Accept All")',
        'button:has-text("I Accept")',
    ];
    for (const selector of selectors) {
        const button = page.locator(selector).first();
        try {
            if (await button.isVisible({ timeout: 800 })) {
                await button.click({ timeout: 2000 });
                await page.waitForTimeout(400);
                break;
            }
        }
        catch {
            // try next selector
        }
    }
}
/** Navigate and wait until page content is likely ready. */
export async function navigatePageForComponents(page, pageUrl) {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissCommonOverlays(page);
    await page
        .waitForSelector('[data-block-name], div.block, .block, main, header, section, [class*="container_"]', { timeout: 30000 })
        .catch(() => { });
    await page.waitForTimeout(1000);
}
export async function openComponentBrowser(viewport) {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    return {
        browser,
        context,
        page,
        engine: "playwright",
        close: async () => {
            await browser.close();
        },
    };
}
export async function discoverComponentsInPage(page) {
    return page.evaluate(`(${COMPONENT_DISCOVERY_FUNCTION})()`);
}
function toRawTarget(component) {
    return {
        id: component.id,
        name: component.name,
        index: component.index,
        selector: component.selector,
        captureId: component.captureId,
        discoveryMethod: normalizeDiscoveryMethod(component.discoveryMethod),
        confidence: component.confidence,
    };
}
function normalizeDiscoveryMethod(value) {
    if (value === "eds-block" || value === "data-attribute" || value === "named-resolve" || value === "csv-import") {
        return value;
    }
    return "chrome-devtools";
}
function filterByComponentNames(targets, componentNames) {
    if (!componentNames?.length)
        return targets;
    const wanted = new Set(componentNames.map((name) => name.trim().toLowerCase()));
    return targets.filter((target) => wanted.has(target.name.toLowerCase()));
}
export async function discoverPageComponents({ pageUrl, viewport, componentNames, }) {
    const devtools = await discoverComponentsViaChromeDevtoolsMcp(pageUrl, viewport);
    return {
        targets: filterByComponentNames(devtools.components.map(toRawTarget), componentNames),
        engine: "chrome-devtools-mcp",
    };
}
export async function enrichDiscoveredTargets(page, targets) {
    const entries = [];
    for (const target of targets) {
        if (!target.selector) {
            entries.push({
                ...target,
                boundingBox: null,
                visible: false,
            });
            continue;
        }
        const locator = page.locator(target.selector).first();
        try {
            await locator.waitFor({ state: "attached", timeout: 5000 });
            await locator.scrollIntoViewIfNeeded().catch(() => { });
            const visible = await locator.isVisible();
            const box = await locator.boundingBox();
            entries.push({
                id: target.id,
                name: target.name,
                index: target.index,
                pageUrl: target.pageUrl,
                selector: target.selector,
                captureId: target.captureId,
                discoveryMethod: target.discoveryMethod,
                confidence: target.confidence,
                visible,
                boundingBox: box
                    ? { x: box.x, y: box.y, width: box.width, height: box.height }
                    : null,
            });
        }
        catch {
            entries.push({
                id: target.id,
                name: target.name,
                index: target.index,
                pageUrl: target.pageUrl,
                selector: target.selector,
                captureId: target.captureId,
                discoveryMethod: target.discoveryMethod,
                confidence: target.confidence,
                visible: false,
                boundingBox: null,
            });
        }
    }
    return entries;
}
export function slugify(name) {
    return name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
}
export function componentId(name, index) {
    return `${slugify(name) || "component"}-${index}`;
}
export function artifactFileName(name, index) {
    const slug = slugify(name) || "component";
    return index === 0 ? `${slug}.png` : `${slug}-${index}.png`;
}
export function selectorsForComponent(name) {
    const slug = slugify(name);
    if (!slug)
        return [];
    return [
        `[data-block-name="${slug}"]`,
        `.${slug}.block`,
        `div.${slug}.block`,
        `header .${slug}.block`,
        `footer .${slug}.block`,
        `main .${slug}.block`,
        `.${slug}`,
    ];
}
function captureIdFor(name, index) {
    return `pg-capture-${slugify(name)}-${index}`;
}
async function buildRawTargets(page, pageUrl, viewport, components) {
    if (components && components.length > 0) {
        return resolveNamedComponents(page, components);
    }
    const discovered = await discoverPageComponents({
        page,
        pageUrl,
        viewport,
    });
    return discovered.targets;
}
async function enrichTargets(page, targets) {
    return enrichDiscoveredTargets(page, targets);
}
async function resolveNamedComponents(page, names) {
    const resolved = [];
    for (const rawName of names) {
        const name = rawName.trim();
        if (!name)
            continue;
        let found = false;
        for (const selector of selectorsForComponent(name)) {
            const locator = page.locator(selector);
            const count = await locator.count();
            if (count === 0)
                continue;
            for (let i = 0; i < count; i++) {
                const id = componentId(name, i);
                const captureId = captureIdFor(name, i);
                await locator.nth(i).evaluate((el, cid) => {
                    el.setAttribute("data-pixel-guard-capture", cid);
                }, captureId);
                resolved.push({
                    id,
                    name,
                    index: i,
                    selector: `[data-pixel-guard-capture="${captureId}"]`,
                    captureId,
                    discoveryMethod: "named-resolve",
                    confidence: "medium",
                });
            }
            found = true;
            break;
        }
        if (!found) {
            resolved.push({
                id: componentId(name, 0),
                name,
                index: 0,
                selector: "",
                captureId: captureIdFor(name, 0),
                discoveryMethod: "named-resolve",
                confidence: "low",
            });
        }
    }
    return resolved;
}
export async function loadComponentInventory(inventoryId) {
    const reportDir = getReportDir(inventoryId);
    const inventoryPath = path.join(reportDir, "inventory.json");
    const raw = await fs.readFile(inventoryPath, "utf-8");
    return JSON.parse(raw);
}
/**
 * Phase 1: Analyze page and write component inventory with selectors.
 */
export async function inventoryPageComponents({ pageUrl, components, viewport = "desktop", includeOverview = true, }) {
    const preset = VIEWPORT_PRESETS[viewport] ?? VIEWPORT_PRESETS.desktop;
    const inventoryId = `component-inventory-${Date.now()}`;
    const reportDir = getReportDir(inventoryId);
    await fs.mkdir(reportDir, { recursive: true });
    const session = await openComponentBrowser(preset);
    let entries = [];
    let discoveryEngine = session.engine;
    try {
        const page = session.page;
        let targets;
        if (components?.length) {
            await navigatePageForComponents(page, pageUrl);
            targets = await resolveNamedComponents(page, components);
        }
        else {
            const discovered = await discoverPageComponents({
                page,
                pageUrl,
                viewport: preset,
            });
            discoveryEngine = discovered.engine;
            targets = discovered.targets;
        }
        if (discoveryEngine === "chrome-devtools-mcp") {
            await navigatePageForComponents(page, pageUrl);
        }
        entries = await enrichTargets(page, targets);
        if (includeOverview) {
            await page.screenshot({
                path: path.join(reportDir, "overview.png"),
                fullPage: true,
            });
        }
        await page.close().catch(() => { });
    }
    finally {
        await session.close();
    }
    const visible = entries.filter((e) => e.visible).length;
    const summary = entries.length === 0
        ? "No components found via chrome-devtools-mcp. Fill templates/component-inventory-template.csv for manual mapping."
        : `Inventoried ${entries.length} component(s) (${visible} visible) via ${discoveryEngine}.`;
    const discoveryMode = components && components.length > 0 ? "named" : "auto";
    const result = {
        inventoryId,
        pageUrl,
        viewport: preset,
        viewportName: viewport,
        discoveryMode,
        discoveryEngine,
        components: entries,
        summary,
        createdAt: new Date().toISOString(),
        reportDir,
        reportBasePath: getPageComparisonReportBasePath(inventoryId),
        projectRoot: PROJECT_ROOT,
        inventoryFile: "inventory.json",
        overviewFile: "overview.png",
    };
    await fs.writeFile(path.join(reportDir, "inventory.json"), JSON.stringify(result, null, 2), "utf-8");
    return result;
}
function csvRowsToRawTargets(rows) {
    const seen = new Map();
    const targets = [];
    for (const row of rows) {
        const name = row.componentName.trim();
        const key = `${row.pageUrl}::${name}`;
        const index = seen.get(key) ?? 0;
        seen.set(key, index + 1);
        targets.push({
            id: componentId(name, index),
            name,
            index,
            pageUrl: row.pageUrl,
            selector: row.selector,
            captureId: captureIdFor(name, index),
            discoveryMethod: "csv-import",
            confidence: "high",
        });
    }
    return targets;
}
/**
 * Build inventory from an agent-filled CSV (pageUrl | componentName | selector).
 */
export async function importComponentInventoryFromCsv({ csvPath, csvContent, viewport = "desktop", includeOverview = true, }) {
    const { rows, sourcePath } = await readComponentInventoryCsv(csvPath, csvContent);
    const preset = VIEWPORT_PRESETS[viewport] ?? VIEWPORT_PRESETS.desktop;
    const inventoryId = `component-inventory-${Date.now()}`;
    const reportDir = getReportDir(inventoryId);
    await fs.mkdir(reportDir, { recursive: true });
    const csvFile = "inventory.csv";
    await fs.writeFile(path.join(reportDir, csvFile), serializeComponentInventoryCsv(rows), "utf-8");
    const pageUrls = [...new Set(rows.map((row) => row.pageUrl))];
    const primaryPageUrl = pageUrls[0];
    const targets = csvRowsToRawTargets(rows);
    const session = await openComponentBrowser(preset);
    let entries = [];
    try {
        const page = session.page;
        const entriesByPage = new Map();
        for (const target of targets) {
            const pageUrl = target.pageUrl ?? primaryPageUrl;
            const bucket = entriesByPage.get(pageUrl) ?? [];
            bucket.push(target);
            entriesByPage.set(pageUrl, bucket);
        }
        for (const [pageUrl, pageTargets] of entriesByPage) {
            await navigatePageForComponents(page, pageUrl);
            entries.push(...(await enrichTargets(page, pageTargets)));
        }
        if (includeOverview && primaryPageUrl) {
            await navigatePageForComponents(page, primaryPageUrl);
            await page.screenshot({
                path: path.join(reportDir, "overview.png"),
                fullPage: true,
            });
        }
        await page.close().catch(() => { });
    }
    finally {
        await session.close();
    }
    const visible = entries.filter((entry) => entry.visible).length;
    const invalidSelectors = entries.filter((entry) => !entry.visible).length;
    const summary = entries.length === 0
        ? "No components imported from CSV."
        : `Imported ${entries.length} component(s) from CSV (${visible} visible` +
            (invalidSelectors > 0 ? `, ${invalidSelectors} selector(s) not found` : "") +
            ").";
    const result = {
        inventoryId,
        pageUrl: pageUrls.length === 1 ? primaryPageUrl : "multiple",
        viewport: preset,
        viewportName: viewport,
        discoveryMode: "csv",
        components: entries,
        summary,
        createdAt: new Date().toISOString(),
        reportDir,
        reportBasePath: getPageComparisonReportBasePath(inventoryId),
        projectRoot: PROJECT_ROOT,
        inventoryFile: "inventory.json",
        overviewFile: "overview.png",
        csvFile,
    };
    await fs.writeFile(path.join(reportDir, "inventory.json"), JSON.stringify({ ...result, csvSourcePath: sourcePath ?? null }, null, 2), "utf-8");
    return result;
}
/**
 * Re-discover page and match inventory entries by id for screenshot capture.
 */
export async function matchInventoryOnPage(page, inventory, componentIds) {
    const filter = componentIds?.length
        ? new Set(componentIds)
        : new Set(inventory.components.map((component) => component.id));
    if (inventory.discoveryMode === "csv") {
        return inventory.components
            .filter((component) => filter.has(component.id))
            .map((component) => ({ ...component }));
    }
    const names = [...new Set(inventory.components.map((component) => component.name))];
    const pageUrl = inventory.pageUrl !== "multiple" ? inventory.pageUrl : inventory.components[0]?.pageUrl ?? "";
    const rediscovered = await enrichTargets(page, await buildRawTargets(page, pageUrl, inventory.viewport, inventory.discoveryMode === "named" ? names : undefined));
    const byId = new Map(rediscovered.map((entry) => [entry.id, entry]));
    return inventory.components
        .filter((inv) => filter.has(inv.id))
        .map((inv) => {
        const live = byId.get(inv.id);
        if (live?.selector) {
            return {
                ...inv,
                selector: live.selector,
                visible: live.visible,
                boundingBox: live.boundingBox,
            };
        }
        return { ...inv, selector: "", visible: false };
    });
}
// --- Capture ---
/** Max components per capture tool call (avoids MCP timeouts). Override via env or batchSize arg. */
export const DEFAULT_CAPTURE_BATCH_SIZE = Math.max(1, Number.parseInt(process.env.PIXEL_GUARD_CAPTURE_BATCH_SIZE ?? "4", 10) || 4);
async function captureWithPlaywright(page, entry, targetPageUrl, filePath, currentPageUrl) {
    if (targetPageUrl && targetPageUrl !== currentPageUrl) {
        await navigatePageForComponents(page, targetPageUrl);
        currentPageUrl = targetPageUrl;
    }
    const locator = page.locator(entry.selector).first();
    await locator.scrollIntoViewIfNeeded().catch(() => { });
    await locator.waitFor({ state: "visible", timeout: 15000 });
    await locator.screenshot({ path: filePath });
    const box = await locator.boundingBox();
    return {
        pageUrl: currentPageUrl,
        artifact: {
            id: entry.id,
            name: entry.name,
            index: entry.index,
            selector: entry.selector,
            file: path.basename(filePath),
            width: box?.width ?? entry.boundingBox?.width ?? 0,
            height: box?.height ?? entry.boundingBox?.height ?? 0,
            status: "captured",
            captureEngine: "playwright",
        },
    };
}
/** Split component ids into fixed-size batches for multi-call capture. */
export function planComponentCaptureBatches(componentIds, batchSize = DEFAULT_CAPTURE_BATCH_SIZE) {
    const size = Math.max(1, batchSize);
    const batches = [];
    for (let i = 0; i < componentIds.length; i += size) {
        batches.push(componentIds.slice(i, i + size));
    }
    return { batches, totalBatches: batches.length, batchSize: size };
}
function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}
async function captureFromEntries(page, entries, reportDir, defaultPageUrl, viewport) {
    const artifacts = [];
    const capturable = entries.filter((entry) => entry.selector);
    const skippedNoSelector = entries.filter((entry) => !entry.selector);
    for (const entry of skippedNoSelector) {
        const file = artifactFileName(entry.name, entry.index);
        artifacts.push({
            id: entry.id,
            name: entry.name,
            index: entry.index,
            selector: "",
            file,
            width: 0,
            height: 0,
            status: "skipped",
            error: `Component "${entry.name}" (${entry.id}) not found on page`,
        });
    }
    let currentPageUrl = "";
    const devtoolsFallback = [];
    for (const entry of capturable) {
        const file = artifactFileName(entry.name, entry.index);
        const filePath = path.join(reportDir, file);
        const targetPageUrl = entry.pageUrl?.trim() || defaultPageUrl;
        try {
            const result = await captureWithPlaywright(page, entry, targetPageUrl, filePath, currentPageUrl);
            currentPageUrl = result.pageUrl;
            artifacts.push(result.artifact);
        }
        catch {
            devtoolsFallback.push({
                pageUrl: targetPageUrl,
                selector: entry.selector,
                filePath,
                entry,
                file,
            });
        }
    }
    if (devtoolsFallback.length > 0) {
        const devtoolsResults = await screenshotComponentsViaChromeDevtoolsMcp(devtoolsFallback.map((item) => ({
            pageUrl: item.pageUrl,
            selector: item.selector,
            filePath: item.filePath,
        })), viewport);
        const resultByPath = new Map(devtoolsResults.map((r) => [r.filePath, r]));
        for (const item of devtoolsFallback) {
            const devtoolsResult = resultByPath.get(item.filePath);
            if (devtoolsResult?.ok) {
                artifacts.push({
                    id: item.entry.id,
                    name: item.entry.name,
                    index: item.entry.index,
                    selector: item.entry.selector,
                    file: item.file,
                    width: item.entry.boundingBox?.width ?? 0,
                    height: item.entry.boundingBox?.height ?? 0,
                    status: "captured",
                    captureEngine: "chrome-devtools-mcp",
                });
            }
            else {
                artifacts.push({
                    id: item.entry.id,
                    name: item.entry.name,
                    index: item.entry.index,
                    selector: item.entry.selector,
                    file: item.file,
                    width: 0,
                    height: 0,
                    status: "skipped",
                    error: devtoolsResult?.error ?? "Playwright and chrome-devtools-mcp capture failed",
                });
            }
        }
    }
    return artifacts;
}
/**
 * Phase 2: Capture screenshots using a component inventory.
 * Use batchIndex + captureReportId for multi-call capture when inventory is large.
 */
export async function captureComponentScreenshots(options) {
    let inventory;
    let inlineInventory = false;
    if (options.inventoryId) {
        inventory = await loadComponentInventory(options.inventoryId);
    }
    else if (options.pageUrl) {
        inlineInventory = true;
        inventory = await inventoryPageComponents({
            pageUrl: options.pageUrl,
            components: options.components,
            viewport: options.viewport,
            includeOverview: true,
        });
    }
    else {
        throw new Error("inventoryId or pageUrl is required");
    }
    const batchSize = Math.max(1, options.batchSize ?? DEFAULT_CAPTURE_BATCH_SIZE);
    const allTargetIds = options.componentIds?.length
        ? options.componentIds
        : inventory.components.map((c) => c.id);
    const { batches, totalBatches } = planComponentCaptureBatches(allTargetIds, batchSize);
    if (totalBatches === 0) {
        throw new Error("No components to capture.");
    }
    const batchIndex = options.batchIndex ?? 0;
    if (batchIndex < 0 || batchIndex >= totalBatches) {
        throw new Error(`batchIndex ${batchIndex} out of range (0..${totalBatches - 1}) for ${allTargetIds.length} component(s) with batchSize ${batchSize}.`);
    }
    const batchComponentIds = batches[batchIndex];
    const hasMoreBatches = batchIndex < totalBatches - 1;
    const remainingComponentIds = hasMoreBatches
        ? batches.slice(batchIndex + 1).flat()
        : undefined;
    const preset = inventory.viewport;
    const viewport = inventory.viewportName;
    let reportId = options.captureReportId?.trim() || `component-capture-${Date.now()}`;
    let reportDir = getReportDir(reportId);
    let existingArtifacts = [];
    let createdAt = new Date().toISOString();
    if (options.captureReportId?.trim()) {
        try {
            const manifestPath = path.join(reportDir, "manifest.json");
            const raw = await fs.readFile(manifestPath, "utf-8");
            const prior = JSON.parse(raw);
            existingArtifacts = prior.components ?? [];
            createdAt = prior.createdAt ?? createdAt;
        }
        catch {
            await fs.mkdir(reportDir, { recursive: true });
        }
    }
    else {
        await fs.mkdir(reportDir, { recursive: true });
    }
    const session = await openComponentBrowser(preset);
    let batchArtifacts = [];
    try {
        const page = session.page;
        const defaultPageUrl = inventory.pageUrl !== "multiple" ? inventory.pageUrl : inventory.components[0]?.pageUrl ?? "";
        if (defaultPageUrl) {
            await navigatePageForComponents(page, defaultPageUrl);
        }
        const matched = await matchInventoryOnPage(page, inventory, batchComponentIds);
        batchArtifacts = await captureFromEntries(page, matched, reportDir, defaultPageUrl, preset);
        await page.close().catch(() => { });
    }
    finally {
        await session.close();
    }
    const mergedById = new Map(existingArtifacts.map((a) => [a.id, a]));
    for (const artifact of batchArtifacts) {
        mergedById.set(artifact.id, artifact);
    }
    const components = [...mergedById.values()];
    const capturedThisBatch = batchArtifacts.filter((a) => a.status === "captured").length;
    const skippedThisBatch = batchArtifacts.length - capturedThisBatch;
    const totalCaptured = components.filter((a) => a.status === "captured").length;
    let summary = totalBatches > 1
        ? `Batch ${batchIndex + 1}/${totalBatches}: captured ${capturedThisBatch}` +
            (skippedThisBatch > 0 ? `, skipped ${skippedThisBatch}` : "") +
            ` (${totalCaptured} total in report).`
        : `Captured ${capturedThisBatch} component screenshot(s)` +
            (skippedThisBatch > 0 ? `, skipped ${skippedThisBatch}.` : ".");
    if (hasMoreBatches) {
        summary += ` ${remainingComponentIds.length} component(s) remaining — call again with batchIndex ${batchIndex + 1} and captureReportId "${reportId}".`;
    }
    const result = {
        reportId,
        inventoryId: inventory.inventoryId,
        pageUrl: inventory.pageUrl,
        viewport: preset,
        viewportName: viewport,
        components,
        summary,
        createdAt,
        reportDir,
        reportBasePath: getPageComparisonReportBasePath(reportId),
        projectRoot: PROJECT_ROOT,
        batchedCapture: totalBatches > 1,
        batchIndex,
        totalBatches,
        batchSize,
        hasMoreBatches,
        remainingComponentIds,
    };
    await fs.writeFile(path.join(reportDir, "manifest.json"), JSON.stringify({
        ...result,
        sourceInventoryId: inventory.inventoryId,
        inlineInventory,
    }, null, 2), "utf-8");
    return result;
}
const MIN_PNG_BYTES = 100;
function issue(severity, code, message, suggestedAction, componentId) {
    return { severity, code, message, componentId, suggestedAction };
}
function validateInventoryEntry(entry) {
    const issues = [];
    if (!entry.selector?.trim()) {
        issues.push(issue("error", "missing_selector", `Component "${entry.name}" (${entry.id}) has no selector.`, "Re-run inventory, fix CSV row, or add a stable CSS selector.", entry.id));
    }
    if (!entry.visible) {
        issues.push(issue(entry.discoveryMethod === "csv-import" ? "error" : "warning", "not_visible", `Component "${entry.name}" (${entry.id}) is not visible on page.`, "Scroll into view, fix selector, or dismiss overlays blocking the element.", entry.id));
    }
    const box = entry.boundingBox;
    if (box && (box.width <= 0 || box.height <= 0)) {
        issues.push(issue("warning", "zero_bounding_box", `Component "${entry.name}" (${entry.id}) has zero width or height.`, "Selector may match a collapsed or empty wrapper; pick a child element with content.", entry.id));
    }
    if (entry.confidence === "low") {
        issues.push(issue("warning", "low_confidence", `Component "${entry.name}" (${entry.id}) has low discovery confidence.`, "Confirm selector manually in DevTools and update CSV if needed.", entry.id));
    }
    return issues;
}
export function validateInventoryData(inventory) {
    const issues = [];
    const ids = new Set();
    if (inventory.components.length === 0) {
        issues.push(issue("error", "empty_inventory", "Inventory has no components.", "Run inventoryPageComponents, import CSV rows, or pass named components list."));
    }
    for (const entry of inventory.components) {
        if (ids.has(entry.id)) {
            issues.push(issue("error", "duplicate_id", `Duplicate component id: ${entry.id}.`, "Ensure unique componentName per page or distinct indices.", entry.id));
        }
        ids.add(entry.id);
        issues.push(...validateInventoryEntry(entry));
    }
    if (inventory.discoveryMode === "auto" && inventory.components.length > 0 && inventory.components.length < 3) {
        issues.push(issue("warning", "sparse_auto_discovery", `Auto-discovery found only ${inventory.components.length} component(s).`, "Compare overview.png with the live page; add missing blocks via CSV import."));
    }
    const visible = inventory.components.filter((e) => e.visible).length;
    const missingSelector = inventory.components.filter((e) => !e.selector?.trim()).length;
    const zeroSizeBox = inventory.components.filter((e) => e.boundingBox && (e.boundingBox.width <= 0 || e.boundingBox.height <= 0)).length;
    const recommendations = [];
    if (issues.some((i) => i.code === "not_visible" || i.code === "missing_selector")) {
        recommendations.push("Fix inventory issues before capture: update templates/component-inventory-template.csv and re-import, or re-run inventoryPageComponents.");
    }
    if (inventory.discoveryMode === "auto" && visible < inventory.components.length) {
        recommendations.push("Review overview.png and add CSV rows for blocks missing from auto-discovery.");
    }
    if (issues.length === 0) {
        recommendations.push(`Inventory looks complete. Call captureComponentScreenshots with inventoryId: ${inventory.inventoryId} (uses batches of ${DEFAULT_CAPTURE_BATCH_SIZE} by default).`);
    }
    const hasErrors = issues.some((i) => i.severity === "error");
    return {
        valid: !hasErrors,
        inventoryId: inventory.inventoryId,
        reportDir: inventory.reportDir,
        issues,
        stats: {
            total: inventory.components.length,
            visible,
            hidden: inventory.components.length - visible,
            missingSelector,
            zeroSizeBox,
        },
        recommendations,
    };
}
export async function loadComponentCaptureManifest(captureReportId) {
    const reportDir = getReportDir(captureReportId);
    const raw = await fs.readFile(path.join(reportDir, "manifest.json"), "utf-8");
    return JSON.parse(raw);
}
export async function validateCaptureData(capture, inventory) {
    const issues = [];
    const reportDir = capture.reportDir;
    let missingFiles = 0;
    let emptyFiles = 0;
    for (const artifact of capture.components) {
        if (artifact.status === "skipped") {
            issues.push(issue("error", "capture_skipped", `Screenshot skipped for "${artifact.name}" (${artifact.id}): ${artifact.error ?? "unknown"}.`, "Fix selector visibility, re-run captureComponentScreenshots with same inventoryId, or use Playwright fallback path.", artifact.id));
            continue;
        }
        const filePath = path.join(reportDir, artifact.file);
        try {
            const stat = await fs.stat(filePath);
            if (stat.size < MIN_PNG_BYTES) {
                emptyFiles++;
                issues.push(issue("error", "empty_capture_file", `Capture file too small (${stat.size} bytes): ${artifact.file}.`, "Re-capture this component; check selector and page load state.", artifact.id));
            }
        }
        catch {
            missingFiles++;
            issues.push(issue("error", "missing_capture_file", `Capture file missing: ${artifact.file}.`, "Re-run captureComponentScreenshots for this inventoryId.", artifact.id));
        }
        if (artifact.width <= 0 || artifact.height <= 0) {
            issues.push(issue("warning", "zero_capture_dimensions", `Capture "${artifact.name}" (${artifact.id}) reported zero dimensions.`, "Verify PNG visually; selector may target an empty wrapper.", artifact.id));
        }
    }
    const capturedIds = capture.components
        .filter((a) => a.status === "captured")
        .map((a) => a.id);
    const inventoryIds = inventory?.components.map((c) => c.id) ?? [];
    const missingCaptureIds = inventoryIds.filter((id) => !capturedIds.includes(id));
    const extraCaptureIds = capturedIds.filter((id) => !inventoryIds.includes(id));
    for (const id of missingCaptureIds) {
        issues.push(issue("error", "inventory_not_captured", `Inventory component ${id} has no successful capture.`, "Re-run captureComponentScreenshots without componentIds filter, or fix inventory entry first.", id));
    }
    if (capture.sourceInventoryId &&
        inventory &&
        capture.sourceInventoryId !== inventory.inventoryId) {
        issues.push(issue("warning", "inventory_mismatch", `Capture sourceInventoryId (${capture.sourceInventoryId}) does not match validated inventory (${inventory.inventoryId}).`, "Validate capture against the inventoryId used when capturing."));
    }
    const captured = capture.components.filter((a) => a.status === "captured").length;
    const skipped = capture.components.filter((a) => a.status === "skipped").length;
    const recommendations = [];
    if (skipped > 0) {
        recommendations.push("Re-run validateComponentWorkflow after fixing selectors; then captureComponentScreenshots with the same inventoryId (creates a new capture folder).");
    }
    if (missingCaptureIds.length > 0) {
        recommendations.push("Complete inventory first, then capture all component ids.");
    }
    if (issues.length === 0) {
        recommendations.push("Capture outputs look complete. Proceed to visual diff or baseline review.");
    }
    const hasErrors = issues.some((i) => i.severity === "error");
    return {
        valid: !hasErrors,
        captureReportId: capture.reportId,
        reportDir,
        issues,
        stats: {
            expected: inventory?.components.length ?? capture.components.length,
            captured,
            skipped,
            missingFiles,
            emptyFiles,
        },
        coverage: {
            inventoryComponentIds: inventoryIds,
            capturedIds,
            missingCaptureIds,
            extraCaptureIds,
        },
        recommendations,
    };
}
export async function validateComponentWorkflow({ inventoryId, captureReportId, writeReport = true, }) {
    const inventory = await loadComponentInventory(inventoryId);
    const inventoryValidation = validateInventoryData(inventory);
    let captureValidation;
    if (captureReportId?.trim()) {
        const capture = await loadComponentCaptureManifest(captureReportId.trim());
        captureValidation = await validateCaptureData(capture, inventory);
    }
    const nextSteps = [];
    if (!inventoryValidation.valid) {
        nextSteps.push(...inventoryValidation.recommendations);
    }
    else if (!captureReportId) {
        nextSteps.push(`Inventory passed validation. Run captureComponentScreenshots with inventoryId "${inventoryId}", then validate again with captureReportId.`);
    }
    if (captureValidation) {
        if (!captureValidation.valid) {
            nextSteps.push(...captureValidation.recommendations);
        }
        else if (inventoryValidation.valid) {
            nextSteps.push("Workflow complete: inventory and captures validated.");
        }
    }
    const complete = inventoryValidation.valid && (!captureReportId || (captureValidation?.valid ?? false));
    const result = {
        complete,
        inventoryId,
        captureReportId: captureReportId?.trim() || undefined,
        inventory: inventoryValidation,
        capture: captureValidation,
        nextSteps: [...new Set(nextSteps)],
    };
    if (writeReport) {
        const reportPayload = {
            ...result,
            validatedAt: new Date().toISOString(),
        };
        const inventoryReportPath = path.join(inventory.reportDir, "validation-report.json");
        await fs.writeFile(inventoryReportPath, JSON.stringify(reportPayload, null, 2), "utf-8");
        result.validationReportPath = inventoryReportPath;
        if (captureValidation) {
            const captureReportPath = path.join(captureValidation.reportDir, "validation-report.json");
            await fs.writeFile(captureReportPath, JSON.stringify(reportPayload, null, 2), "utf-8");
        }
    }
    return result;
}
export { PAGE_COMPARE_VIEWPORTS };
