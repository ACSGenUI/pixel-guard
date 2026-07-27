import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { resolveProjectDir } from './project-dir.js';
import { serveReport } from './report-server.js';

const execFileAsync = promisify(execFile);

export const compareBlockStep = createStep({
  id: 'run-compare-block',
  description: 'Runs node tools/page-diff/compare-block.js in the target project and serves the run report.',
  inputSchema: z.object({
    block: z.string(),
    runId: z.string().optional(),
    mappingFile: z.string().optional(),
    viewport: z.string().optional(),
    projectDir: z.string().optional(),
  }),
  outputSchema: z.object({
    ranSuccessfully: z.boolean(),
    message: z.string(),
    output: z.string(),
    reportUrl: z.string().nullable(),
  }),
  execute: async ({ getInitData }) => {
    const {
      block, runId, mappingFile, viewport, projectDir,
    } = getInitData<{ block: string; runId?: string; mappingFile?: string; viewport?: string; projectDir?: string }>();
    const targetDir = resolveProjectDir(projectDir);

    if (!block || (!runId && !mappingFile)) {
      return { ranSuccessfully: false, message: 'block and one of runId/mappingFile are required.', output: '', reportUrl: null };
    }

    const args = ['tools/page-diff/compare-block.js', '--block', block];
    if (runId) args.push('--run', runId);
    if (mappingFile) args.push('--mapping', mappingFile);
    if (viewport) args.push('--viewport', viewport);

    let stdout = '';
    let commandError: string | null = null;
    try {
      ({ stdout } = await execFileAsync('node', args, { cwd: targetDir }));
    } catch (error) {
      const e = error as { stdout?: string; message: string };
      stdout = e.stdout ?? '';
      commandError = e.message;
    }

    const match = stdout.match(/Compared block .+ for run (\S+)/);
    if (!match) {
      return { ranSuccessfully: false, message: commandError ?? 'compare-block.js did not report success.', output: stdout, reportUrl: null };
    }
    const resolvedRunId = match[1];
    const runDir = join(targetDir, 'tools', 'page-diff', 'runs', resolvedRunId);
    const report = await serveReport(runDir);
    return { ranSuccessfully: true, message: 'Ran compareBlock.', output: stdout, reportUrl: report?.url ?? null };
  },
});

export const compareBlockWorkflow = createWorkflow({
  id: 'compare-block',
  description: 'Re-screenshots a single migrated block and diffs it against its saved live baseline.',
  inputSchema: compareBlockStep.inputSchema,
  outputSchema: compareBlockStep.outputSchema,
})
  .then(compareBlockStep)
  .commit();
