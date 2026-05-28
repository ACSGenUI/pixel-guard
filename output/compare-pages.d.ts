export declare const PAGE_COMPARE_VIEWPORTS: readonly ["mobile", "tablet", "desktop", "large"];
export type PageCompareViewport = (typeof PAGE_COMPARE_VIEWPORTS)[number];
export declare const VIEWPORT_PRESETS: Record<PageCompareViewport, {
    width: number;
    height: number;
}>;
/** Directory where page comparison reports are written and served from. */
export declare const PAGE_COMPARE_REPORTS_DIR: string;
export type ComparePagesOptions = {
    sourceUrl: string;
    destinationUrl: string;
    viewport?: PageCompareViewport;
    maxDiffPixelRatio?: number;
    fullPage?: boolean;
};
export type ComparePagesResult = {
    reportId: string;
    status: "passed" | "failed";
    sourceUrl: string;
    destinationUrl: string;
    viewport: {
        width: number;
        height: number;
    };
    viewportName: PageCompareViewport;
    diffPixelCount: number;
    diffPixelRatio: number;
    maxDiffPixelRatio: number;
    totalPixels: number;
    dimensions: {
        width: number;
        height: number;
    };
    summary: string;
    artifacts: {
        source: string;
        destination: string;
        diff: string;
    };
    createdAt: string;
    reportDir: string;
    reportBasePath: string;
};
/**
 * Capture two page URLs with Playwright, compare screenshots, write report artifacts.
 * Runs entirely inside Pixel Guard — no visual-test server required.
 */
export declare function comparePages({ sourceUrl, destinationUrl, viewport, maxDiffPixelRatio, fullPage, }: ComparePagesOptions): Promise<ComparePagesResult>;
