// aem-visual-checker/tools/page-diff/localize-page-diff.js
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { runCompare } from './compare-page-diff.js';
import { collectAllBoundingBoxes, collectElementDetails, filterOverlappingElements } from './lib/dom-capture.js';
import { runPreparePage } from './lib/prepare-page.js';
import { generateReportHtml } from './lib/report-html.js';
import { VIEWPORTS } from './config.js';

const LAUNCH_ARGS = ['--font-render-hinting=none', '--disable-font-subpixel-positioning', '--force-device-scale-factor=1'];
const MAX_ELEMENTS_PER_REGION = 5;

export async function runLocalize({ runId, mappingFile, targetDir }) {
  let resolvedRunId = runId;
  let runDir;
  let summary;

  if (!resolvedRunId) {
    ({ runId: resolvedRunId, runDir, summary } = await runCompare({ mappingFile, targetDir }));
  } else {
    runDir = join(targetDir, 'tools', 'page-diff', 'runs', resolvedRunId);
    summary = JSON.parse(await readFile(join(runDir, 'run-summary.json'), 'utf8'));
  }

  const viewportsByLabel = new Map(VIEWPORTS.map((viewport) => [viewport.label, viewport]));
  const browser = await chromium.launch({ args: LAUNCH_ARGS });

  try {
    for (const pair of summary.pairs) {
      for (const viewportSummary of pair.viewports) {
        const failingRegions = viewportSummary.regions.filter((region) => region.status === 'failed');
        if (failingRegions.length === 0) continue;

        const viewport = viewportsByLabel.get(viewportSummary.viewportLabel);
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });

        try {
          const page = await context.newPage();
          await page.goto(pair.migratedUrl, { waitUntil: 'networkidle' });
          await runPreparePage(page, {
            side: 'migrated', url: pair.migratedUrl, pairSlug: pair.pairSlug, viewport: viewportSummary.viewportLabel,
          }, targetDir);
          const allBoxes = await collectAllBoundingBoxes(page);

          for (const region of failingRegions) {
            const overlapping = filterOverlappingElements(allBoxes, region).slice(0, MAX_ELEMENTS_PER_REGION);
            const selectors = overlapping.map((el) => el.selector);
            // eslint-disable-next-line no-await-in-loop
            region.elements = await collectElementDetails(page, selectors);
          }
        } finally {
          await context.close();
        }

        const viewportDir = join(runDir, pair.pairSlug, viewportSummary.viewportLabel.toLowerCase());
        await writeFile(join(viewportDir, 'regions.json'), JSON.stringify(viewportSummary.regions, null, 2));
      }
    }
  } finally {
    await browser.close();
  }

  await writeFile(join(runDir, 'run-summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(runDir, 'index.html'), generateReportHtml(summary));

  return { runId: resolvedRunId, runDir, summary };
}

async function main() {
  const { values } = parseArgs({ options: { run: { type: 'string' }, mapping: { type: 'string' } } });
  if (!values.run && !values.mapping) {
    console.error('Usage: node localize-page-diff.js --run <run-id> | --mapping <path>');
    process.exit(1);
  }

  const { runId, runDir } = await runLocalize({ runId: values.run, mappingFile: values.mapping, targetDir: process.cwd() });
  console.log(`Localized diffs for run ${runId}`);
  console.log(`Report: ${join(runDir, 'index.html')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
