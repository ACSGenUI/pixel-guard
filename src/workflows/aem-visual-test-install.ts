import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

const DOCKER_INSTALL_MESSAGE = `Please install Docker.

macOS:
  - Download Docker Desktop: https://www.docker.com/products/docker-desktop
  - Or via Homebrew: brew install --cask docker

Windows:
  - Download Docker Desktop: https://www.docker.com/products/docker-desktop
  - Or via winget: winget install Docker.DockerDesktop`;

const REQUIRED_PROJECT_PATHS: Array<{ relativePath: string; label: string }> = [
  { relativePath: 'blocks', label: 'blocks/ folder' },
  { relativePath: 'scripts/aem.js', label: 'scripts/aem.js' },
  { relativePath: 'package.json', label: 'package.json' },
  { relativePath: 'head.html', label: 'head.html' },
];

export async function findMissingProjectPaths(baseDir: string): Promise<string[]> {
  const missing: string[] = [];
  for (const { relativePath, label } of REQUIRED_PROJECT_PATHS) {
    try {
      await access(join(baseDir, relativePath));
    } catch {
      missing.push(label);
    }
  }
  return missing;
}

export const checkPrerequisitesStep = createStep({
  id: 'check-prerequisites',
  description: 'Checks that Docker is installed on the system.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    dockerInstalled: z.boolean(),
    message: z.string(),
  }),
  execute: async () => {
    try {
      await execFileAsync('docker', ['--version']);
      return { dockerInstalled: true, message: 'Installation successful.' };
    } catch {
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
  execute: async () => {
    const missing = await findMissingProjectPaths(process.cwd());
    if (missing.length === 0) {
      return { projectStructureValid: true, message: 'Project structure is valid.' };
    }
    return {
      projectStructureValid: false,
      message: `Missing required project files: ${missing.join(', ')}. This does not look like an AEM Edge Delivery Services project.`,
    };
  },
});

export const aemVisualTestInstallWorkflow = createWorkflow({
  id: 'aem-visual-test-install',
  description: 'Install or Scaffold the AEM Visual Test environment in the current project. Check for prerequisites and provide instructions if not met. copy and modify the necessary files to set up the environment.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    dockerInstalled: z.boolean(),
    dockerMessage: z.string(),
    projectStructureValid: z.boolean(),
    projectStructureMessage: z.string(),
  }),
})
  .then(checkPrerequisitesStep)
  .then(checkProjectStructureStep)
  .map({
    dockerInstalled: { step: checkPrerequisitesStep, path: 'dockerInstalled' },
    dockerMessage: { step: checkPrerequisitesStep, path: 'message' },
    projectStructureValid: { step: checkProjectStructureStep, path: 'projectStructureValid' },
    projectStructureMessage: { step: checkProjectStructureStep, path: 'message' },
  })
  .commit();
