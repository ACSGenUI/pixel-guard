import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { resolveProjectDir } from './project-dir.js';

const execFileAsync = promisify(execFile);

export const captureLiveBlockStep = createStep({
  id: 'run-capture-live-block',
  description: 'Runs node tools/page-diff/capture-live-block.js in the target project.',
  inputSchema: z.object({
    block: z.string(),
    runId: z.string().optional(),
    mappingFile: z.string().optional(),
    viewport: z.string().optional(),
    liveSelector: z.string().optional(),
    projectDir: z.string().optional(),
  }),
  outputSchema: z.object({
    ranSuccessfully: z.boolean(),
    message: z.string(),
    output: z.string(),
  }),
  execute: async ({ getInitData }) => {
    const {
      block, runId, mappingFile, viewport, liveSelector, projectDir,
    } = getInitData<{ block: string; runId?: string; mappingFile?: string; viewport?: string; liveSelector?: string; projectDir?: string }>();
    const targetDir = resolveProjectDir(projectDir);

    if (!block || (!runId && !mappingFile)) {
      return { ranSuccessfully: false, message: 'block and one of runId/mappingFile are required.', output: '' };
    }

    const args = ['tools/page-diff/capture-live-block.js', '--block', block];
    if (runId) args.push('--run', runId);
    if (mappingFile) args.push('--mapping', mappingFile);
    if (viewport) args.push('--viewport', viewport);
    if (liveSelector) args.push('--live-selector', liveSelector);

    let stdout = '';
    let commandError: string | null = null;
    try {
      ({ stdout } = await execFileAsync('node', args, { cwd: targetDir }));
    } catch (error) {
      const e = error as { stdout?: string; message: string };
      stdout = e.stdout ?? '';
      commandError = e.message;
    }

    const ok = /Captured live block .+ for run \S+/.test(stdout);
    return {
      ranSuccessfully: ok,
      message: ok ? 'Ran captureLiveBlock.' : (commandError ?? 'capture-live-block.js did not report success.'),
      output: stdout,
    };
  },
});

export const captureLiveBlockWorkflow = createWorkflow({
  id: 'capture-live-block',
  description: 'Captures a live-site block rendering as a durable per-block baseline via content-anchor matching.',
  inputSchema: captureLiveBlockStep.inputSchema,
  outputSchema: captureLiveBlockStep.outputSchema,
})
  .then(captureLiveBlockStep)
  .commit();
