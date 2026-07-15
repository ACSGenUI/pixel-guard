import { createTool } from '@mastra/core/tools';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { runVisualTestsWorkflow } from '../workflows/run-visual-tests.js';
import { askYesNo } from './elicit-yes-no.js';
import { appendErrorOutput, formatWorkflowResult } from './format-workflow-result.js';

const MAX_DIFF_IMAGES = 5;

interface DiagnosticSource {
  errorOutput: string | null;
  diffImagePaths: string[];
}

type ImageContentBlock = { type: 'image'; data: string; mimeType: string };

// Reads the screenshot-diff images Playwright wrote for a failed run and attaches them
// as image content blocks alongside the text -- a pixel diff is often the only way to
// actually tell what changed, and text output alone can't show that.
async function buildDiagnostics(summary: string, output: DiagnosticSource): Promise<{ text: string; images: ImageContentBlock[] }> {
  const text = appendErrorOutput(summary, output.errorOutput);
  const selectedPaths = output.diffImagePaths.slice(0, MAX_DIFF_IMAGES);
  const images: ImageContentBlock[] = [];
  for (const path of selectedPaths) {
    try {
      const data = await readFile(path);
      images.push({ type: 'image', data: data.toString('base64'), mimeType: 'image/png' });
    } catch {
      // Skip images that can't be read rather than failing the whole response.
    }
  }
  const omitted = output.diffImagePaths.length - selectedPaths.length;
  const note = images.length > 0
    ? `\n\nAttached ${images.length} screenshot diff image${images.length === 1 ? '' : 's'}${omitted > 0 ? ` (${omitted} more not attached)` : ''}.`
    : '';

  return { text: `${text}${note}`, images };
}

export const runVisualTestsTool = createTool({
  id: 'runVisualTests',
  description: 'Runs the Playwright visual tests (all, or a single block when blockName is given). Use mode to control what happens on failure: "quick" (default) just reports pass/fail, "diagnose" also includes the raw test error output and screenshot diff images, "interactive" asks before revealing diagnostics and before attempting a fix.',
  inputSchema: z.object({
    blockName: z.string().optional().describe('Name of a single block to run visual tests for (e.g. "Columns"). Omit to run the full visual test suite.'),
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted -- required when calling this tool from a host with no notion of the target project (e.g. Mastra Studio).'),
    mode: z.enum(['quick', 'diagnose', 'interactive']).optional().default('quick').describe('What to do if the tests fail: "quick" just reports pass/fail, "diagnose" includes the raw error output and screenshot diff images for debugging, "interactive" asks (via MCP elicitation) before showing diagnostics and before attempting a fix.'),
  }),
  execute: async ({ blockName, projectDir, mode }, context) => {
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

    if (output.visualTestsRan || mode === 'quick') {
      return { content: [{ type: 'text', text: summary }] };
    }

    if (mode === 'diagnose') {
      const { text, images } = await buildDiagnostics(summary, output);
      return { content: [{ type: 'text' as const, text }, ...images] };
    }

    const mcp = context.mcp;
    if (!mcp) {
      // No elicitation support available (e.g. called outside the MCP protocol) -- just
      // return everything we've got rather than silently skipping diagnostics.
      const { text, images } = await buildDiagnostics(summary, output);
      return { content: [{ type: 'text' as const, text }, ...images] };
    }

    const wantsDiagnostics = await askYesNo(
      mcp,
      'Visual tests failed. Would you like to see the detailed error output to diagnose the failure?',
      'runDiagnostics',
    );
    if (!wantsDiagnostics) {
      return { content: [{ type: 'text', text: summary }] };
    }

    const { text: diagnosedText, images } = await buildDiagnostics(summary, output);

    const wantsFix = await askYesNo(
      mcp,
      'Should an attempt be made to fix the underlying issue based on this error output?',
      'attemptFix',
    );
    if (!wantsFix) {
      return { content: [{ type: 'text' as const, text: diagnosedText }, ...images] };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `${diagnosedText}\n\n---\n\nThe user has approved attempting a fix. Analyze the error output and diff images above and fix the underlying issue in the project.`,
        },
        ...images,
      ],
    };
  },
});
