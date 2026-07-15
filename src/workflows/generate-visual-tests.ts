import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { checkPrerequisitesStep, checkProjectStructureStep, SIDEKICK_SETUP_MESSAGE } from './aem-visual-test-install.js';
import { startDevServer, stopDevServer } from './dev-server.js';

const execFileAsync = promisify(execFile);

export const startDevServerForGenerateStep = createStep({
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

export const generateVisualTestsOnlyStep = createStep({
  id: 'generate-visual-tests',
  description: 'Generates visual tests via npm run test:visual:generate, if prerequisites are met.',
  inputSchema: startDevServerForGenerateStep.outputSchema,
  outputSchema: z.object({
    visualTestsGenerated: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ getStepResult }) => {
    const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
    const { projectStructureValid } = getStepResult(checkProjectStructureStep);
    const { devServerStarted } = getStepResult(startDevServerForGenerateStep);
    if (!dockerInstalled || !projectStructureValid || !devServerStarted) {
      return {
        visualTestsGenerated: false,
        message: 'Skipped generating visual tests because prerequisites were not met.',
      };
    }
    try {
      await execFileAsync('npm', ['run', 'test:visual:generate'], { cwd: process.cwd() });
      return { visualTestsGenerated: true, message: 'Generated visual tests.' };
    } catch (error) {
      return {
        visualTestsGenerated: false,
        message: `${SIDEKICK_SETUP_MESSAGE}\n\n${(error as Error).message}`,
      };
    }
  },
});

export const stopDevServerAfterGenerateStep = createStep({
  id: 'stop-dev-server',
  description: 'Stops the dev server started for this visual-test generation run, if one was started.',
  inputSchema: generateVisualTestsOnlyStep.outputSchema,
  outputSchema: z.object({
    devServerStopped: z.boolean(),
    message: z.string(),
  }),
  execute: async () => {
    const { stopped, message } = stopDevServer();
    return { devServerStopped: stopped, message };
  },
});

export const generateVisualTestsWorkflow = createWorkflow({
  id: 'generate-visual-tests',
  description: 'Regenerates Playwright visual tests from the current sidekick library blocks: starts the AEM dev server, runs npm run test:visual:generate, then stops the dev server. Assumes the visual-test environment (npm dependencies, Docker image) was already installed via the aem-visual-test-install workflow.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    dockerInstalled: z.boolean(),
    dockerMessage: z.string(),
    projectStructureValid: z.boolean(),
    projectStructureMessage: z.string(),
    devServerStarted: z.boolean(),
    devServerMessage: z.string(),
    visualTestsGenerated: z.boolean(),
    visualTestsGeneratedMessage: z.string(),
    devServerStopped: z.boolean(),
    devServerStoppedMessage: z.string(),
  }),
})
  .then(checkPrerequisitesStep)
  .then(checkProjectStructureStep)
  .then(startDevServerForGenerateStep)
  .then(generateVisualTestsOnlyStep)
  .then(stopDevServerAfterGenerateStep)
  .map({
    dockerInstalled: { step: checkPrerequisitesStep, path: 'dockerInstalled' },
    dockerMessage: { step: checkPrerequisitesStep, path: 'message' },
    projectStructureValid: { step: checkProjectStructureStep, path: 'projectStructureValid' },
    projectStructureMessage: { step: checkProjectStructureStep, path: 'message' },
    devServerStarted: { step: startDevServerForGenerateStep, path: 'devServerStarted' },
    devServerMessage: { step: startDevServerForGenerateStep, path: 'message' },
    visualTestsGenerated: { step: generateVisualTestsOnlyStep, path: 'visualTestsGenerated' },
    visualTestsGeneratedMessage: { step: generateVisualTestsOnlyStep, path: 'message' },
    devServerStopped: { step: stopDevServerAfterGenerateStep, path: 'devServerStopped' },
    devServerStoppedMessage: { step: stopDevServerAfterGenerateStep, path: 'message' },
  })
  .commit();
