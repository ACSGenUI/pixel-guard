import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { installGithubWorkflow, installHuskyHook } from '../workflows/post-install.js';
import { resolveProjectDir } from '../workflows/project-dir.js';
export const installVisualTestAutomationTool = createTool({
    id: 'installVisualTestAutomation',
    description: 'Sets up automatic visual-test runs in a project already installed via aemVisualTestInstall: a GitHub Actions workflow that runs the tests on pull requests, and/or a Husky pre-commit hook that runs them before each commit. Ask the user which of these (if any) they want before calling this tool -- it installs exactly what you tell it to, without asking.',
    inputSchema: z.object({
        githubWorkflow: z.boolean().optional().default(false).describe('Set up the GitHub Actions workflow (.github/workflows/visual-tests.yaml) that runs visual tests on pull requests.'),
        huskyPreCommitHook: z.boolean().optional().default(false).describe('Set up the Husky pre-commit hook (.husky/pre-commit) that runs visual tests before each commit.'),
        projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted.'),
    }),
    execute: async ({ githubWorkflow, huskyPreCommitHook, projectDir }) => {
        if (!githubWorkflow && !huskyPreCommitHook) {
            return {
                content: [{
                        type: 'text',
                        text: 'Nothing to install -- set githubWorkflow and/or huskyPreCommitHook to true to install one or both.',
                    }],
            };
        }
        const targetDir = resolveProjectDir(projectDir);
        const lines = [];
        if (githubWorkflow) {
            try {
                await installGithubWorkflow(targetDir);
                lines.push('✅ **GitHub Actions workflow** — installed at .github/workflows/visual-tests.yaml.');
            }
            catch (error) {
                lines.push(`❌ **GitHub Actions workflow** — failed to install: ${error.message}`);
            }
        }
        if (huskyPreCommitHook) {
            try {
                await installHuskyHook(targetDir);
                lines.push('✅ **Husky pre-commit hook** — installed at .husky/pre-commit (added "prepare": "husky install" to package.json; run npm install to activate it).');
            }
            catch (error) {
                lines.push(`❌ **Husky pre-commit hook** — failed to install: ${error.message}`);
            }
        }
        return { content: [{ type: 'text', text: `## Install Visual Test Automation\n\n${lines.join('\n')}` }] };
    },
});
