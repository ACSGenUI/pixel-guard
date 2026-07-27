// aem-visual-checker/tools/page-diff/compare-block.js
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { runCompare } from './compare-page-diff.js';
import { collectBlockBoxes } from './lib/dom-capture.js';
import { cropPng } from './lib/crop-images.js';
import { compareBlockCrops } from './lib/block-compare.js';
import { baselinePath, blockSlug } from './lib/block-baseline.js';
import { VIEWPORTS, THRESHOLDS } from './config.js';

const LAUNCH_ARGS = ['--font-render-hinting=none', '--disable-font-subpixel-positioning', '--force-device-scale-factor=1'];

function parseBlock(block) {
  const idx = block.indexOf(':');
  return idx === -1 ? { kind: null, name: block } : { kind: block.slice(0, idx), name: block.slice(idx + 1) };
}
function findBlockBox(blockBoxes, block) {
  const { kind, name } = parseBlock(block);
  return blockBoxes.find((b) => b.name === name && (!kind || b.kind === kind)) || null;
}

export async function runCompareBlock({ runId, mappingFile, block, viewport, targetDir }) {
  let resolvedRunId = runId;
  let summary;
  if (!resolvedRunId) {
    ({ runId: resolvedRunId, summary } = await runCompare({ mappingFile, targetDir }));
  } else {
    const dir = join(targetDir, 'tools', 'page-diff', 'runs', resolvedRunId);
    summary = JSON.parse(await readFile(join(dir, 'run-summary.json'), 'utf8'));
  }
  const runDir = join(targetDir, 'tools', 'page-diff', 'runs', resolvedRunId);
  const pair = summary.pairs[0];
  const wanted = viewport
    ? VIEWPORTS.filter((v) => v.label.toLowerCase() === viewport.toLowerCase())
    : VIEWPORTS;

  const outDir = join(runDir, 'block-compare', blockSlug(block));
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const results = [];
  try {
    for (const vp of wanted) {
      const basePath = baselinePath(targetDir, pair.pairSlug, block, vp.label);
      let baselineBuffer;
      try {
        baselineBuffer = await readFile(basePath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new Error(`No live baseline for "${block}" at ${vp.label}. Run captureLiveBlock first.`);
        }
        throw error;
      }

      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      try {
        const page = await context.newPage();
        await page.goto(pair.migratedUrl, { waitUntil: 'networkidle' });
        const box = findBlockBox(await collectBlockBoxes(page), block);
        if (!box) throw new Error(`Block "${block}" not found on migrated page at ${vp.label}`);
        const fullPage = await page.screenshot({ fullPage: true, type: 'png', animations: 'disabled' });
        const meta = await page.evaluate(() => ({ w: document.body.scrollWidth, h: document.body.scrollHeight }));
        const migratedCrop = cropPng(fullPage, box.boundingBox, THRESHOLDS.cropPadding, Math.max(meta.w, vp.width), meta.h);

        const cmp = compareBlockCrops(baselineBuffer, migratedCrop, THRESHOLDS);

        const vpLower = vp.label.toLowerCase();
        const baselineOut = join(outDir, `${vpLower}-baseline.png`);
        const migratedOut = join(outDir, `${vpLower}-migrated.png`);
        const diffOut = join(outDir, `${vpLower}-diff.png`);
        await copyFile(basePath, baselineOut);
        await writeFile(migratedOut, migratedCrop);
        await writeFile(diffOut, cmp.diffPngBuffer);

        results.push({
          viewportLabel: vp.label,
          pass: cmp.pass,
          diffPixelCount: cmp.diffPixelCount,
          widthDelta: cmp.widthDelta,
          heightMismatch: cmp.heightMismatch,
          crops: { baseline: baselineOut, migrated: migratedOut, diff: diffOut },
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return { runId: resolvedRunId, runDir, results };
}

async function main() {
  const { values } = parseArgs({
    options: {
      run: { type: 'string' }, mapping: { type: 'string' }, block: { type: 'string' }, viewport: { type: 'string' },
    },
  });
  if (!values.block || (!values.run && !values.mapping)) {
    console.error('Usage: node compare-block.js --block <kind:name> (--run <id> | --mapping <path>) [--viewport <label>]');
    process.exit(1);
  }
  const { runId, results } = await runCompareBlock({
    runId: values.run, mappingFile: values.mapping, block: values.block, viewport: values.viewport, targetDir: process.cwd(),
  });
  for (const r of results) {
    console.log(`  ${r.viewportLabel}: ${r.pass ? 'PASS' : 'FAIL'} (${r.diffPixelCount}px, widthΔ ${r.widthDelta})`);
  }
  console.log(`Compared block ${values.block} for run ${runId}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
