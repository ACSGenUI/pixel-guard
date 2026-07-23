import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { access, cp } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  scripts, dependenciesToAdd, gitignoreLines, hlxignoreLines,
} from '../../aem-visual-checker/tools/page-diff/changes.js';
import { mergePackageJson, appendMissingLines } from './update-project-config.js';
import { resolveProjectDir } from './project-dir.js';

const execFileAsync = promisify(execFile);
const ASSETS_SOURCE_DIR = fileURLToPath(new URL('../../aem-visual-checker', import.meta.url));

export async function checkPackageJsonExists(targetDir: string): Promise<boolean> {
  try {
    await access(join(targetDir, 'package.json'));
    return true;
  } catch {
    return false;
  }
}

export async function copyPageDiffFiles(sourceDir: string, targetDir: string): Promise<void> {
  const manifestPath = join(sourceDir, 'tools', 'page-diff', 'changes.js');
  await cp(join(sourceDir, 'tools', 'page-diff'), join(targetDir, 'tools', 'page-diff'), {
    recursive: true,
    force: true,
    filter: (source) => basename(source) !== '.DS_Store' && source !== manifestPath,
  });
}

export const checkPackageJsonStep = createStep({
  id: 'check-package-json',
  description: 'Checks that the target project has a package.json -- page-diff has no other project-structure requirement (unlike the block-testing installer, it does not need blocks/, scripts/aem.js, or head.html).',
  inputSchema: z.object({
    projectDir: z.string().optional(),
  }),
  outputSchema: z.object({
    packageJsonExists: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ getInitData }) => {
    const targetDir = resolveProjectDir(getInitData<{ projectDir?: string }>().projectDir);
    const exists = await checkPackageJsonExists(targetDir);
    return exists
      ? { packageJsonExists: true, message: 'package.json found.' }
      : {
        packageJsonExists: false,
        message: `No package.json found in ${targetDir}. page-diff installs its own npm scripts/dependencies there, so this must be a Node project.`,
      };
  },
});

export const copyPageDiffFilesStep = createStep({
  id: 'copy-page-diff-files',
  description: 'Copies tools/page-diff/ into the target project, if prerequisites are met.',
  inputSchema: checkPackageJsonStep.outputSchema,
  outputSchema: z.object({
    filesCopied: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ getStepResult, getInitData }) => {
    const { packageJsonExists } = getStepResult(checkPackageJsonStep);
    if (!packageJsonExists) {
      return { filesCopied: false, message: 'Skipped copying page-diff files because prerequisites were not met.' };
    }
    const targetDir = resolveProjectDir(getInitData<{ projectDir?: string }>().projectDir);
    await copyPageDiffFiles(ASSETS_SOURCE_DIR, targetDir);
    return { filesCopied: true, message: 'Copied tools/page-diff/ to the project.' };
  },
});

export const updatePageDiffConfigStep = createStep({
  id: 'update-page-diff-config',
  description: 'Merges page-diff npm scripts/dependencies into package.json and appends ignore entries to .gitignore and .hlxignore, if prerequisites are met.',
  inputSchema: copyPageDiffFilesStep.outputSchema,
  outputSchema: z.object({
    configUpdated: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ getStepResult, getInitData }) => {
    const { filesCopied } = getStepResult(copyPageDiffFilesStep);
    if (!filesCopied) {
      return { configUpdated: false, message: 'Skipped updating package.json because prerequisites were not met.' };
    }
    const targetDir = resolveProjectDir(getInitData<{ projectDir?: string }>().projectDir);
    await mergePackageJson(targetDir, { scripts, dependencies: dependenciesToAdd, devDependencies: {} });
    await appendMissingLines(join(targetDir, '.gitignore'), gitignoreLines);
    await appendMissingLines(join(targetDir, '.hlxignore'), hlxignoreLines);
    return { configUpdated: true, message: 'Updated package.json, .gitignore, and .hlxignore.' };
  },
});

export const runPageDiffNpmInstallStep = createStep({
  id: 'run-npm-install',
  description: 'Runs npm install to install playwright/pixelmatch/pngjs, if prerequisites are met.',
  inputSchema: updatePageDiffConfigStep.outputSchema,
  outputSchema: z.object({
    npmInstallSucceeded: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ getStepResult, getInitData }) => {
    const { configUpdated } = getStepResult(updatePageDiffConfigStep);
    if (!configUpdated) {
      return { npmInstallSucceeded: false, message: 'Skipped running npm install because prerequisites were not met.' };
    }
    const targetDir = resolveProjectDir(getInitData<{ projectDir?: string }>().projectDir);
    try {
      await execFileAsync('npm', ['install'], { cwd: targetDir });
      return { npmInstallSucceeded: true, message: 'Installed npm dependencies.' };
    } catch (error) {
      return { npmInstallSucceeded: false, message: `npm install failed: ${(error as Error).message}` };
    }
  },
});

export const installPageDiffWorkflow = createWorkflow({
  id: 'install-page-diff',
  description: 'Installs the page-diff environment in the target project: copies tools/page-diff/, merges its npm scripts/dependencies into package.json, and runs npm install. Fully independent of aemVisualTestInstall/block-testing.',
  inputSchema: z.object({
    projectDir: z.string().optional().describe('Absolute path to the target project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted.'),
  }),
  outputSchema: z.object({
    packageJsonExists: z.boolean(),
    packageJsonMessage: z.string(),
    filesCopied: z.boolean(),
    filesCopiedMessage: z.string(),
    configUpdated: z.boolean(),
    configUpdatedMessage: z.string(),
    npmInstallSucceeded: z.boolean(),
    npmInstallMessage: z.string(),
  }),
})
  .then(checkPackageJsonStep)
  .then(copyPageDiffFilesStep)
  .then(updatePageDiffConfigStep)
  .then(runPageDiffNpmInstallStep)
  .map({
    packageJsonExists: { step: checkPackageJsonStep, path: 'packageJsonExists' },
    packageJsonMessage: { step: checkPackageJsonStep, path: 'message' },
    filesCopied: { step: copyPageDiffFilesStep, path: 'filesCopied' },
    filesCopiedMessage: { step: copyPageDiffFilesStep, path: 'message' },
    configUpdated: { step: updatePageDiffConfigStep, path: 'configUpdated' },
    configUpdatedMessage: { step: updatePageDiffConfigStep, path: 'message' },
    npmInstallSucceeded: { step: runPageDiffNpmInstallStep, path: 'npmInstallSucceeded' },
    npmInstallMessage: { step: runPageDiffNpmInstallStep, path: 'message' },
  })
  .commit();
