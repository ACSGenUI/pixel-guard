import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { access, cp } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { mergePackageJson, appendMissingLines, addLoadScriptImport, addSidekickLibraryLoader } from './update-project-config.js';
import { scripts, dependenciesToAdd, devDependenciesToAdd, gitignoreLines, hlxignoreLines } from '../../aem-visual-checker/changes.js';
import { startDevServer, stopDevServer } from './dev-server.js';
import { resolveProjectDir } from './project-dir.js';
const execFileAsync = promisify(execFile);
const DOCKER_INSTALL_MESSAGE = `Please install Docker.

macOS:
  - Download Docker Desktop: https://www.docker.com/products/docker-desktop
  - Or via Homebrew: brew install --cask docker

Windows:
  - Download Docker Desktop: https://www.docker.com/products/docker-desktop
  - Or via winget: winget install Docker.DockerDesktop`;
export const SIDEKICK_SETUP_MESSAGE = `Generating visual tests failed. This usually means the sidekick library is not set up correctly.
Please follow the setup instructions here: https://www.aem.live/docs/sidekick-library

  1. Start by creating a directory in you authoring environment - /tools/sidekick in the root of the mountpoint.
  2. Create a directory inside the /tools/sidekick directory where you will store all the block variations. Directory should be called blocks and should be inside /tools/sidekick.
  3. For this example, let's assume we want to define all the variations of a block called columns. First create a Word document called columns inside the blocks directory and provide examples of all the variations of the columns block. After each variation of the block add in a section delimiter.
  4. Create a sheet called library in the /tools/sidekick directory and add the name of the block and the path to the Word document that contains the variations of the block.

Debug points:
  - Check if all pages are published.
  - Manually check if this looks right in this link: http://localhost:3000/tools/sidekick/library.html`;
const REQUIRED_PROJECT_PATHS = [
    { relativePath: 'blocks', label: 'blocks/ folder' },
    { relativePath: 'scripts/aem.js', label: 'scripts/aem.js' },
    { relativePath: 'package.json', label: 'package.json' },
    { relativePath: 'head.html', label: 'head.html' },
];
export async function findMissingProjectPaths(baseDir) {
    const missing = [];
    for (const { relativePath, label } of REQUIRED_PROJECT_PATHS) {
        try {
            await access(join(baseDir, relativePath));
        }
        catch {
            missing.push(label);
        }
    }
    return missing;
}
const ASSETS_SOURCE_DIR = fileURLToPath(new URL('../../aem-visual-checker', import.meta.url));
export async function copyRequiredFiles(sourceDir, targetDir) {
    await cp(join(sourceDir, 'tools'), join(targetDir, 'tools'), {
        recursive: true,
        force: true,
        filter: (source) => basename(source) !== '.DS_Store',
    });
    await cp(join(sourceDir, '.dockerignore'), join(targetDir, '.dockerignore'), { force: true });
    await cp(join(sourceDir, '.env.example'), join(targetDir, '.env.example'), { force: true });
}
export const checkPrerequisitesStep = createStep({
    id: 'check-prerequisites',
    description: 'Checks that Docker is installed on the system.',
    inputSchema: z.object({
        projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted.'),
    }),
    outputSchema: z.object({
        dockerInstalled: z.boolean(),
        message: z.string(),
    }),
    execute: async () => {
        try {
            await execFileAsync('docker', ['--version']);
            return { dockerInstalled: true, message: 'Installation successful.' };
        }
        catch {
            return { dockerInstalled: false, message: DOCKER_INSTALL_MESSAGE };
        }
    },
});
export const checkProjectStructureStep = createStep({
    id: 'check-project-structure',
    description: 'Checks that the current project has the required AEM Edge Delivery Services file structure (blocks folder, scripts/aem.js, package.json, head.html).',
    inputSchema: checkPrerequisitesStep.outputSchema,
    outputSchema: z.object({
        projectStructureValid: z.boolean(),
        message: z.string(),
    }),
    execute: async ({ getInitData }) => {
        const targetDir = resolveProjectDir(getInitData().projectDir);
        const missing = await findMissingProjectPaths(targetDir);
        if (missing.length === 0) {
            return { projectStructureValid: true, message: 'Project structure is valid.' };
        }
        return {
            projectStructureValid: false,
            message: `Missing required project files: ${missing.join(', ')}. This does not look like an AEM Edge Delivery Services project.`,
        };
    },
});
export const copyRequiredFilesStep = createStep({
    id: 'copy-required-files',
    description: 'Copies the tools/ folder, .dockerignore, and .env.example into the target project, if prerequisites are met.',
    inputSchema: checkProjectStructureStep.outputSchema,
    outputSchema: z.object({
        filesCopied: z.boolean(),
        message: z.string(),
    }),
    execute: async ({ getStepResult, getInitData }) => {
        const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
        const { projectStructureValid } = getStepResult(checkProjectStructureStep);
        if (!dockerInstalled || !projectStructureValid) {
            return {
                filesCopied: false,
                message: 'Skipped copying required files because prerequisites were not met.',
            };
        }
        const targetDir = resolveProjectDir(getInitData().projectDir);
        await copyRequiredFiles(ASSETS_SOURCE_DIR, targetDir);
        return {
            filesCopied: true,
            message: 'Copied tools/, .dockerignore, and .env.example to the project.',
        };
    },
});
export const updateProjectConfigStep = createStep({
    id: 'update-project-config',
    description: 'Merges visual-test npm scripts/dependencies into package.json, appends ignore entries to .gitignore and .hlxignore, and wires the sidekick library loader into scripts/scripts.js, if prerequisites are met.',
    inputSchema: copyRequiredFilesStep.outputSchema,
    outputSchema: z.object({
        configUpdated: z.boolean(),
        message: z.string(),
    }),
    execute: async ({ getStepResult, getInitData }) => {
        const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
        const { projectStructureValid } = getStepResult(checkProjectStructureStep);
        const { filesCopied } = getStepResult(copyRequiredFilesStep);
        if (!dockerInstalled || !projectStructureValid || !filesCopied) {
            return {
                configUpdated: false,
                message: 'Skipped updating project config because prerequisites were not met.',
            };
        }
        const targetDir = resolveProjectDir(getInitData().projectDir);
        await mergePackageJson(targetDir, {
            scripts,
            dependencies: dependenciesToAdd,
            devDependencies: devDependenciesToAdd,
        });
        await appendMissingLines(join(targetDir, '.gitignore'), gitignoreLines);
        await appendMissingLines(join(targetDir, '.hlxignore'), hlxignoreLines);
        const scriptsJsPath = join(targetDir, 'scripts', 'scripts.js');
        await addLoadScriptImport(scriptsJsPath);
        await addSidekickLibraryLoader(scriptsJsPath);
        return {
            configUpdated: true,
            message: 'Updated package.json, .gitignore, .hlxignore, and scripts/scripts.js.',
        };
    },
});
export const runNpmInstallStep = createStep({
    id: 'run-npm-install',
    description: 'Runs npm install to install the newly added dependencies, if prerequisites are met.',
    inputSchema: updateProjectConfigStep.outputSchema,
    outputSchema: z.object({
        npmInstallSucceeded: z.boolean(),
        message: z.string(),
    }),
    execute: async ({ getStepResult, getInitData }) => {
        const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
        const { projectStructureValid } = getStepResult(checkProjectStructureStep);
        const { filesCopied } = getStepResult(copyRequiredFilesStep);
        const { configUpdated } = getStepResult(updateProjectConfigStep);
        if (!dockerInstalled || !projectStructureValid || !filesCopied || !configUpdated) {
            return {
                npmInstallSucceeded: false,
                message: 'Skipped running npm install because prerequisites were not met.',
            };
        }
        const targetDir = resolveProjectDir(getInitData().projectDir);
        try {
            await execFileAsync('npm', ['install'], { cwd: targetDir });
            return { npmInstallSucceeded: true, message: 'Installed npm dependencies.' };
        }
        catch (error) {
            return {
                npmInstallSucceeded: false,
                message: `npm install failed: ${error.message}`,
            };
        }
    },
});
export const startDevServerStep = createStep({
    id: 'start-dev-server',
    description: 'Starts the AEM dev server and visual-test server via npm run start, if prerequisites are met.',
    inputSchema: runNpmInstallStep.outputSchema,
    outputSchema: z.object({
        devServerStarted: z.boolean(),
        message: z.string(),
    }),
    execute: async ({ getStepResult, getInitData }) => {
        const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
        const { projectStructureValid } = getStepResult(checkProjectStructureStep);
        const { filesCopied } = getStepResult(copyRequiredFilesStep);
        const { configUpdated } = getStepResult(updateProjectConfigStep);
        const { npmInstallSucceeded } = getStepResult(runNpmInstallStep);
        if (!dockerInstalled || !projectStructureValid || !filesCopied || !configUpdated || !npmInstallSucceeded) {
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
export const dockerBuildStep = createStep({
    id: 'docker-build',
    description: 'Builds the Playwright Docker image via npm run test:visual:build, if prerequisites are met.',
    inputSchema: startDevServerStep.outputSchema,
    outputSchema: z.object({
        dockerBuildSucceeded: z.boolean(),
        message: z.string(),
    }),
    execute: async ({ getStepResult, getInitData }) => {
        const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
        const { projectStructureValid } = getStepResult(checkProjectStructureStep);
        const { filesCopied } = getStepResult(copyRequiredFilesStep);
        const { configUpdated } = getStepResult(updateProjectConfigStep);
        const { npmInstallSucceeded } = getStepResult(runNpmInstallStep);
        const { devServerStarted } = getStepResult(startDevServerStep);
        if (!dockerInstalled ||
            !projectStructureValid ||
            !filesCopied ||
            !configUpdated ||
            !npmInstallSucceeded ||
            !devServerStarted) {
            return {
                dockerBuildSucceeded: false,
                message: 'Skipped docker build because prerequisites were not met.',
            };
        }
        const targetDir = resolveProjectDir(getInitData().projectDir);
        try {
            await execFileAsync('npm', ['run', 'test:visual:build'], { cwd: targetDir });
            return { dockerBuildSucceeded: true, message: 'Built the Playwright Docker image.' };
        }
        catch (error) {
            return {
                dockerBuildSucceeded: false,
                message: `docker build failed: ${error.message}`,
            };
        }
    },
});
export const generateVisualTestsStep = createStep({
    id: 'generate-visual-tests',
    description: 'Generates visual tests via npm run test:visual:generate, if prerequisites are met.',
    inputSchema: dockerBuildStep.outputSchema,
    outputSchema: z.object({
        visualTestsGenerated: z.boolean(),
        message: z.string(),
    }),
    execute: async ({ getStepResult, getInitData }) => {
        const { dockerInstalled } = getStepResult(checkPrerequisitesStep);
        const { projectStructureValid } = getStepResult(checkProjectStructureStep);
        const { filesCopied } = getStepResult(copyRequiredFilesStep);
        const { configUpdated } = getStepResult(updateProjectConfigStep);
        const { npmInstallSucceeded } = getStepResult(runNpmInstallStep);
        const { devServerStarted } = getStepResult(startDevServerStep);
        const { dockerBuildSucceeded } = getStepResult(dockerBuildStep);
        if (!dockerInstalled ||
            !projectStructureValid ||
            !filesCopied ||
            !configUpdated ||
            !npmInstallSucceeded ||
            !devServerStarted ||
            !dockerBuildSucceeded) {
            return {
                visualTestsGenerated: false,
                message: 'Skipped generating visual tests because prerequisites were not met.',
            };
        }
        const targetDir = resolveProjectDir(getInitData().projectDir);
        try {
            await execFileAsync('npm', ['run', 'test:visual:generate'], { cwd: targetDir });
            return { visualTestsGenerated: true, message: 'Generated visual tests.' };
        }
        catch (error) {
            return {
                visualTestsGenerated: false,
                message: `${SIDEKICK_SETUP_MESSAGE}\n\n${error.message}`,
            };
        }
    },
});
export const stopDevServerStep = createStep({
    id: 'stop-dev-server',
    description: 'Stops the dev server started by start-dev-server, if one was started.',
    inputSchema: generateVisualTestsStep.outputSchema,
    outputSchema: z.object({
        devServerStopped: z.boolean(),
        message: z.string(),
    }),
    execute: async () => {
        const { stopped, message } = stopDevServer();
        return { devServerStopped: stopped, message };
    },
});
export const aemVisualTestInstallWorkflow = createWorkflow({
    id: 'aem-visual-test-install',
    description: 'Install or Scaffold the AEM Visual Test environment in the current project. Check for prerequisites and provide instructions if not met. copy and modify the necessary files to set up the environment.',
    inputSchema: z.object({
        projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted.'),
    }),
    outputSchema: z.object({
        dockerInstalled: z.boolean(),
        dockerMessage: z.string(),
        projectStructureValid: z.boolean(),
        projectStructureMessage: z.string(),
        filesCopied: z.boolean(),
        filesCopiedMessage: z.string(),
        configUpdated: z.boolean(),
        configUpdatedMessage: z.string(),
        npmInstallSucceeded: z.boolean(),
        npmInstallMessage: z.string(),
        devServerStarted: z.boolean(),
        devServerMessage: z.string(),
        dockerBuildSucceeded: z.boolean(),
        dockerBuildMessage: z.string(),
        visualTestsGenerated: z.boolean(),
        visualTestsGeneratedMessage: z.string(),
        devServerStopped: z.boolean(),
        devServerStoppedMessage: z.string(),
    }),
})
    .then(checkPrerequisitesStep)
    .then(checkProjectStructureStep)
    .then(copyRequiredFilesStep)
    .then(updateProjectConfigStep)
    .then(runNpmInstallStep)
    .then(startDevServerStep)
    .then(dockerBuildStep)
    .then(generateVisualTestsStep)
    .then(stopDevServerStep)
    .map({
    dockerInstalled: { step: checkPrerequisitesStep, path: 'dockerInstalled' },
    dockerMessage: { step: checkPrerequisitesStep, path: 'message' },
    projectStructureValid: { step: checkProjectStructureStep, path: 'projectStructureValid' },
    projectStructureMessage: { step: checkProjectStructureStep, path: 'message' },
    filesCopied: { step: copyRequiredFilesStep, path: 'filesCopied' },
    filesCopiedMessage: { step: copyRequiredFilesStep, path: 'message' },
    configUpdated: { step: updateProjectConfigStep, path: 'configUpdated' },
    configUpdatedMessage: { step: updateProjectConfigStep, path: 'message' },
    npmInstallSucceeded: { step: runNpmInstallStep, path: 'npmInstallSucceeded' },
    npmInstallMessage: { step: runNpmInstallStep, path: 'message' },
    devServerStarted: { step: startDevServerStep, path: 'devServerStarted' },
    devServerMessage: { step: startDevServerStep, path: 'message' },
    dockerBuildSucceeded: { step: dockerBuildStep, path: 'dockerBuildSucceeded' },
    dockerBuildMessage: { step: dockerBuildStep, path: 'message' },
    visualTestsGenerated: { step: generateVisualTestsStep, path: 'visualTestsGenerated' },
    visualTestsGeneratedMessage: { step: generateVisualTestsStep, path: 'message' },
    devServerStopped: { step: stopDevServerStep, path: 'devServerStopped' },
    devServerStoppedMessage: { step: stopDevServerStep, path: 'message' },
})
    .commit();
