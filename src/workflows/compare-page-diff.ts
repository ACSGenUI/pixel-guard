import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { resolveProjectDir } from './project-dir.js';
import { serveReport } from './report-server.js';

const execFileAsync = promisify(execFile);

const elementSchema = z.object({
  selector: z.string(),
  boundingBox: z.object({
    x: z.number(), y: z.number(), width: z.number(), height: z.number(),
  }),
  computedStyle: z.record(z.string(), z.string()),
  outerHTML: z.string(),
});

const blockSchema = z.object({
  name: z.string(),
  selector: z.string(),
  kind: z.enum(['block', 'section', 'landmark']),
  boundingBox: z.object({
    x: z.number(), y: z.number(), width: z.number(), height: z.number(),
  }),
});

const regionSchema = z.object({
  index: z.number(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  diffPixelCount: z.number(),
  status: z.enum(['failed', 'ignored']),
  matchedRule: z.record(z.string(), z.unknown()).nullable(),
  block: blockSchema.nullable().optional(),
  elements: z.array(elementSchema).nullable(),
  crops: z.object({ live: z.string(), migrated: z.string(), diff: z.string() }),
});

const viewportResultSchema = z.object({
  viewportLabel: z.string(),
  status: z.enum(['pass', 'fail', 'error']),
  errorMessage: z.string().nullable(),
  pageLengthMismatch: z.object({
    liveHeight: z.number(), migratedHeight: z.number(), deltaPx: z.number(),
  }).nullable(),
  regions: z.array(regionSchema),
});

const blockRollupSchema = z.object({
  kind: z.enum(['block', 'section', 'landmark']),
  name: z.string(),
  selector: z.string(),
  regionCount: z.number(),
  totalDiffPx: z.number(),
  coverage: z.number(),
  viewportsAffected: z.array(z.string()),
  severityScore: z.number(),
  worstViewport: z.string(),
  worstCrop: z.string().nullable(),
});

const pairResultSchema = z.object({
  pairSlug: z.string(),
  liveUrl: z.string(),
  migratedUrl: z.string(),
  viewports: z.array(viewportResultSchema),
  blockSummary: z.array(blockRollupSchema).optional(),
});

export const runSummarySchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  pairs: z.array(pairResultSchema),
});

export const compareRunStep = createStep({
  id: 'run-compare-page-diff',
  description: 'Runs node tools/page-diff/compare-page-diff.js --mapping <mappingFile> in the target project and reads back its run-summary.json.',
  inputSchema: z.object({
    mappingFile: z.string(),
    projectDir: z.string().optional(),
  }),
  outputSchema: z.object({
    ranSuccessfully: z.boolean(),
    message: z.string(),
    reportUrl: z.string().nullable(),
    summary: runSummarySchema.nullable(),
  }),
  execute: async ({ getInitData }) => {
    const { mappingFile, projectDir } = getInitData<{ mappingFile: string; projectDir?: string }>();
    const targetDir = resolveProjectDir(projectDir);

    let stdout = '';
    let commandError: string | null = null;
    try {
      const result = await execFileAsync('node', ['tools/page-diff/compare-page-diff.js', '--mapping', mappingFile], { cwd: targetDir });
      stdout = result.stdout;
    } catch (error) {
      const execError = error as { stdout?: string; message: string };
      stdout = execError.stdout ?? '';
      commandError = execError.message;
    }

    // A non-zero exit means "some viewport found a visual diff" (compare-page-diff.js sets
    // process.exitCode = 1 in that case), not a crash -- so we still look for the run-id and
    // summary below rather than treating commandError as fatal on its own.
    const runIdMatch = stdout.match(/Run ID: (\S+)/);
    if (!runIdMatch) {
      return {
        ranSuccessfully: false,
        message: commandError ?? 'compare-page-diff.js did not report a run ID.',
        reportUrl: null,
        summary: null,
      };
    }

    const runId = runIdMatch[1];
    const runDir = join(targetDir, 'tools', 'page-diff', 'runs', runId);
    const summary = JSON.parse(await readFile(join(runDir, 'run-summary.json'), 'utf8'));
    const report = await serveReport(runDir);

    return {
      ranSuccessfully: true,
      message: 'Ran comparePageDiff.',
      reportUrl: report?.url ?? null,
      summary,
    };
  },
});

export const comparePageDiffWorkflow = createWorkflow({
  id: 'compare-page-diff',
  description: 'Screenshots each live/migrated URL pair (from a mapping file) at every configured viewport, pixel-diffs them, and reports which page regions differ.',
  inputSchema: z.object({
    mappingFile: z.string().describe('Path to a CSV or JSON file listing { liveUrl, migratedUrl } pairs.'),
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted.'),
  }),
  outputSchema: compareRunStep.outputSchema,
})
  .then(compareRunStep)
  .commit();
