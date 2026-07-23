import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { comparePageDiffWorkflow, runSummarySchema } from '../workflows/compare-page-diff.js';

type RunSummary = z.infer<typeof runSummarySchema>;

function formatSummary(summary: RunSummary): string {
  const lines: string[] = [`## Compare Page Diff (run ${summary.runId})`, ''];

  for (const pair of summary.pairs) {
    lines.push(`### ${pair.pairSlug} — ${pair.liveUrl} → ${pair.migratedUrl}`);
    for (const viewport of pair.viewports) {
      const icon = viewport.status === 'pass' ? '✅' : viewport.status === 'fail' ? '❌' : '⚠️';
      lines.push(`${icon} ${viewport.viewportLabel} — ${viewport.status}`);
      if (viewport.errorMessage) {
        lines.push(`   ${viewport.errorMessage}`);
      }
      if (viewport.pageLengthMismatch) {
        const { liveHeight, migratedHeight, deltaPx } = viewport.pageLengthMismatch;
        lines.push(`   Page length mismatch: live ${liveHeight}px vs migrated ${migratedHeight}px (Δ${deltaPx}px)`);
      }
      for (const region of viewport.regions.filter((r) => r.status === 'failed')) {
        lines.push(`   Region ${region.index}: ${region.diffPixelCount}px diff at (${region.x},${region.y}) ${region.width}x${region.height} — crops: ${region.crops.live}, ${region.crops.migrated}, ${region.crops.diff}`);
      }
      const ignoredCount = viewport.regions.filter((r) => r.status === 'ignored').length;
      if (ignoredCount > 0) {
        lines.push(`   ${ignoredCount} region(s) ignored per tools/page-diff/ignore.json`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export const comparePageDiffTool = createTool({
  id: 'comparePageDiff',
  description: 'Screenshots each live/migrated URL pair (from a CSV/JSON mapping file) at every configured viewport, pixel-diffs them, and reports which page regions differ, with cropped before/after/diff images and a browsable HTML report.',
  inputSchema: z.object({
    mappingFile: z.string().describe('Path to a CSV or JSON file listing { liveUrl, migratedUrl } pairs.'),
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory when omitted.'),
  }),
  execute: async ({ mappingFile, projectDir }) => {
    const run = await comparePageDiffWorkflow.createRun();
    const result = await run.start({ inputData: { mappingFile, projectDir } });
    const output = result.status === 'success' ? result.result : undefined;

    if (!output || !output.summary) {
      return { content: [{ type: 'text', text: output?.message ?? `Compare Page Diff did not complete (status: ${result.status}).` }] };
    }

    const text = output.reportUrl
      ? `${formatSummary(output.summary)}\n\n**page-diff report:** ${output.reportUrl}`
      : formatSummary(output.summary);
    return { content: [{ type: 'text', text }] };
  },
});
