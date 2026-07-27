import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { comparePageDiffWorkflow, runSummarySchema } from '../workflows/compare-page-diff.js';

type RunSummary = z.infer<typeof runSummarySchema>;
type Region = RunSummary['pairs'][number]['viewports'][number]['regions'][number];

function blockLabel(region: Region): string {
  const block = region.block ?? null;
  if (!block) return 'Unattributed';
  return block.kind === 'block' ? `Block "${block.name}"` : `${block.kind} "${block.name}"`;
}

function groupKey(region: Region): string {
  const block = region.block ?? null;
  return block ? `${block.kind}:${block.selector}` : '__unattributed__';
}

const KIND_LABEL: Record<string, string> = { block: 'Blocks', landmark: 'Landmarks', section: 'Sections' };
const KIND_NOUN: Record<string, string> = { block: 'Block', landmark: 'Landmark', section: 'Section' };

function formatBlockSummary(pair: RunSummary['pairs'][number]): string[] {
  const summary = pair.blockSummary ?? [];
  if (summary.length === 0) return [];
  const lines: string[] = ['   Blocks affected (ranked):'];
  let currentKind: string | null = null;
  for (const item of summary) {
    if (item.kind !== currentKind) {
      currentKind = item.kind;
      lines.push(`   ${KIND_LABEL[item.kind]}:`);
    }
    const pct = Math.round(item.coverage * 100);
    const vpCount = item.viewportsAffected.length;
    lines.push(
      `      ❌ ${KIND_NOUN[item.kind]} "${item.name}" — coverage ${pct}%, `
      + `${vpCount} viewport${vpCount === 1 ? '' : 's'} [${item.viewportsAffected.join(', ')}], `
      + `${item.regionCount} region${item.regionCount === 1 ? '' : 's'}, `
      + `${item.totalDiffPx.toLocaleString('en-US')} px`,
    );
  }
  lines.push('');
  return lines;
}

export function formatSummary(summary: RunSummary): string {
  const lines: string[] = [`## Compare Page Diff (run ${summary.runId})`, ''];

  for (const pair of summary.pairs) {
    lines.push(`### ${pair.pairSlug} — ${pair.liveUrl} → ${pair.migratedUrl}`);
    lines.push(...formatBlockSummary(pair));
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

      const failed = viewport.regions.filter((r) => r.status === 'failed');
      const groups = new Map<string, { label: string; regions: Region[] }>();
      for (const region of failed) {
        const key = groupKey(region);
        if (!groups.has(key)) groups.set(key, { label: blockLabel(region), regions: [] });
        groups.get(key)!.regions.push(region);
      }
      // Unattributed last.
      const ordered = [...groups.values()].sort((a, b) => {
        if (a.label === 'Unattributed') return 1;
        if (b.label === 'Unattributed') return -1;
        return 0;
      });
      for (const group of ordered) {
        const totalPx = group.regions.reduce((sum, r) => sum + r.diffPixelCount, 0);
        lines.push(`   ${group.label} — ${group.regions.length} region(s), ${totalPx}px`);
        for (const region of group.regions) {
          lines.push(`      Region ${region.index}: ${region.diffPixelCount}px at (${region.x},${region.y}) ${region.width}x${region.height} — crops: ${region.crops.live}, ${region.crops.migrated}, ${region.crops.diff}`);
        }
      }

      const ignoredCount = viewport.regions.filter((r) => r.status === 'ignored').length;
      if (ignoredCount > 0) {
        lines.push(`   ${ignoredCount} region(s) ignored per tools/page-diff/ignore.json`);
      }
    }
    lines.push('');
  }

  const hasFailures = summary.pairs.some(
    (pair) => (pair.blockSummary?.length ?? 0) > 0 || pair.viewports.some((v) => v.status === 'fail'),
  );
  if (hasFailures) {
    lines.push(
      '## Next steps',
      '',
      '1. Open the page-diff report linked below and review it top-to-bottom: the full-page live/migrated/diff comparison, then the block-level roll-up, then the per-region detail.',
      '2. Write a complete summary for the user: where the differences are coming from (which blocks/landmarks/sections and why), the major fixes needed, and any quick fixes.',
      '3. Fix block-by-block, worst-first per the roll-up. For each broken block:',
      '   - `captureLiveBlock` (block name + this runId) to save the live target as a baseline,',
      '   - `compareBlock` to see the gap, then fix the migrated block\'s CSS/markup and re-run `compareBlock` until every viewport passes.',
      'Do NOT screenshot the live or migrated pages yourself — captureLiveBlock and compareBlock already capture, locate, and diff each block for you.',
      '',
    );
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
