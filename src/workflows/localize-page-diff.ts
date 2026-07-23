import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { runSummarySchema } from './compare-page-diff.js';
import { resolveProjectDir } from './project-dir.js';
import { serveReport } from './report-server.js';

const execFileAsync = promisify(execFile);

export const localizeRunStep = createStep({
  id: 'run-localize-page-diff',
  description: 'Runs node tools/page-diff/localize-page-diff.js in the target project and reads back its updated run-summary.json.',
  inputSchema: z.object({
    runId: z.string().optional(),
    mappingFile: z.string().optional(),
    projectDir: z.string().optional(),
  }),
  outputSchema: z.object({
    ranSuccessfully: z.boolean(),
    message: z.string(),
    reportUrl: z.string().nullable(),
    summary: runSummarySchema.nullable(),
  }),
  execute: async ({ getInitData }) => {
    const { runId, mappingFile, projectDir } = getInitData<{ runId?: string; mappingFile?: string; projectDir?: string }>();
    const targetDir = resolveProjectDir(projectDir);

    if (!runId && !mappingFile) {
      return {
        ranSuccessfully: false,
        message: 'Either runId or mappingFile must be provided.',
        reportUrl: null,
        summary: null,
      };
    }

    const args = ['tools/page-diff/localize-page-diff.js'];
    if (runId) args.push('--run', runId);
    if (mappingFile) args.push('--mapping', mappingFile);

    let stdout = '';
    let commandError: string | null = null;
    try {
      const result = await execFileAsync('node', args, { cwd: targetDir });
      stdout = result.stdout;
    } catch (error) {
      const execError = error as { stdout?: string; message: string };
      stdout = execError.stdout ?? '';
      commandError = execError.message;
    }

    const runIdMatch = stdout.match(/Localized diffs for run (\S+)/);
    if (!runIdMatch) {
      return {
        ranSuccessfully: false,
        message: commandError ?? 'localize-page-diff.js did not report a run ID.',
        reportUrl: null,
        summary: null,
      };
    }

    const resolvedRunId = runIdMatch[1];
    const runDir = join(targetDir, 'tools', 'page-diff', 'runs', resolvedRunId);
    const summary = JSON.parse(await readFile(join(runDir, 'run-summary.json'), 'utf8'));
    const report = await serveReport(runDir);

    return {
      ranSuccessfully: true,
      message: 'Ran localizePageDiff.',
      reportUrl: report?.url ?? null,
      summary,
    };
  },
});

export const localizePageDiffWorkflow = createWorkflow({
  id: 'localize-page-diff',
  description: 'For each failing region in a compare-page-diff run, finds the overlapping migrated-page DOM element(s) and attaches their selector, computed style, and outerHTML.',
  inputSchema: z.object({
    runId: z.string().optional().describe('An existing compare-page-diff run ID to localize. Omit to run a fresh comparison first via mappingFile.'),
    mappingFile: z.string().optional().describe('Path to a CSV/JSON mapping file to run a fresh comparison before localizing. Omit if runId is given.'),
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted.'),
  }),
  outputSchema: localizeRunStep.outputSchema,
})
  .then(localizeRunStep)
  .commit();
