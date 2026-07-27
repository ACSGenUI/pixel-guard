// aem-visual-checker/tools/page-diff/capture-live-block.js
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { runCompare } from './compare-page-diff.js';
import { collectBlockBoxes } from './lib/dom-capture.js';
import {
  extractAnchors, findAnchorsInLiveDom, unionBox, computeConfidence,
} from './lib/anchor-match.js';
import { cropPng } from './lib/crop-images.js';
import { baselineDir, baselinePath, upsertManifestEntry } from './lib/block-baseline.js';
import { VIEWPORTS, THRESHOLDS, ANCHOR_MATCH } from './config.js';

const LAUNCH_ARGS = ['--font-render-hinting=none', '--disable-font-subpixel-positioning', '--force-device-scale-factor=1'];

function parseBlock(block) {
  const idx = block.indexOf(':');
  return idx === -1 ? { kind: null, name: block } : { kind: block.slice(0, idx), name: block.slice(idx + 1) };
}

function findBlockBox(blockBoxes, block) {
  const { kind, name } = parseBlock(block);
  return blockBoxes.find((b) => b.name === name && (!kind || b.kind === kind)) || null;
}

async function boxForSelector(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
  }, selector);
}

async function pageMeta(page) {
  return page.evaluate(() => ({ w: document.body.scrollWidth, h: document.body.scrollHeight }));
}

export async function runCaptureLiveBlock({ runId, mappingFile, block, viewport, liveSelector, targetDir }) {
  let resolvedRunId = runId;
  let summary;
  if (!resolvedRunId) {
    ({ runId: resolvedRunId, summary } = await runCompare({ mappingFile, targetDir }));
  } else {
    const runDir = join(targetDir, 'tools', 'page-diff', 'runs', resolvedRunId);
    summary = JSON.parse(await readFile(join(runDir, 'run-summary.json'), 'utf8'));
  }

  const pair = summary.pairs[0];
  const wanted = viewport
    ? VIEWPORTS.filter((v) => v.label.toLowerCase() === viewport.toLowerCase())
    : VIEWPORTS;

  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const results = [];
  try {
    for (const vp of wanted) {
      const migratedContext = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const liveContext = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      try {
        const migratedPage = await migratedContext.newPage();
        await migratedPage.goto(pair.migratedUrl, { waitUntil: 'networkidle' });
        const migratedBlock = findBlockBox(await collectBlockBoxes(migratedPage), block);
        if (!migratedBlock) throw new Error(`Block "${block}" not found on migrated page at ${vp.label}`);
        const anchors = await extractAnchors(migratedPage, migratedBlock.selector);

        const livePage = await liveContext.newPage();
        await livePage.goto(pair.liveUrl, { waitUntil: 'networkidle' });
        const meta = await pageMeta(livePage);
        const pageArea = Math.max(meta.w, vp.width) * meta.h;

        let region;
        let confidence;
        let candidateSelectors = [];
        const liveSelectorUsed = liveSelector || null;
        if (liveSelector) {
          region = await boxForSelector(livePage, liveSelector);
          if (!region) throw new Error(`liveSelector "${liveSelector}" not found on live page`);
          confidence = 1;
        } else {
          const { matchedBoxes, matchedCount, totalCount } = await findAnchorsInLiveDom(livePage, anchors);
          region = unionBox(matchedBoxes);
          confidence = region
            ? computeConfidence({
              totalAnchors: totalCount,
              matchedAnchors: matchedCount,
              regionArea: region.width * region.height,
              viewportArea: pageArea,
            }, ANCHOR_MATCH)
            : 0;
          if (!region || confidence < ANCHOR_MATCH.minConfidence) {
            candidateSelectors = matchedBoxes.length
              ? ['(low confidence — re-run with --live-selector to override)']
              : ['(no anchors matched — re-run with --live-selector)'];
          }
        }

        if (region) {
          const fullPage = await livePage.screenshot({ fullPage: true, type: 'png', animations: 'disabled' });
          const crop = cropPng(fullPage, region, THRESHOLDS.cropPadding, Math.max(meta.w, vp.width), meta.h);
          await mkdir(baselineDir(targetDir, pair.pairSlug), { recursive: true });
          const outPath = baselinePath(targetDir, pair.pairSlug, block, vp.label);
          await writeFile(outPath, crop);
          await upsertManifestEntry(targetDir, pair.pairSlug, {
            block,
            viewport: vp.label,
            liveSelector: liveSelectorUsed,
            boundingBox: region,
            anchors,
            confidence,
            sourceUrl: pair.liveUrl,
            capturedAt: new Date().toISOString(),
          });
          results.push({ viewportLabel: vp.label, baselinePath: outPath, confidence, liveSelectorUsed, candidateSelectors });
        } else {
          results.push({ viewportLabel: vp.label, baselinePath: null, confidence: 0, liveSelectorUsed, candidateSelectors });
        }
      } finally {
        await migratedContext.close();
        await liveContext.close();
      }
    }
  } finally {
    await browser.close();
  }

  return { runId: resolvedRunId, results };
}

async function main() {
  const { values } = parseArgs({
    options: {
      run: { type: 'string' },
      mapping: { type: 'string' },
      block: { type: 'string' },
      viewport: { type: 'string' },
      'live-selector': { type: 'string' },
    },
  });
  if (!values.block || (!values.run && !values.mapping)) {
    console.error('Usage: node capture-live-block.js --block <kind:name> (--run <id> | --mapping <path>) [--viewport <label>] [--live-selector <css>]');
    process.exit(1);
  }
  const { runId, results } = await runCaptureLiveBlock({
    runId: values.run,
    mappingFile: values.mapping,
    block: values.block,
    viewport: values.viewport,
    liveSelector: values['live-selector'],
    targetDir: process.cwd(),
  });
  for (const r of results) {
    console.log(`  ${r.viewportLabel}: ${r.baselinePath ?? 'NOT CAPTURED'} (confidence ${r.confidence.toFixed(2)})`);
    if (r.candidateSelectors.length) console.log(`    ${r.candidateSelectors.join('; ')}`);
  }
  console.log(`Captured live block ${values.block} for run ${runId}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
