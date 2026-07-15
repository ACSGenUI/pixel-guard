import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { updateVisualSnapshotsWorkflow } from '../workflows/update-visual-snapshots.js';
import { PLAYWRIGHT_REPORT_RESOURCE_URI } from './playwright-report-app.js';

export const updateVisualSnapshotsTool = createTool({
  id: 'updateVisualSnapshots',
  description: 'Updates the Playwright visual snapshot baselines (all, or a single block when blockName is given) and displays the HTML report inline.',
  inputSchema: z.object({
    blockName: z.string().optional().describe('Name of a single block to update visual snapshots for (e.g. "Columns"). Omit to update snapshots for the full visual test suite.'),
  }),
  mcp: {
    _meta: { ui: { resourceUri: PLAYWRIGHT_REPORT_RESOURCE_URI } },
  },
  execute: async ({ blockName }) => {
    const run = await updateVisualSnapshotsWorkflow.createRun();
    const result = await run.start({ inputData: { blockName } });
    const output = result.status === 'success' ? result.result : undefined;
    const message = output?.snapshotsUpdatedMessage ?? `Snapshot update did not complete (status: ${result.status}).`;

    return {
      content: [{ type: 'text', text: message }],
      structuredContent: {
        snapshotsUpdated: output?.snapshotsUpdated ?? false,
        reportUrl: output?.reportUrl ?? null,
        message,
      },
    };
  },
});
