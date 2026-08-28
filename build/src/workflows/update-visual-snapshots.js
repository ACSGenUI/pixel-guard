import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { checkPrerequisitesStep, checkProjectStructureStep } from './aem-visual-test-install.js';
import { blockSpecExists, listAvailableBlocks, resolveBlockSpecPath } from './block-spec.js';
import { startDevServer, stopDevServer } from './dev-server.js';
import { resolveProjectDir } from './project-dir.js';
import { getReportUrl } from './report-server.js';
const execFileAsync = promisify(execFile);
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
export const startDevServerForUpdateStep = createStep({
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
        const targetDir = resolveProjectDir(getInitData().projectDir);
        const { started, message } = await startDevServer(targetDir);
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
        reportUrl: z.string().nullable(),
    }),
    execute: async ({ getStepResult, getInitData }) => {
        const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
        const { projectStructureValid } = getStepResult(checkProjectStructureStep);
        const { devServerStarted } = getStepResult(startDevServerForUpdateStep);
        if (!dockerInstalled || !projectStructureValid || !devServerStarted) {
            return {
                snapshotsUpdated: false,
                message: 'Skipped updating visual snapshots because prerequisites were not met.',
                reportUrl: null,
            };
        }
        const { blockName, projectDir } = getInitData();
        const targetDir = resolveProjectDir(projectDir);
        if (!blockName) {
            try {
                await execFileAsync('npm', ['run', 'test:visual:update'], { cwd: targetDir });
                const reportUrl = await getReportUrl(targetDir);
                return { snapshotsUpdated: true, message: 'Updated all visual snapshots.', reportUrl };
            }
            catch (error) {
                const reportUrl = await getReportUrl(targetDir);
                return {
                    snapshotsUpdated: false,
                    message: `Updating visual snapshots failed: ${error.message}`,
                    reportUrl,
                };
            }
        }
        const specPath = resolveBlockSpecPath(blockName);
        if (!(await blockSpecExists(targetDir, specPath))) {
            const available = await listAvailableBlocks(targetDir);
            return {
                snapshotsUpdated: false,
                message: available.length > 0
                    ? `No visual test found for block "${blockName}" (expected ${specPath}). Available blocks: ${available.join(', ')}.`
                    : `No visual test found for block "${blockName}" (expected ${specPath}). No block tests have been generated yet -- run generate-visual-tests first.`,
                reportUrl: null,
            };
        }
        try {
            await execFileAsync('npm', ['run', 'test:visual:update', '--', specPath], { cwd: targetDir });
            const reportUrl = await getReportUrl(targetDir);
            return {
                snapshotsUpdated: true,
                message: `Updated visual snapshots for block "${blockName}".`,
                reportUrl,
            };
        }
        catch (error) {
            const reportUrl = await getReportUrl(targetDir);
            return {
                snapshotsUpdated: false,
                message: `Updating visual snapshots for block "${blockName}" failed: ${error.message}`,
                reportUrl,
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
        projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted.'),
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
        reportUrl: z.string().nullable(),
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
    reportUrl: { step: updateVisualSnapshotsStep, path: 'reportUrl' },
    devServerStopped: { step: stopDevServerAfterUpdateStep, path: 'devServerStopped' },
    devServerStoppedMessage: { step: stopDevServerAfterUpdateStep, path: 'message' },
})
    .commit();
