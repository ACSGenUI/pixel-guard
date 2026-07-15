import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { aemVisualTestInstallWorkflow } from '../workflows/aem-visual-test-install.js';
import { installGithubWorkflow, installHuskyHook } from '../workflows/post-install.js';
import { resolveProjectDir } from '../workflows/project-dir.js';
import { askMultipleYesNo } from './elicit-yes-no.js';
import { formatWorkflowResult } from './format-workflow-result.js';

export const aemVisualTestInstallTool = createTool({
  id: 'aemVisualTestInstall',
  description: 'Installs/scaffolds the AEM Visual Test environment in the target project: checks prerequisites, copies required files, updates project config, installs dependencies, and generates visual tests. If the install succeeds, asks whether to also set up a GitHub Actions workflow and/or a Husky pre-commit hook to run the visual tests automatically.',
  inputSchema: z.object({
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted.'),
  }),
  execute: async ({ projectDir }, context) => {
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

    const mcp = context.mcp;
    if (!installSucceeded || !mcp) {
      return { content: [{ type: 'text', text: summary }] };
    }

    const { githubWorkflow, huskyPreCommitHook } = await askMultipleYesNo(
      mcp,
      'Set up automatic visual test checks?',
      {
        githubWorkflow: 'GitHub Actions workflow (runs visual tests on pull requests)',
        huskyPreCommitHook: 'Husky pre-commit hook (runs visual tests before each commit)',
      },
    );

    if (!githubWorkflow && !huskyPreCommitHook) {
      return { content: [{ type: 'text', text: summary }] };
    }

    const targetDir = resolveProjectDir(projectDir);
    const extraLines: string[] = [];

    if (githubWorkflow) {
      try {
        await installGithubWorkflow(targetDir);
        extraLines.push('✅ **GitHub Actions workflow** — installed at .github/workflows/visual-tests.yaml.');
      } catch (error) {
        extraLines.push(`❌ **GitHub Actions workflow** — failed to install: ${(error as Error).message}`);
      }
    }

    if (huskyPreCommitHook) {
      try {
        await installHuskyHook(targetDir);
        extraLines.push('✅ **Husky pre-commit hook** — installed at .husky/pre-commit (added "prepare": "husky install" to package.json; run npm install to activate it).');
      } catch (error) {
        extraLines.push(`❌ **Husky pre-commit hook** — failed to install: ${(error as Error).message}`);
      }
    }

    return { content: [{ type: 'text', text: `${summary}\n\n### Additional setup\n\n${extraLines.join('\n')}` }] };
  },
});
