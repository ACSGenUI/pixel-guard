import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { checkPrerequisitesStep, checkProjectStructureStep } from './aem-visual-test-install.js';
import { blockSpecExists, listAvailableBlocks, resolveBlockSpecPath } from './block-spec.js';
import { startDevServer, stopDevServer } from './dev-server.js';

const execFileAsync = promisify(execFile);

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

export const startDevServerForUpdateStep = createStep({
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

export const updateVisualSnapshotsStep = createStep({
  id: 'update-visual-snapshots',
  description: 'Updates the Playwright visual snapshots via npm run test:visual:update, or scoped to a single block spec when blockName is provided, if prerequisites are met.',
  inputSchema: startDevServerForUpdateStep.outputSchema,
  outputSchema: z.object({
    snapshotsUpdated: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ getStepResult, getInitData }) => {
    const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
    const { projectStructureValid } = getStepResult(checkProjectStructureStep);
    const { devServerStarted } = getStepResult(startDevServerForUpdateStep);
    if (!dockerInstalled || !projectStructureValid || !devServerStarted) {
      return {
        snapshotsUpdated: false,
        message: 'Skipped updating visual snapshots because prerequisites were not met.',
      };
    }

    const { blockName } = getInitData<{ blockName?: string }>();

    if (!blockName) {
      try {
        await execFileAsync('npm', ['run', 'test:visual:update'], { cwd: process.cwd() });
        return { snapshotsUpdated: true, message: 'Updated all visual snapshots.' };
      } catch (error) {
        return { snapshotsUpdated: false, message: `Updating visual snapshots failed: ${(error as Error).message}` };
      }
    }

    const specPath = resolveBlockSpecPath(blockName);
    if (!(await blockSpecExists(process.cwd(), specPath))) {
      const available = await listAvailableBlocks(process.cwd());
      return {
        snapshotsUpdated: false,
        message: available.length > 0
          ? `No visual test found for block "${blockName}" (expected ${specPath}). Available blocks: ${available.join(', ')}.`
          : `No visual test found for block "${blockName}" (expected ${specPath}). No block tests have been generated yet -- run generate-visual-tests first.`,
      };
    }

    try {
      await execFileAsync('npm', ['run', 'test:visual:update', '--', specPath], { cwd: process.cwd() });
      return { snapshotsUpdated: true, message: `Updated visual snapshots for block "${blockName}".` };
    } catch (error) {
      return {
        snapshotsUpdated: false,
        message: `Updating visual snapshots for block "${blockName}" failed: ${(error as Error).message}`,
      };
    }
  },
});

export const stopDevServerAfterUpdateStep = createStep({
  id: 'stop-dev-server',
  description: 'Stops the dev server started for this snapshot update run, if one was started.',
  inputSchema: updateVisualSnapshotsStep.outputSchema,
  outputSchema: z.object({
    devServerStopped: z.boolean(),
    message: z.string(),
  }),
  execute: async () => {
    const { stopped, message } = stopDevServer();
    return { devServerStopped: stopped, message };
  },
});

export const updateVisualSnapshotsWorkflow = createWorkflow({
  id: 'update-visual-snapshots',
  description: 'Updates the Playwright visual snapshot baselines. With no blockName, updates snapshots for the full suite (npm run test:visual:update). With a blockName, updates snapshots for only that block\'s generated spec. Starts the AEM dev server first and stops it afterward. Assumes the visual-test environment (npm dependencies, Docker image, generated block specs) was already installed via aem-visual-test-install and generate-visual-tests.',
  inputSchema: z.object({
    blockName: z.string().optional().describe('Name of a single block to update visual snapshots for (e.g. "Columns"). Omit to update snapshots for the full visual test suite.'),
  }),
  outputSchema: z.object({
    dockerInstalled: z.boolean(),
    dockerMessage: z.string(),
    projectStructureValid: z.boolean(),
    projectStructureMessage: z.string(),
    devServerStarted: z.boolean(),
    devServerMessage: z.string(),
    snapshotsUpdated: z.boolean(),
    snapshotsUpdatedMessage: z.string(),
    devServerStopped: z.boolean(),
    devServerStoppedMessage: z.string(),
  }),
})
  .then(readWorkflowInputStep)
  .then(checkPrerequisitesStep)
  .then(checkProjectStructureStep)
  .then(startDevServerForUpdateStep)
  .then(updateVisualSnapshotsStep)
  .then(stopDevServerAfterUpdateStep)
  .map({
    dockerInstalled: { step: checkPrerequisitesStep, path: 'dockerInstalled' },
    dockerMessage: { step: checkPrerequisitesStep, path: 'message' },
    projectStructureValid: { step: checkProjectStructureStep, path: 'projectStructureValid' },
    projectStructureMessage: { step: checkProjectStructureStep, path: 'message' },
    devServerStarted: { step: startDevServerForUpdateStep, path: 'devServerStarted' },
    devServerMessage: { step: startDevServerForUpdateStep, path: 'message' },
    snapshotsUpdated: { step: updateVisualSnapshotsStep, path: 'snapshotsUpdated' },
    snapshotsUpdatedMessage: { step: updateVisualSnapshotsStep, path: 'message' },
    devServerStopped: { step: stopDevServerAfterUpdateStep, path: 'devServerStopped' },
    devServerStoppedMessage: { step: stopDevServerAfterUpdateStep, path: 'message' },
  })
  .commit();
