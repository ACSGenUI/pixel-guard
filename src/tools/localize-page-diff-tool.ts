import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { localizePageDiffWorkflow } from '../workflows/localize-page-diff.js';
import { runSummarySchema } from '../workflows/compare-page-diff.js';

type RunSummary = z.infer<typeof runSummarySchema>;

function formatSummary(summary: RunSummary): string {
  const lines: string[] = [`## Localize Page Diff (run ${summary.runId})`, ''];

  for (const pair of summary.pairs) {
    lines.push(`### ${pair.pairSlug} — ${pair.liveUrl} → ${pair.migratedUrl}`);
    for (const viewport of pair.viewports) {
      const failedRegions = viewport.regions.filter((r) => r.status === 'failed');
      if (failedRegions.length === 0) continue;
      lines.push(`${viewport.viewportLabel}:`);
      for (const region of failedRegions) {
        lines.push(`  Region ${region.index} (${region.diffPixelCount}px):`);
        for (const element of region.elements ?? []) {
          lines.push(`    - ${element.selector} — ${JSON.stringify(element.computedStyle)}`);
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export const localizePageDiffTool = createTool({
  id: 'localizePageDiff',
  description: 'For each failing region from a comparePageDiff run, finds the overlapping migrated-page DOM element(s) and reports their selector, curated computed style, and outerHTML — enough to reason about a fix, not just look at a diff image.',
  inputSchema: z.object({
    runId: z.string().optional().describe('An existing comparePageDiff run ID to localize. Omit to run a fresh comparison first via mappingFile.'),
    mappingFile: z.string().optional().describe('Path to a CSV/JSON mapping file to run a fresh comparison before localizing. Omit if runId is given.'),
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted.'),
  }),
  execute: async ({ runId, mappingFile, projectDir }) => {
    const run = await localizePageDiffWorkflow.createRun();
    const result = await run.start({ inputData: { runId, mappingFile, projectDir } });
    const output = result.status === 'success' ? result.result : undefined;

    if (!output || !output.summary) {
      return { content: [{ type: 'text', text: output?.message ?? `Localize Page Diff did not complete (status: ${result.status}).` }] };
    }

    const text = output.reportUrl
      ? `${formatSummary(output.summary)}\n\n**page-diff report:** ${output.reportUrl}`
      : formatSummary(output.summary);
    return { content: [{ type: 'text', text }] };
  },
});
