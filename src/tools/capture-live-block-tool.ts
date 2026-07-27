import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { captureLiveBlockWorkflow } from '../workflows/capture-live-block.js';

export const captureLiveBlockTool = createTool({
  id: 'captureLiveBlock',
  description: 'Locates a block on the LIVE site (by matching the migrated block\'s content) and saves its rendering as a durable per-block baseline for later comparison. Given a comparePageDiff runId and a block name, hits the live site once. On low match confidence it returns candidate info and asks you to re-run with an explicit liveSelector.',
  inputSchema: z.object({
    block: z.string().describe('Block to capture, as "name" or "kind:name" (e.g. "hero-spotlight", "landmark:nav"), matched against the run\'s block roll-up.'),
    runId: z.string().optional().describe('An existing comparePageDiff run ID (supplies the live/migrated URL pair). Omit to run a fresh comparison via mappingFile.'),
    mappingFile: z.string().optional().describe('Path to a CSV/JSON mapping file to run a fresh comparison first. Omit if runId is given.'),
    viewport: z.string().optional().describe('A single viewport label (Mobile/Tablet/Desktop/Large). Omit to capture all configured viewports.'),
    liveSelector: z.string().optional().describe('A CSS selector on the live page to screenshot instead of anchor-matching. Use to override a low-confidence auto-match.'),
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory.'),
  }),
  execute: async ({ block, runId, mappingFile, viewport, liveSelector, projectDir }) => {
    const run = await captureLiveBlockWorkflow.createRun();
    const result = await run.start({ inputData: { block, runId, mappingFile, viewport, liveSelector, projectDir } });
    const output = result.status === 'success' ? result.result : undefined;
    const text = output?.output
      ? `${output.message}\n\n${output.output}`
      : (output?.message ?? `captureLiveBlock did not complete (status: ${result.status}).`);
    return { content: [{ type: 'text', text }] };
  },
});
