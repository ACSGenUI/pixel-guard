import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { aemVisualTestInstallWorkflow } from '../workflows/aem-visual-test-install.js';
import { formatWorkflowResult } from './format-workflow-result.js';
export const aemVisualTestInstallTool = createTool({
    id: 'aemVisualTestInstall',
    description: 'Installs/scaffolds the AEM Visual Test environment in the target project: checks prerequisites, copies required files, updates project config, installs dependencies, and generates visual tests. If the install succeeds, ask the user whether they also want a GitHub Actions workflow and/or a Husky pre-commit hook set up (the response tells you to), then call installVisualTestAutomation with their answer.',
    inputSchema: z.object({
        projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted.'),
    }),
    execute: async ({ projectDir }) => {
        const run = await aemVisualTestInstallWorkflow.createRun();
        const result = await run.start({ inputData: { projectDir } });
        const output = result.status === 'success' ? result.result : undefined;
        if (!output) {
            return { content: [{ type: 'text', text: `AEM Visual Test Install did not complete (status: ${result.status}).` }] };
        }
        const steps = [
            { label: 'Docker installed', success: output.dockerInstalled, message: output.dockerMessage },
            { label: 'Project structure valid', success: output.projectStructureValid, message: output.projectStructureMessage },
            { label: 'Files copied', success: output.filesCopied, message: output.filesCopiedMessage },
            { label: 'Config updated', success: output.configUpdated, message: output.configUpdatedMessage },
            { label: 'npm install', success: output.npmInstallSucceeded, message: output.npmInstallMessage },
            { label: 'Dev server started', success: output.devServerStarted, message: output.devServerMessage },
            { label: 'Docker image built', success: output.dockerBuildSucceeded, message: output.dockerBuildMessage },
            { label: 'Visual tests generated', success: output.visualTestsGenerated, message: output.visualTestsGeneratedMessage },
            { label: 'Dev server stopped', success: output.devServerStopped, message: output.devServerStoppedMessage },
        ];
        const summary = formatWorkflowResult('AEM Visual Test Install', steps);
        const installSucceeded = steps.every((step) => step.success);
        const text = installSucceeded
            ? `${summary}\n\n---\n\nAsk the user whether they'd also like a GitHub Actions workflow (runs visual tests on pull requests) and/or a Husky pre-commit hook (runs visual tests before each commit) set up. If they want either, call installVisualTestAutomation with githubWorkflow and/or huskyPreCommitHook set to true -- don't hand-write these files yourself, that tool installs the real, tested templates.`
            : summary;
        return { content: [{ type: 'text', text }] };
    },
});
