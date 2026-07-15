import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { updateVisualSnapshotsWorkflow } from '../workflows/update-visual-snapshots.js';
import { formatWorkflowResult, withReportLine } from './format-workflow-result.js';

export const updateVisualSnapshotsTool = createTool({
  id: 'updateVisualSnapshots',
  description: 'Updates the Playwright visual snapshot baselines (all, or a single block when blockName is given).',
  inputSchema: z.object({
    blockName: z.string().optional().describe('Name of a single block to update visual snapshots for (e.g. "Columns"). Omit to update snapshots for the full visual test suite.'),
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted -- required when calling this tool from a host with no notion of the target project (e.g. Mastra Studio).'),
  }),
  execute: async ({ blockName, projectDir }) => {
    const run = await updateVisualSnapshotsWorkflow.createRun();
    const result = await run.start({ inputData: { blockName, projectDir } });
    const output = result.status === 'success' ? result.result : undefined;

    const text = output
      ? withReportLine(formatWorkflowResult('Update Visual Snapshots', [
        { label: 'Docker installed', success: output.dockerInstalled, message: output.dockerMessage },
        { label: 'Project structure valid', success: output.projectStructureValid, message: output.projectStructureMessage },
        { label: 'Dev server started', success: output.devServerStarted, message: output.devServerMessage },
        { label: 'Snapshots updated', success: output.snapshotsUpdated, message: output.snapshotsUpdatedMessage },
        { label: 'Dev server stopped', success: output.devServerStopped, message: output.devServerStoppedMessage },
      ]), output.reportUrl)
      : `Update Visual Snapshots did not complete (status: ${result.status}).`;

    return { content: [{ type: 'text', text }] };
  },
});
