import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { installPageDiffWorkflow } from '../workflows/install-page-diff.js';
import { formatWorkflowResult } from './format-workflow-result.js';

export const installPageDiffTool = createTool({
  id: 'installPageDiff',
  description: 'Installs the page-diff environment in the target project: copies tools/page-diff/, merges its npm scripts and dependencies (playwright, pixelmatch, pngjs) into package.json, and runs npm install. Fully independent of aemVisualTestInstall -- does not require the block-testing suite to be installed, and vice versa.',
  inputSchema: z.object({
    projectDir: z.string().optional().describe('Absolute path to the target project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted.'),
  }),
  execute: async ({ projectDir }) => {
    const run = await installPageDiffWorkflow.createRun();
    const result = await run.start({ inputData: { projectDir } });
    const output = result.status === 'success' ? result.result : undefined;

    const text = output
      ? formatWorkflowResult('Install Page Diff', [
        { label: 'package.json found', success: output.packageJsonExists, message: output.packageJsonMessage },
        { label: 'Files copied', success: output.filesCopied, message: output.filesCopiedMessage },
        { label: 'Config updated', success: output.configUpdated, message: output.configUpdatedMessage },
        { label: 'npm install', success: output.npmInstallSucceeded, message: output.npmInstallMessage },
      ])
      : `Install Page Diff did not complete (status: ${result.status}).`;

    return { content: [{ type: 'text', text }] };
  },
});
