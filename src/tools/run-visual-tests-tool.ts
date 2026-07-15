import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { runVisualTestsWorkflow } from '../workflows/run-visual-tests.js';
import { formatWorkflowResult, withReportLine } from './format-workflow-result.js';

const MAX_ERROR_MESSAGE_LENGTH = 1500;

interface TestOutcome {
  title: string;
  passed: boolean;
  errorMessage: string | null;
  diffImagePaths: string[];
}

interface DiagnosticSource {
  errorOutput: string | null;
  testResults: TestOutcome[] | null;
}

// Lists every block/viewport test with pass/fail (so passing ones are visible too, not just
// an aggregate "tests ran" line), and for failures, the clean per-test error plus a diff
// image file PATH -- not embedded image data. Embedding base64 images previously blew past
// the host's token limit on any run with more than a couple of failures (multiple full-size
// PNGs easily exceed a megabyte of base64 text); a path lets the agent read specific images
// with its own file-reading tool only when it actually needs to look at one.
function buildTestResultsSection(testResults: TestOutcome[]): string {
  const passed = testResults.filter((t) => t.passed).length;
  const lines = [`### Test results (${testResults.length} total, ${passed} passed, ${testResults.length - passed} failed)`, ''];

  for (const test of testResults) {
    lines.push(`${test.passed ? '✅' : '❌'} ${test.title}`);
    if (!test.passed) {
      if (test.errorMessage) {
        const trimmed = test.errorMessage.length > MAX_ERROR_MESSAGE_LENGTH
          ? `${test.errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...`
          : test.errorMessage;
        lines.push(`   ${trimmed.split('\n').join('\n   ')}`);
      }
      for (const diffPath of test.diffImagePaths) {
        lines.push(`   Diff image: ${diffPath}`);
      }
    }
  }

  return lines.join('\n');
}

function buildDiagnostics(summary: string, output: DiagnosticSource): string {
  if (output.testResults) {
    return `${summary}\n\n${buildTestResultsSection(output.testResults)}`;
  }
  // Legacy fallback for a target project installed before the JSON reporter was added --
  // re-running aemVisualTestInstall picks up the updated Playwright config.
  return output.errorOutput ? `${summary}\n\n### Error output\n\n\`\`\`\n${output.errorOutput}\n\`\`\`` : summary;
}

export const runVisualTestsTool = createTool({
  id: 'runVisualTests',
  description: 'Runs the Playwright visual tests (all, or a single block when blockName is given). Use mode to control what happens on failure: "quick" (default) just reports pass/fail, "diagnose" also includes a per-block pass/fail breakdown with error details and diff image paths, "interactive" does the same as "diagnose" and additionally tells you to check with the user before attempting a fix.',
  inputSchema: z.object({
    blockName: z.string().optional().describe('Name of a single block to run visual tests for (e.g. "Columns"). Omit to run the full visual test suite.'),
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted -- required when calling this tool from a host with no notion of the target project (e.g. Mastra Studio).'),
    mode: z.enum(['quick', 'diagnose', 'interactive']).optional().default('quick').describe('What to do if the tests fail: "quick" just reports pass/fail, "diagnose" includes a per-block pass/fail breakdown with error details and diff image paths, "interactive" includes the same plus an explicit reminder to confirm with the user before attempting a fix.'),
  }),
  execute: async ({ blockName, projectDir, mode }) => {
    const run = await runVisualTestsWorkflow.createRun();
    const result = await run.start({ inputData: { blockName, projectDir } });
    const output = result.status === 'success' ? result.result : undefined;

    if (!output) {
      return { content: [{ type: 'text', text: `Run Visual Tests did not complete (status: ${result.status}).` }] };
    }

    const summary = withReportLine(formatWorkflowResult('Run Visual Tests', [
      { label: 'Docker installed', success: output.dockerInstalled, message: output.dockerMessage },
      { label: 'Project structure valid', success: output.projectStructureValid, message: output.projectStructureMessage },
      { label: 'Dev server started', success: output.devServerStarted, message: output.devServerMessage },
      { label: 'Visual tests ran', success: output.visualTestsRan, message: output.visualTestsRanMessage },
      { label: 'Dev server stopped', success: output.devServerStopped, message: output.devServerStoppedMessage },
    ]), output.reportUrl);

    // Show the per-block breakdown whenever we have it, even on a passing run and even in
    // "quick" mode -- that's the whole point of listing which blocks passed, not just that
    // "tests ran" succeeded.
    const withTestResults = output.testResults
      ? `${summary}\n\n${buildTestResultsSection(output.testResults)}`
      : summary;

    if (output.visualTestsRan || mode === 'quick') {
      return { content: [{ type: 'text', text: withTestResults }] };
    }

    const diagnosedText = buildDiagnostics(summary, output);

    if (mode === 'diagnose') {
      return { content: [{ type: 'text', text: diagnosedText }] };
    }

    return {
      content: [{
        type: 'text',
        text: `${diagnosedText}\n\n---\n\nAsk the user whether they'd like you to attempt a fix based on this error output (and diff images, if useful) before making any changes.`,
      }],
    };
  },
});
