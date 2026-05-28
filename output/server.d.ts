import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/** Last page comparison report from comparePageVisuals. */
declare let lastPageComparisonReport: {
    reportId: string;
    reportUrl: string;
    manifest: Record<string, unknown>;
} | undefined;
/** Called by main.ts GET /api/last-report so the report page can poll until test completes. */
export declare function getLastReportStatus(): {
    url: string | undefined;
    running: boolean;
};
/** Called by main.ts GET /api/last-page-comparison for the page comparison report UI. */
export declare function getLastPageComparisonStatus(): {
    report: typeof lastPageComparisonReport;
    running: boolean;
};
export declare function createServer(): McpServer;
export {};
