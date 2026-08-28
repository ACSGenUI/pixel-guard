import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateVisualTestsWorkflow } from '../workflows/generate-visual-tests.js';
import { formatWorkflowResult } from './format-workflow-result.js';

export const generateVisualTestsTool = createTool({
  id: 'generateVisualTests',
  description: 'Regenerates Playwright visual tests from the current sidekick library blocks. Assumes the visual-test environment was already installed via aemVisualTestInstall.',
  inputSchema: z.object({
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted.'),
  }),
  execute: async ({ projectDir }) => {
    const run = await generateVisualTestsWorkflow.createRun();
    const result = await run.start({ inputData: { projectDir } });
    const output = result.status === 'success' ? result.result : undefined;

    const text = output
      ? formatWorkflowResult('Generate Visual Tests', [
        { label: 'Docker installed', success: output.dockerInstalled, message: output.dockerMessage },
        { label: 'Project structure valid', success: output.projectStructureValid, message: output.projectStructureMessage },
        { label: 'Dev server started', success: output.devServerStarted, message: output.devServerMessage },
        { label: 'Visual tests generated', success: output.visualTestsGenerated, message: output.visualTestsGeneratedMessage },
        { label: 'Dev server stopped', success: output.devServerStopped, message: output.devServerStoppedMessage },
      ])
      : `Generate Visual Tests did not complete (status: ${result.status}).`;

    return { content: [{ type: 'text', text }] };
  },
});
