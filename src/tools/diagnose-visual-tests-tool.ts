import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { runVisualTestsWorkflow } from '../workflows/run-visual-tests.js';
import { appendErrorOutput, formatWorkflowResult } from './format-workflow-result.js';

export const diagnoseVisualTestsTool = createTool({
  id: 'diagnoseVisualTests',
  description: 'Runs the Playwright visual tests (all, or a single block when blockName is given) and, if they fail, returns the raw test output (assertion diffs, stack traces) so the failure can be diagnosed and fixed.',
  inputSchema: z.object({
    blockName: z.string().optional().describe('Name of a single block to run visual tests for (e.g. "Columns"). Omit to run the full visual test suite.'),
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted -- required when calling this tool from a host with no notion of the target project (e.g. Mastra Studio).'),
  }),
  execute: async ({ blockName, projectDir }) => {
    const run = await runVisualTestsWorkflow.createRun();
    const result = await run.start({ inputData: { blockName, projectDir } });
    const output = result.status === 'success' ? result.result : undefined;

    if (!output) {
      return { content: [{ type: 'text', text: `Run Visual Tests did not complete (status: ${result.status}).` }] };
    }

    const summary = formatWorkflowResult('Run Visual Tests', [
      { label: 'Docker installed', success: output.dockerInstalled, message: output.dockerMessage },
      { label: 'Project structure valid', success: output.projectStructureValid, message: output.projectStructureMessage },
      { label: 'Dev server started', success: output.devServerStarted, message: output.devServerMessage },
      { label: 'Visual tests ran', success: output.visualTestsRan, message: output.visualTestsRanMessage },
      { label: 'Dev server stopped', success: output.devServerStopped, message: output.devServerStoppedMessage },
    ]);

    return { content: [{ type: 'text', text: appendErrorOutput(summary, output.errorOutput) }] };
  },
});
