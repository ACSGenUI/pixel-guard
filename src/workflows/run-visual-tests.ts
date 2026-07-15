import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { checkPrerequisitesStep, checkProjectStructureStep } from './aem-visual-test-install.js';
import { startDevServer, stopDevServer } from './dev-server.js';

const execFileAsync = promisify(execFile);

function slugifyBlockName(blockName: string): string {
  return blockName.toLowerCase().replace(/\s+/g, '-');
}

async function listAvailableBlocks(baseDir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(baseDir, 'tools', 'visual-tests', 'blocks'), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

// Bridges the workflow's { blockName? } input to checkPrerequisitesStep's empty inputSchema.
// blockName itself is read downstream via getInitData(), not through this pass-through.
export const readWorkflowInputStep = createStep({
  id: 'read-workflow-input',
  description: 'Reads the workflow input; blockName (if any) is picked up later via getInitData().',
  inputSchema: z.object({
    blockName: z.string().optional(),
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
  execute: async ({ getStepResult }) => {
    const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
    const { projectStructureValid } = getStepResult(checkProjectStructureStep);
    if (!dockerInstalled || !projectStructureValid) {
      return {
        devServerStarted: false,
        message: 'Skipped starting the dev server because prerequisites were not met.',
      };
    }
    const { started, message } = await startDevServer(process.cwd());
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
  }),
  execute: async ({ getStepResult, getInitData }) => {
    const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
    const { projectStructureValid } = getStepResult(checkProjectStructureStep);
    const { devServerStarted } = getStepResult(startDevServerForRunStep);
    if (!dockerInstalled || !projectStructureValid || !devServerStarted) {
      return {
        visualTestsRan: false,
        message: 'Skipped running visual tests because prerequisites were not met.',
      };
    }

    const { blockName } = getInitData<{ blockName?: string }>();

    if (!blockName) {
      try {
        await execFileAsync('npm', ['run', 'test:visual'], { cwd: process.cwd() });
        return { visualTestsRan: true, message: 'Ran all visual tests.' };
      } catch (error) {
        return { visualTestsRan: false, message: `Visual tests failed: ${(error as Error).message}` };
      }
    }

    const slug = slugifyBlockName(blockName);
    const specPath = join('tools', 'visual-tests', 'blocks', slug, `${slug}.spec.js`);
    try {
      await access(join(process.cwd(), specPath));
    } catch {
      const available = await listAvailableBlocks(process.cwd());
      return {
        visualTestsRan: false,
        message: available.length > 0
          ? `No visual test found for block "${blockName}" (expected ${specPath}). Available blocks: ${available.join(', ')}.`
          : `No visual test found for block "${blockName}" (expected ${specPath}). No block tests have been generated yet -- run generate-visual-tests first.`,
      };
    }

    try {
      await execFileAsync('npm', ['run', 'test:visual:block', '--', specPath], { cwd: process.cwd() });
      return { visualTestsRan: true, message: `Ran visual tests for block "${blockName}".` };
    } catch (error) {
      return {
        visualTestsRan: false,
        message: `Visual tests for block "${blockName}" failed: ${(error as Error).message}`,
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
    devServerStopped: { step: stopDevServerAfterRunStep, path: 'devServerStopped' },
    devServerStoppedMessage: { step: stopDevServerAfterRunStep, path: 'message' },
  })
  .commit();
