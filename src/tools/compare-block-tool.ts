import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { compareBlockWorkflow } from '../workflows/compare-block.js';

export const compareBlockTool = createTool({
  id: 'compareBlock',
  description: 'Re-screenshots one migrated block and pixel-diffs it against its saved live baseline (from captureLiveBlock), per viewport. Fast and offline (migrated page only). Re-run after each CSS/markup fix until every viewport passes.',
  inputSchema: z.object({
    block: z.string().describe('Block to compare, as "name" or "kind:name". A live baseline must exist (run captureLiveBlock first).'),
    runId: z.string().optional().describe('The comparePageDiff run ID whose live baselines / migrated URL to use. Omit to run a fresh comparison via mappingFile.'),
    mappingFile: z.string().optional().describe('Path to a CSV/JSON mapping file to run a fresh comparison first. Omit if runId is given.'),
    viewport: z.string().optional().describe('A single viewport label (Mobile/Tablet/Desktop/Large). Omit to compare all captured viewports.'),
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory.'),
  }),
  execute: async ({ block, runId, mappingFile, viewport, projectDir }) => {
    const run = await compareBlockWorkflow.createRun();
    const result = await run.start({ inputData: { block, runId, mappingFile, viewport, projectDir } });
    const output = result.status === 'success' ? result.result : undefined;
    if (!output) {
      return { content: [{ type: 'text', text: `compareBlock did not complete (status: ${result.status}).` }] };
    }
    const body = output.output ? `${output.message}\n\n${output.output}` : output.message;
    const text = output.reportUrl ? `${body}\n\n**page-diff report:** ${output.reportUrl}` : body;
    return { content: [{ type: 'text', text }] };
  },
});
