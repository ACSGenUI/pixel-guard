import { createTool } from '@mastra/core/tools';
import type { ToolExecutionContext } from '@mastra/core/tools';
import { z } from 'zod';
import { runVisualTestsWorkflow } from '../workflows/run-visual-tests.js';
import { appendErrorOutput, formatWorkflowResult } from './format-workflow-result.js';

async function askYesNo(
  mcp: NonNullable<ToolExecutionContext['mcp']>,
  message: string,
  key: string,
): Promise<boolean> {
  try {
    const result = await mcp.elicitation.sendRequest({
      message,
      requestedSchema: {
        type: 'object',
        properties: { [key]: { type: 'boolean', title: 'Yes' } },
        required: [key],
      },
    });
    return result.action === 'accept' && result.content?.[key] === true;
  } catch {
    // Client doesn't support elicitation (or declined the capability) -- treat as "no"
    // rather than failing the whole tool call.
    return false;
  }
}

export const runVisualTestsAndFixTool = createTool({
  id: 'runVisualTestsAndFix',
  description: 'Runs the Playwright visual tests. If they fail, asks whether to reveal the detailed error output, then asks whether a fix should be attempted for the underlying issue.',
  inputSchema: z.object({
    blockName: z.string().optional().describe('Name of a single block to run visual tests for (e.g. "Columns"). Omit to run the full visual test suite.'),
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted -- required when calling this tool from a host with no notion of the target project (e.g. Mastra Studio).'),
  }),
  execute: async ({ blockName, projectDir }, context) => {
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

    if (output.visualTestsRan) {
      return { content: [{ type: 'text', text: summary }] };
    }

    const mcp = context.mcp;
    if (!mcp) {
      // No elicitation support available (e.g. called outside the MCP protocol) -- just
      // return everything we've got rather than silently skipping diagnostics.
      return { content: [{ type: 'text', text: appendErrorOutput(summary, output.errorOutput) }] };
    }

    const wantsDiagnostics = await askYesNo(
      mcp,
      'Visual tests failed. Would you like to see the detailed error output to diagnose the failure?',
      'runDiagnostics',
    );
    if (!wantsDiagnostics) {
      return { content: [{ type: 'text', text: summary }] };
    }

    const diagnosedText = appendErrorOutput(summary, output.errorOutput);

    const wantsFix = await askYesNo(
      mcp,
      'Should an attempt be made to fix the underlying issue based on this error output?',
      'attemptFix',
    );
    if (!wantsFix) {
      return { content: [{ type: 'text', text: diagnosedText }] };
    }

    return {
      content: [{
        type: 'text',
        text: `${diagnosedText}\n\n---\n\nThe user has approved attempting a fix. Analyze the error output above and fix the underlying issue in the project.`,
      }],
    };
  },
});
