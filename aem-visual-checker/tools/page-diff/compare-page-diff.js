// aem-visual-checker/tools/page-diff/compare-page-diff.js
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { parseMappingFile } from './lib/mapping-file.js';
import { diffScreenshots } from './lib/screenshot-diff.js';
import {
  loadIgnoreRules, matchRulesForContext, resolveIgnoreBoxes, applyIgnoreStatus,
} from './lib/ignore-rules.js';
import { cropPng } from './lib/crop-images.js';
import { collectBlockBoxes, assignRegionToBlock } from './lib/dom-capture.js';
import { generateReportHtml } from './lib/report-html.js';
import { buildBlockSummary } from './lib/block-summary.js';
import { VIEWPORTS, THRESHOLDS } from './config.js';

const LAUNCH_ARGS = ['--font-render-hinting=none', '--disable-font-subpixel-positioning', '--force-device-scale-factor=1'];

function makeRunId(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export async function runCompare({ mappingFile, targetDir }) {
  const pairs = await parseMappingFile(mappingFile);
  const runId = makeRunId(new Date());
  const runDir = join(targetDir, 'tools', 'page-diff', 'runs', runId);
  const ignoreFilePath = join(targetDir, 'tools', 'page-diff', 'ignore.json');
  const rules = await loadIgnoreRules(ignoreFilePath);

  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const summary = { runId, createdAt: new Date().toISOString(), pairs: [] };

  try {
    for (const pair of pairs) {
      const pairSummary = {
        pairSlug: pair.pairSlug, liveUrl: pair.liveUrl, migratedUrl: pair.migratedUrl, viewports: [],
      };

      for (const viewport of VIEWPORTS) {
        const viewportLabelLower = viewport.label.toLowerCase();
        const viewportDir = join(runDir, pair.pairSlug, viewportLabelLower);
        await mkdir(viewportDir, { recursive: true });

        const liveContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
        const migratedContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });

        try {
          const livePage = await liveContext.newPage();
          const migratedPage = await migratedContext.newPage();
          await livePage.goto(pair.liveUrl, { waitUntil: 'networkidle' });
          await migratedPage.goto(pair.migratedUrl, { waitUntil: 'networkidle' });

          const liveBuffer = await livePage.screenshot({ fullPage: true, type: 'png', animations: 'disabled' });
          const migratedBuffer = await migratedPage.screenshot({ fullPage: true, type: 'png', animations: 'disabled' });

          const {
            diffPngBuffer, width, height, regions, pageLengthMismatch,
          } = diffScreenshots(liveBuffer, migratedBuffer, THRESHOLDS);

          const applicableRules = matchRulesForContext(rules, {
            pairSlug: pair.pairSlug, liveUrl: pair.liveUrl, viewportLabel: viewport.label,
          });
          const ignoredBoxes = await resolveIgnoreBoxes(migratedPage, applicableRules);
          const blockBoxes = await collectBlockBoxes(migratedPage);
          const statusedRegions = applyIgnoreStatus(regions, ignoredBoxes, THRESHOLDS.ignoreOverlapRatio);

          await writeFile(join(viewportDir, 'live.png'), liveBuffer);
          await writeFile(join(viewportDir, 'migrated.png'), migratedBuffer);
          await writeFile(join(viewportDir, 'diff.png'), diffPngBuffer);

          const relDir = `${pair.pairSlug}/${viewportLabelLower}`;
          const regionsWithCrops = [];
          for (let index = 0; index < statusedRegions.length; index += 1) {
            const region = statusedRegions[index];
            const liveCrop = cropPng(liveBuffer, region, THRESHOLDS.cropPadding, width, height);
            const migratedCrop = cropPng(migratedBuffer, region, THRESHOLDS.cropPadding, width, height);
            const diffCrop = cropPng(diffPngBuffer, region, THRESHOLDS.cropPadding, width, height);
            // eslint-disable-next-line no-await-in-loop
            await writeFile(join(viewportDir, `region-${index}-live.png`), liveCrop);
            // eslint-disable-next-line no-await-in-loop
            await writeFile(join(viewportDir, `region-${index}-migrated.png`), migratedCrop);
            // eslint-disable-next-line no-await-in-loop
            await writeFile(join(viewportDir, `region-${index}-diff.png`), diffCrop);
            regionsWithCrops.push({
              index,
              x: region.x,
              y: region.y,
              width: region.width,
              height: region.height,
              diffPixelCount: region.diffPixelCount,
              status: region.status,
              matchedRule: region.matchedRule,
              block: assignRegionToBlock(region, blockBoxes),
              elements: null,
              crops: {
                live: `${relDir}/region-${index}-live.png`,
                migrated: `${relDir}/region-${index}-migrated.png`,
                diff: `${relDir}/region-${index}-diff.png`,
              },
            });
          }

          await writeFile(join(viewportDir, 'regions.json'), JSON.stringify(regionsWithCrops, null, 2));

          const hasFailures = regionsWithCrops.some((region) => region.status === 'failed');
          pairSummary.viewports.push({
            viewportLabel: viewport.label,
            status: hasFailures || pageLengthMismatch ? 'fail' : 'pass',
            errorMessage: null,
            pageLengthMismatch,
            regions: regionsWithCrops,
          });
        } catch (error) {
          pairSummary.viewports.push({
            viewportLabel: viewport.label,
            status: 'error',
            errorMessage: error.message,
            pageLengthMismatch: null,
            regions: [],
          });
        } finally {
          await liveContext.close();
          await migratedContext.close();
        }
      }

      pairSummary.blockSummary = buildBlockSummary(pairSummary.viewports);
      summary.pairs.push(pairSummary);
    }
  } finally {
    await browser.close();
  }

  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'run-summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(runDir, 'index.html'), generateReportHtml(summary));

  return { runId, runDir, summary };
}

async function main() {
  const { values } = parseArgs({ options: { mapping: { type: 'string' } } });
  if (!values.mapping) {
    console.error('Usage: node compare-page-diff.js --mapping <path-to-csv-or-json>');
    process.exit(1);
  }

  const { runId, runDir, summary } = await runCompare({ mappingFile: values.mapping, targetDir: process.cwd() });
  const allViewports = summary.pairs.flatMap((pair) => pair.viewports);
  const failed = allViewports.filter((viewport) => viewport.status !== 'pass').length;

  console.log(`page-diff: ${allViewports.length - failed}/${allViewports.length} passed`);
  console.log(`Run ID: ${runId}`);
  console.log(`Report: ${join(runDir, 'index.html')}`);
  if (failed > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
