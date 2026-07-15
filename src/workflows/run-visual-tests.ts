import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { checkPrerequisitesStep, checkProjectStructureStep } from './aem-visual-test-install.js';
import { blockSpecExists, listAvailableBlocks, resolveBlockSpecPath } from './block-spec.js';
import { startDevServer, stopDevServer } from './dev-server.js';
import { resolveProjectDir } from './project-dir.js';
import { getReportUrl, withReportUrl } from './report-server.js';
import { findDiffImages } from './test-artifacts.js';

const execFileAsync = promisify(execFile);

const MAX_ERROR_OUTPUT_LENGTH = 8000;

// execFile's rejection carries the raw stdout/stderr from the failed command (Playwright's
// actual test-failure details -- assertion diffs, stack traces) beyond the generic
// "Command failed" message, which is what an agent needs to actually diagnose a failure.
function extractErrorOutput(error: unknown): string | null {
  const { stdout, stderr } = error as { stdout?: string; stderr?: string };
  const combined = [stdout, stderr].filter((part): part is string => Boolean(part && part.trim())).join('\n');
  if (!combined) {
    return null;
  }
  return combined.length > MAX_ERROR_OUTPUT_LENGTH ? combined.slice(-MAX_ERROR_OUTPUT_LENGTH) : combined;
}

// Bridges the workflow's { blockName?, projectDir? } input to checkPrerequisitesStep's
// narrower inputSchema. Both fields are read downstream via getInitData(), not through
// this pass-through.
export const readWorkflowInputStep = createStep({
  id: 'read-workflow-input',
  description: 'Reads the workflow input; blockName and projectDir (if any) are picked up later via getInitData().',
  inputSchema: z.object({
    blockName: z.string().optional(),
    projectDir: z.string().optional(),
  }),
  outputSchema: z.object({}),
  execute: async () => ({}),
});

export const startDevServerForRunStep = createStep({
  id: 'start-dev-server',
  description: 'Starts the AEM dev server and visual-test server via npm run start, if prerequisites are met.',
  inputSchema: checkProjectStructureStep.outputSchema,
  outputSchema: z.object({
    devServerStarted: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ getStepResult, getInitData }) => {
    const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
    const { projectStructureValid } = getStepResult(checkProjectStructureStep);
    if (!dockerInstalled || !projectStructureValid) {
      return {
        devServerStarted: false,
        message: 'Skipped starting the dev server because prerequisites were not met.',
      };
    }
    const targetDir = resolveProjectDir(getInitData<{ projectDir?: string }>().projectDir);
    const { started, message } = await startDevServer(targetDir);
    return { devServerStarted: started, message };
  },
});

export const runVisualTestsStep = createStep({
  id: 'run-visual-tests',
  description: 'Runs the Playwright visual tests via npm run test:visual, or npm run test:visual:block for a single block when blockName is provided, if prerequisites are met.',
  inputSchema: startDevServerForRunStep.outputSchema,
  outputSchema: z.object({
    visualTestsRan: z.boolean(),
    message: z.string(),
    reportUrl: z.string().nullable(),
    errorOutput: z.string().nullable(),
    diffImagePaths: z.array(z.string()),
  }),
  execute: async ({ getStepResult, getInitData }) => {
    const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
    const { projectStructureValid } = getStepResult(checkProjectStructureStep);
    const { devServerStarted } = getStepResult(startDevServerForRunStep);
    if (!dockerInstalled || !projectStructureValid || !devServerStarted) {
      return {
        visualTestsRan: false,
        message: 'Skipped running visual tests because prerequisites were not met.',
        reportUrl: null,
        errorOutput: null,
        diffImagePaths: [],
      };
    }

    const { blockName, projectDir } = getInitData<{ blockName?: string; projectDir?: string }>();
    const targetDir = resolveProjectDir(projectDir);

    if (!blockName) {
      try {
        await execFileAsync('npm', ['run', 'test:visual'], { cwd: targetDir });
        const reportUrl = await getReportUrl(targetDir);
        return {
          visualTestsRan: true,
          message: withReportUrl('Ran all visual tests.', reportUrl),
          reportUrl,
          errorOutput: null,
          diffImagePaths: [],
        };
      } catch (error) {
        const reportUrl = await getReportUrl(targetDir);
        return {
          visualTestsRan: false,
          message: withReportUrl(`Visual tests failed: ${(error as Error).message}`, reportUrl),
          reportUrl,
          errorOutput: extractErrorOutput(error),
          diffImagePaths: await findDiffImages(targetDir),
        };
      }
    }

    const specPath = resolveBlockSpecPath(blockName);
    if (!(await blockSpecExists(targetDir, specPath))) {
      const available = await listAvailableBlocks(targetDir);
      return {
        visualTestsRan: false,
        message: available.length > 0
          ? `No visual test found for block "${blockName}" (expected ${specPath}). Available blocks: ${available.join(', ')}.`
          : `No visual test found for block "${blockName}" (expected ${specPath}). No block tests have been generated yet -- run generate-visual-tests first.`,
        reportUrl: null,
        errorOutput: null,
        diffImagePaths: [],
      };
    }

    try {
      await execFileAsync('npm', ['run', 'test:visual:block', '--', specPath], { cwd: targetDir });
      const reportUrl = await getReportUrl(targetDir);
      return {
        visualTestsRan: true,
        message: withReportUrl(`Ran visual tests for block "${blockName}".`, reportUrl),
        reportUrl,
        errorOutput: null,
        diffImagePaths: [],
      };
    } catch (error) {
      const reportUrl = await getReportUrl(targetDir);
      return {
        visualTestsRan: false,
        message: withReportUrl(`Visual tests for block "${blockName}" failed: ${(error as Error).message}`, reportUrl),
        errorOutput: extractErrorOutput(error),
        reportUrl,
        diffImagePaths: await findDiffImages(targetDir),
      };
    }
  },
});

export const stopDevServerAfterRunStep = createStep({
  id: 'stop-dev-server',
  description: 'Stops the dev server started for this visual test run, if one was started.',
  inputSchema: runVisualTestsStep.outputSchema,
  outputSchema: z.object({
    devServerStopped: z.boolean(),
    message: z.string(),
  }),
  execute: async () => {
    const { stopped, message } = stopDevServer();
    return { devServerStopped: stopped, message };
  },
});

export const runVisualTestsWorkflow = createWorkflow({
  id: 'run-visual-tests',
  description: 'Runs the Playwright visual tests. With no blockName, runs the full suite (npm run test:visual). With a blockName, runs only that block\'s generated spec (npm run test:visual:block). Starts the AEM dev server first and stops it afterward. Assumes the visual-test environment (npm dependencies, Docker image, generated block specs) was already installed via aem-visual-test-install and generate-visual-tests.',
  inputSchema: z.object({
    blockName: z.string().optional().describe('Name of a single block to run visual tests for (e.g. "Columns"). Omit to run the full visual test suite.'),
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted.'),
  }),
  outputSchema: z.object({
    dockerInstalled: z.boolean(),
    dockerMessage: z.string(),
    projectStructureValid: z.boolean(),
    projectStructureMessage: z.string(),
    devServerStarted: z.boolean(),
    devServerMessage: z.string(),
    visualTestsRan: z.boolean(),
    visualTestsRanMessage: z.string(),
    reportUrl: z.string().nullable(),
    errorOutput: z.string().nullable(),
    diffImagePaths: z.array(z.string()),
    devServerStopped: z.boolean(),
    devServerStoppedMessage: z.string(),
  }),
})
  .then(readWorkflowInputStep)
  .then(checkPrerequisitesStep)
  .then(checkProjectStructureStep)
  .then(startDevServerForRunStep)
  .then(runVisualTestsStep)
  .then(stopDevServerAfterRunStep)
  .map({
    dockerInstalled: { step: checkPrerequisitesStep, path: 'dockerInstalled' },
    dockerMessage: { step: checkPrerequisitesStep, path: 'message' },
    projectStructureValid: { step: checkProjectStructureStep, path: 'projectStructureValid' },
    projectStructureMessage: { step: checkProjectStructureStep, path: 'message' },
    devServerStarted: { step: startDevServerForRunStep, path: 'devServerStarted' },
    devServerMessage: { step: startDevServerForRunStep, path: 'message' },
    visualTestsRan: { step: runVisualTestsStep, path: 'visualTestsRan' },
    visualTestsRanMessage: { step: runVisualTestsStep, path: 'message' },
    reportUrl: { step: runVisualTestsStep, path: 'reportUrl' },
    errorOutput: { step: runVisualTestsStep, path: 'errorOutput' },
    diffImagePaths: { step: runVisualTestsStep, path: 'diffImagePaths' },
    devServerStopped: { step: stopDevServerAfterRunStep, path: 'devServerStopped' },
    devServerStoppedMessage: { step: stopDevServerAfterRunStep, path: 'message' },
  })
  .commit();
