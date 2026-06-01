/**
 * Component inventory, capture, validation, and CSV workflow.
 */
import { type Page, type Browser, type BrowserContext } from "playwright";
import { PAGE_COMPARE_VIEWPORTS, type PageCompareViewport } from "./compare-pages.js";
import { type DiscoveredComponent } from "./component-devtools.js";
/** Subfolder under PROJECT_ROOT for the agent's editable copy. */
export declare const COMPONENT_INVENTORY_TEMPLATES_DIR = "templates";
export declare const COMPONENT_INVENTORY_CSV_FILENAME = "component-inventory-template.csv";
export declare const COMPONENT_INVENTORY_TEMPLATE_RESOURCE_URI = "pixel-guard://templates/component-inventory-template.csv";
export declare function getDefaultComponentInventoryCsvPath(): string;
export type ComponentInventoryCsvRow = {
    pageUrl: string;
    componentName: string;
    selector: string;
};
/** Read the bundled template shipped with the MCP server package. */
export declare function readBundledComponentInventoryTemplate(): Promise<string>;
export declare function parseComponentInventoryCsv(content: string): ComponentInventoryCsvRow[];
export declare function serializeComponentInventoryCsv(rows: ComponentInventoryCsvRow[]): string;
export type WriteComponentInventoryCsvTemplateOptions = {
    outputPath?: string;
    overwrite?: boolean;
};
/** Copy bundled template into PROJECT_ROOT for the agent to edit. */
export declare function writeComponentInventoryCsvTemplate(options?: WriteComponentInventoryCsvTemplateOptions): Promise<{
    templatePath: string;
    content: string;
    resourceUri: string;
}>;
export declare function readComponentInventoryCsv(csvPath?: string, csvContent?: string): Promise<{
    rows: ComponentInventoryCsvRow[];
    sourcePath?: string;
}>;
export type ComponentBrowserEngine = "playwright";
export type ComponentBrowserSession = {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    engine: ComponentBrowserEngine;
    close: () => Promise<void>;
};
/** Navigate and wait until page content is likely ready. */
export declare function navigatePageForComponents(page: Page, pageUrl: string): Promise<void>;
export declare function openComponentBrowser(viewport: {
    width: number;
    height: number;
}): Promise<ComponentBrowserSession>;
export declare function discoverComponentsInPage(page: Page): Promise<DiscoveredComponent[]>;
export type DiscoveryEngine = "chrome-devtools-mcp" | "playwright";
type RawTarget = {
    id: string;
    name: string;
    index: number;
    pageUrl?: string;
    selector: string;
    captureId: string;
    discoveryMethod: ComponentDiscoveryMethod;
    confidence: ComponentConfidence;
};
export declare function discoverPageComponents({ pageUrl, viewport, componentNames, }: {
    page?: Page;
    pageUrl: string;
    viewport: {
        width: number;
        height: number;
    };
    componentNames?: string[];
}): Promise<{
    targets: RawTarget[];
    engine: DiscoveryEngine;
}>;
export declare function enrichDiscoveredTargets(page: Page, targets: RawTarget[]): Promise<ComponentInventoryEntry[]>;
export type ComponentDiscoveryMethod = "eds-block" | "data-attribute" | "named-resolve" | "csv-import" | "chrome-devtools";
export type ComponentConfidence = "high" | "medium" | "low";
export type ComponentBoundingBox = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type ComponentInventoryEntry = {
    id: string;
    name: string;
    index: number;
    pageUrl?: string;
    selector: string;
    captureId: string;
    boundingBox: ComponentBoundingBox | null;
    confidence: ComponentConfidence;
    discoveryMethod: ComponentDiscoveryMethod;
    visible: boolean;
};
export type ComponentInventoryResult = {
    inventoryId: string;
    pageUrl: string;
    viewport: {
        width: number;
        height: number;
    };
    viewportName: PageCompareViewport;
    discoveryMode: "auto" | "named" | "csv";
    discoveryEngine?: DiscoveryEngine;
    components: ComponentInventoryEntry[];
    summary: string;
    createdAt: string;
    reportDir: string;
    reportBasePath: string;
    projectRoot: string;
    inventoryFile: string;
    overviewFile: string;
    csvFile?: string;
};
export type InventoryPageComponentsOptions = {
    pageUrl: string;
    components?: string[];
    viewport?: PageCompareViewport;
    includeOverview?: boolean;
};
export type ImportComponentInventoryFromCsvOptions = {
    csvPath?: string;
    csvContent?: string;
    viewport?: PageCompareViewport;
    includeOverview?: boolean;
};
export declare function slugify(name: string): string;
export declare function componentId(name: string, index: number): string;
export declare function artifactFileName(name: string, index: number): string;
export declare function selectorsForComponent(name: string): string[];
export declare function loadComponentInventory(inventoryId: string): Promise<ComponentInventoryResult>;
/**
 * Phase 1: Analyze page and write component inventory with selectors.
 */
export declare function inventoryPageComponents({ pageUrl, components, viewport, includeOverview, }: InventoryPageComponentsOptions): Promise<ComponentInventoryResult>;
/**
 * Build inventory from an agent-filled CSV (pageUrl | componentName | selector).
 */
export declare function importComponentInventoryFromCsv({ csvPath, csvContent, viewport, includeOverview, }: ImportComponentInventoryFromCsvOptions): Promise<ComponentInventoryResult>;
/**
 * Re-discover page and match inventory entries by id for screenshot capture.
 */
export declare function matchInventoryOnPage(page: Page, inventory: ComponentInventoryResult, componentIds?: string[]): Promise<ComponentInventoryEntry[]>;
/** Max components per capture tool call (avoids MCP timeouts). Override via env or batchSize arg. */
export declare const DEFAULT_CAPTURE_BATCH_SIZE: number;
export type CaptureComponentScreenshotsOptions = {
    /** Use a prior inventory (recommended). */
    inventoryId?: string;
    /** Filter inventory entries by id (e.g. hero-0, cards-1). */
    componentIds?: string[];
    /** Legacy: analyze + capture in one step when inventoryId is omitted. */
    pageUrl?: string;
    components?: string[];
    viewport?: PageCompareViewport;
    /** Components per batch (default DEFAULT_CAPTURE_BATCH_SIZE). */
    batchSize?: number;
    /** Zero-based batch index. Omit to capture batch 0 when inventory exceeds batchSize. */
    batchIndex?: number;
    /** Resume/append to an existing component-capture-* folder from a prior batch. */
    captureReportId?: string;
};
export type ComponentScreenshotArtifact = {
    id: string;
    name: string;
    index: number;
    selector: string;
    file: string;
    width: number;
    height: number;
    status: "captured" | "skipped";
    error?: string;
    captureEngine?: "chrome-devtools-mcp" | "playwright";
};
export type CaptureComponentScreenshotsResult = {
    reportId: string;
    inventoryId: string;
    pageUrl: string;
    viewport: {
        width: number;
        height: number;
    };
    viewportName: PageCompareViewport;
    components: ComponentScreenshotArtifact[];
    summary: string;
    createdAt: string;
    reportDir: string;
    reportBasePath: string;
    projectRoot: string;
    /** True when more batches remain after this call. */
    batchedCapture?: boolean;
    batchIndex?: number;
    totalBatches?: number;
    batchSize?: number;
    hasMoreBatches?: boolean;
    remainingComponentIds?: string[];
};
/** Split component ids into fixed-size batches for multi-call capture. */
export declare function planComponentCaptureBatches(componentIds: string[], batchSize?: number): {
    batches: string[][];
    totalBatches: number;
    batchSize: number;
};
/**
 * Phase 2: Capture screenshots using a component inventory.
 * Use batchIndex + captureReportId for multi-call capture when inventory is large.
 */
export declare function captureComponentScreenshots(options: CaptureComponentScreenshotsOptions): Promise<CaptureComponentScreenshotsResult>;
export type ValidationSeverity = "error" | "warning";
export type ValidationIssue = {
    severity: ValidationSeverity;
    code: string;
    message: string;
    componentId?: string;
    suggestedAction: string;
};
export type InventoryValidationResult = {
    valid: boolean;
    inventoryId: string;
    reportDir: string;
    issues: ValidationIssue[];
    stats: {
        total: number;
        visible: number;
        hidden: number;
        missingSelector: number;
        zeroSizeBox: number;
    };
    recommendations: string[];
};
export type CaptureValidationResult = {
    valid: boolean;
    captureReportId: string;
    reportDir: string;
    issues: ValidationIssue[];
    stats: {
        expected: number;
        captured: number;
        skipped: number;
        missingFiles: number;
        emptyFiles: number;
    };
    coverage: {
        inventoryComponentIds: string[];
        capturedIds: string[];
        missingCaptureIds: string[];
        extraCaptureIds: string[];
    };
    recommendations: string[];
};
export type WorkflowValidationResult = {
    complete: boolean;
    inventoryId: string;
    captureReportId?: string;
    inventory: InventoryValidationResult;
    capture?: CaptureValidationResult;
    nextSteps: string[];
    validationReportPath?: string;
};
export declare function validateInventoryData(inventory: ComponentInventoryResult): InventoryValidationResult;
export declare function loadComponentCaptureManifest(captureReportId: string): Promise<CaptureComponentScreenshotsResult & {
    sourceInventoryId?: string;
    inlineInventory?: boolean;
}>;
export declare function validateCaptureData(capture: CaptureComponentScreenshotsResult & {
    sourceInventoryId?: string;
}, inventory?: ComponentInventoryResult): Promise<CaptureValidationResult>;
export declare function validateComponentWorkflow({ inventoryId, captureReportId, writeReport, }: {
    inventoryId: string;
    captureReportId?: string;
    writeReport?: boolean;
}): Promise<WorkflowValidationResult>;
export { PAGE_COMPARE_VIEWPORTS };
