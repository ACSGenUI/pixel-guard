import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { runVisualTestsWorkflow } from '../workflows/run-visual-tests.js';
import { PLAYWRIGHT_REPORT_RESOURCE_URI } from './playwright-report-app.js';

export const runVisualTestsTool = createTool({
  id: 'runVisualTests',
  description: 'Runs the Playwright visual tests (all, or a single block when blockName is given) and displays the HTML report inline.',
  inputSchema: z.object({
    blockName: z.string().optional().describe('Name of a single block to run visual tests for (e.g. "Columns"). Omit to run the full visual test suite.'),
  }),
  mcp: {
    _meta: { ui: { resourceUri: PLAYWRIGHT_REPORT_RESOURCE_URI } },
  },
  execute: async ({ blockName }) => {
    const run = await runVisualTestsWorkflow.createRun();
    const result = await run.start({ inputData: { blockName } });
    const output = result.status === 'success' ? result.result : undefined;
    const message = output?.visualTestsRanMessage ?? `Visual test run did not complete (status: ${result.status}).`;

    return {
      content: [{ type: 'text', text: message }],
      structuredContent: {
        visualTestsRan: output?.visualTestsRan ?? false,
        reportUrl: output?.reportUrl ?? null,
        message,
      },
    };
  },
});
