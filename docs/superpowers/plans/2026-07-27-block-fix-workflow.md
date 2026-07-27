# Per-Block Live-Baseline Fix Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two MCP tools — `captureLiveBlock` (save a live-site block rendering as a durable baseline via content-anchor matching) and `compareBlock` (re-diff just the migrated block against that baseline) — turning the block-impact roll-up into a per-block fix loop.

**Architecture:** Both ship as plain-JS scripts under `aem-visual-checker/tools/page-diff/`, mirroring the existing `localize-page-diff.js` (script) / `localize-page-diff.ts` (Mastra workflow) / `localize-page-diff-tool.ts` (MCP tool) trio. Pure logic lives in unit-tested `lib/` modules; browser-dependent DOM/screenshot code lives in the scripts and is manually verified. Live baselines are committed under `tools/page-diff/baselines/`.

**Tech Stack:** Node ESM, Playwright, `pixelmatch`/`pngjs` (already in the page-diff deps); `node:test` + `node:assert/strict` for tool tests; TypeScript + Zod + Mastra for the MCP layer. Tests run via `npm test` (`tsx --test 'src/**/*.test.ts' 'aem-visual-checker/tools/page-diff/**/*.test.js'`).

## Global Constraints

- Block identity is `kind:name` (e.g. `hero-spotlight`, `landmark:nav`); a bare `name` means any kind. Multiple on-page instances of the same block merge — take the first match (documented simplification, consistent with the roll-up).
- Reuse existing helpers verbatim: `diffScreenshots(liveBuf, migratedBuf, config)` (already handles differing heights via `pageLengthMismatch` and throws on differing widths), `cropPng(buf, box, padding, imageWidth, imageHeight)`, `collectBlockBoxes(page)` → `[{name, selector, kind, boundingBox}]`, `serveReport(runDir)`, `VIEWPORTS`, `THRESHOLDS`.
- Playwright launch args and screenshot options match the existing scripts: `LAUNCH_ARGS = ['--font-render-hinting=none', '--disable-font-subpixel-positioning', '--force-device-scale-factor=1']`; screenshots `{ fullPage: true, type: 'png', animations: 'disabled' }`; `page.goto(url, { waitUntil: 'networkidle' })`.
- Scripts print a stdout success line the workflow greps for, exactly like the existing tools (`Localized diffs for run <id>`).
- No new external dependencies. No changes to the Sidekick Library suite, the diff algorithm, clustering, or ignore rules.

---

### Task 1: Anchor-matching module (`lib/anchor-match.js`)

**Files:**
- Create: `aem-visual-checker/tools/page-diff/lib/anchor-match.js`
- Test: `aem-visual-checker/tools/page-diff/lib/anchor-match.test.js`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces (pure, unit-tested):
  - `normalizeText(value: string) => string` — trim, collapse whitespace, lowercase.
  - `unionBox(boxes: {x,y,width,height}[]) => {x,y,width,height} | null` — bounding box enclosing all input boxes; `null` for `[]`.
  - `computeConfidence({ totalAnchors, matchedAnchors, regionArea, viewportArea }, config) => number` — `0..1`.
- Produces (browser-dependent, NOT unit-tested, same file): `extractAnchors(page, selector)`, `findAnchorsInLiveDom(page, anchors)` — see Task 4 for their use.

- [ ] **Step 1: Write the failing test**

```js
// aem-visual-checker/tools/page-diff/lib/anchor-match.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, unionBox, computeConfidence } from './anchor-match.js';

const CONFIG = { maxAncestorAreaRatio: 0.6 };

test('normalizeText trims, collapses whitespace, lowercases', () => {
  assert.equal(normalizeText('  NO   GOAL\nIS  TOO Small '), 'no goal is too small');
});

test('unionBox returns the enclosing box of all inputs', () => {
  const box = unionBox([
    { x: 10, y: 20, width: 30, height: 40 }, // right=40 bottom=60
    { x: 5, y: 50, width: 10, height: 30 },  // right=15 bottom=80
  ]);
  assert.deepEqual(box, { x: 5, y: 20, width: 35, height: 60 });
});

test('unionBox returns null for no boxes', () => {
  assert.equal(unionBox([]), null);
});

test('computeConfidence is 1 when all anchors match and region is tight', () => {
  const c = computeConfidence(
    { totalAnchors: 4, matchedAnchors: 4, regionArea: 100_000, viewportArea: 1_000_000 },
    CONFIG,
  );
  assert.equal(c, 1);
});

test('computeConfidence scales down with partial matches', () => {
  const c = computeConfidence(
    { totalAnchors: 4, matchedAnchors: 2, regionArea: 100_000, viewportArea: 1_000_000 },
    CONFIG,
  );
  assert.equal(c, 0.5);
});

test('computeConfidence penalizes a region that fills most of the viewport', () => {
  const tight = computeConfidence(
    { totalAnchors: 2, matchedAnchors: 2, regionArea: 100_000, viewportArea: 1_000_000 }, CONFIG,
  );
  const sprawling = computeConfidence(
    { totalAnchors: 2, matchedAnchors: 2, regionArea: 900_000, viewportArea: 1_000_000 }, CONFIG,
  );
  assert.equal(tight, 1);
  assert.ok(sprawling < tight);
});

test('computeConfidence is 0 with no anchors', () => {
  assert.equal(
    computeConfidence({ totalAnchors: 0, matchedAnchors: 0, regionArea: 0, viewportArea: 1_000_000 }, CONFIG),
    0,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test aem-visual-checker/tools/page-diff/lib/anchor-match.test.js`
Expected: FAIL — `Cannot find module './anchor-match.js'`.

- [ ] **Step 3: Write the implementation**

```js
// aem-visual-checker/tools/page-diff/lib/anchor-match.js

export function normalizeText(value) {
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

export function unionBox(boxes) {
  if (!boxes || boxes.length === 0) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Confidence = match ratio, penalized when the matched region fills more of the
// viewport than maxAncestorAreaRatio (a sign the matches are scattered, not one block).
export function computeConfidence({ totalAnchors, matchedAnchors, regionArea, viewportArea }, config) {
  if (!totalAnchors) return 0;
  const matchRatio = matchedAnchors / totalAnchors;
  const areaRatio = viewportArea > 0 ? regionArea / viewportArea : 0;
  const maxRatio = config.maxAncestorAreaRatio;
  const penalty = areaRatio > maxRatio ? (areaRatio - maxRatio) / (1 - maxRatio) : 0;
  return Math.max(0, Math.min(1, matchRatio * (1 - penalty)));
}

// --- Browser-dependent (run via page.evaluate; verified manually, not unit-tested) ---

// Reads the migrated block's distinctive content to use as live-page search anchors.
export async function extractAnchors(page, selector) {
  return page.evaluate(({ sel, maxTexts }) => {
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
    const root = document.querySelector(sel);
    if (!root) return { headings: [], texts: [], images: [] };
    const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .map((el) => norm(el.textContent)).filter(Boolean);
    const texts = [...root.querySelectorAll('p,li,span,a,button')]
      .map((el) => norm(el.textContent)).filter((t) => t.length >= 12)
      .sort((a, b) => b.length - a.length).slice(0, maxTexts);
    const images = [...root.querySelectorAll('img')].map((img) => ({
      srcBase: (img.getAttribute('src') || '').split('?')[0].split('/').pop() || '',
      alt: norm(img.getAttribute('alt') || ''),
    })).filter((i) => i.srcBase || i.alt);
    return { headings, texts, images };
  }, { sel: selector, maxTexts: 5 });
}

// Finds the migrated block's anchors on the live page; returns matched element boxes
// (full-page scroll-offset coords) and how many distinct anchors matched.
export async function findAnchorsInLiveDom(page, anchors) {
  return page.evaluate(({ a }) => {
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
    const boxOf = (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height,
      };
    };
    const all = [...document.querySelectorAll('*')];
    const boxes = [];
    let matched = 0;
    const textAnchors = [...a.headings, ...a.texts];
    for (const anchor of textAnchors) {
      const needle = norm(anchor);
      const hit = all.find((el) => el.children.length === 0 && norm(el.textContent).includes(needle));
      if (hit) { matched += 1; boxes.push(boxOf(hit)); }
    }
    for (const img of a.images) {
      const hit = document.querySelector('img');
      const match = [...document.querySelectorAll('img')].find((el) => {
        const srcBase = (el.getAttribute('src') || '').split('?')[0].split('/').pop() || '';
        return (img.srcBase && srcBase === img.srcBase) || (img.alt && norm(el.getAttribute('alt') || '') === img.alt);
      }) || (img.srcBase || img.alt ? null : hit);
      if (match) { matched += 1; boxes.push(boxOf(match)); }
    }
    const total = textAnchors.length + a.images.length;
    return { matchedBoxes: boxes, matchedCount: matched, totalCount: total };
  }, { a: anchors });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test aem-visual-checker/tools/page-diff/lib/anchor-match.test.js`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add aem-visual-checker/tools/page-diff/lib/anchor-match.js aem-visual-checker/tools/page-diff/lib/anchor-match.test.js
git commit -m "feat: add content-anchor matching for live block location"
```

---

### Task 2: Baseline path + manifest helpers (`lib/block-baseline.js`)

**Files:**
- Create: `aem-visual-checker/tools/page-diff/lib/block-baseline.js`
- Test: `aem-visual-checker/tools/page-diff/lib/block-baseline.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `blockSlug(block: string) => string` — `"landmark:nav"` → `"landmark-nav"`, `"hero-spotlight"` → `"hero-spotlight"`.
  - `baselineDir(targetDir, pairSlug) => string`
  - `baselinePath(targetDir, pairSlug, block, viewportLabel) => string` — `.../baselines/<pairSlug>/<blockSlug>-<viewport-lowercase>.png`
  - `readManifest(targetDir, pairSlug) => Promise<{ entries: object[] }>` — `{ entries: [] }` if absent.
  - `upsertManifestEntry(targetDir, pairSlug, entry) => Promise<void>` — replace-by-(`block`,`viewport`) then write pretty JSON.

- [ ] **Step 1: Write the failing test**

```js
// aem-visual-checker/tools/page-diff/lib/block-baseline.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blockSlug, baselinePath, readManifest, upsertManifestEntry,
} from './block-baseline.js';

test('blockSlug turns kind:name into a filesystem-safe slug', () => {
  assert.equal(blockSlug('hero-spotlight'), 'hero-spotlight');
  assert.equal(blockSlug('landmark:nav'), 'landmark-nav');
  assert.equal(blockSlug('Card Set'), 'card-set');
});

test('baselinePath composes the expected location', () => {
  const p = baselinePath('/proj', 'home', 'hero-spotlight', 'Desktop');
  assert.equal(p, '/proj/tools/page-diff/baselines/home/hero-spotlight-desktop.png');
});

test('readManifest returns empty entries when absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bl-'));
  try {
    assert.deepEqual(await readManifest(dir, 'home'), { entries: [] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('upsertManifestEntry inserts then replaces by block+viewport', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bl-'));
  try {
    await upsertManifestEntry(dir, 'home', { block: 'hero', viewport: 'Desktop', confidence: 0.5 });
    await upsertManifestEntry(dir, 'home', { block: 'hero', viewport: 'Tablet', confidence: 0.9 });
    await upsertManifestEntry(dir, 'home', { block: 'hero', viewport: 'Desktop', confidence: 0.95 });
    const manifest = await readManifest(dir, 'home');
    assert.equal(manifest.entries.length, 2);
    const desktop = manifest.entries.find((e) => e.viewport === 'Desktop');
    assert.equal(desktop.confidence, 0.95);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test aem-visual-checker/tools/page-diff/lib/block-baseline.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// aem-visual-checker/tools/page-diff/lib/block-baseline.js
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function blockSlug(block) {
  return String(block).replace(/:/g, '-').trim().toLowerCase().replace(/\s+/g, '-');
}

export function baselineDir(targetDir, pairSlug) {
  return join(targetDir, 'tools', 'page-diff', 'baselines', pairSlug);
}

export function baselinePath(targetDir, pairSlug, block, viewportLabel) {
  return join(baselineDir(targetDir, pairSlug), `${blockSlug(block)}-${viewportLabel.toLowerCase()}.png`);
}

function manifestPath(targetDir, pairSlug) {
  return join(baselineDir(targetDir, pairSlug), 'manifest.json');
}

export async function readManifest(targetDir, pairSlug) {
  try {
    return JSON.parse(await readFile(manifestPath(targetDir, pairSlug), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { entries: [] };
    throw error;
  }
}

export async function upsertManifestEntry(targetDir, pairSlug, entry) {
  await mkdir(baselineDir(targetDir, pairSlug), { recursive: true });
  const manifest = await readManifest(targetDir, pairSlug);
  const entries = manifest.entries.filter(
    (e) => !(e.block === entry.block && e.viewport === entry.viewport),
  );
  entries.push(entry);
  await writeFile(manifestPath(targetDir, pairSlug), JSON.stringify({ entries }, null, 2));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test aem-visual-checker/tools/page-diff/lib/block-baseline.test.js`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add aem-visual-checker/tools/page-diff/lib/block-baseline.js aem-visual-checker/tools/page-diff/lib/block-baseline.test.js
git commit -m "feat: add block baseline path + manifest helpers"
```

---

### Task 3: Block crop comparison (`lib/block-compare.js`)

**Files:**
- Create: `aem-visual-checker/tools/page-diff/lib/block-compare.js`
- Test: `aem-visual-checker/tools/page-diff/lib/block-compare.test.js`

**Interfaces:**
- Consumes: `diffScreenshots` from `./screenshot-diff.js`; `THRESHOLDS` shape.
- Produces: `compareBlockCrops(baselineBuffer, migratedBuffer, config) => { pass, diffPixelCount, widthDelta, heightMismatch, diffPngBuffer }`. Normalizes differing widths (left-aligned crop to the common min width, recording `widthDelta`) before calling `diffScreenshots` (which itself handles differing heights). `pass` is `regions.length === 0`; `diffPixelCount` sums `region.diffPixelCount`.

- [ ] **Step 1: Write the failing test**

```js
// aem-visual-checker/tools/page-diff/lib/block-compare.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { compareBlockCrops } from './block-compare.js';

const CONFIG = {
  cellSize: 16, cellDiffThreshold: 4, minClusterAreaPx: 300,
  heightMismatchTolerancePx: 50, pixelmatchThreshold: 0.1,
};

function solidPng(width, height, [r, g, b]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    png.data[i * 4] = r; png.data[i * 4 + 1] = g; png.data[i * 4 + 2] = b; png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

test('identical crops pass with zero diff', () => {
  const a = solidPng(200, 200, [255, 255, 255]);
  const result = compareBlockCrops(a, solidPng(200, 200, [255, 255, 255]), CONFIG);
  assert.equal(result.pass, true);
  assert.equal(result.diffPixelCount, 0);
  assert.equal(result.widthDelta, 0);
  assert.equal(result.heightMismatch, null);
});

test('fully different crops fail with a diff region', () => {
  const result = compareBlockCrops(
    solidPng(200, 200, [255, 255, 255]), solidPng(200, 200, [0, 0, 0]), CONFIG,
  );
  assert.equal(result.pass, false);
  assert.ok(result.diffPixelCount > 0);
});

test('differing widths are normalized to the common width and reported', () => {
  const result = compareBlockCrops(
    solidPng(200, 100, [255, 255, 255]), solidPng(160, 100, [255, 255, 255]), CONFIG,
  );
  assert.equal(result.widthDelta, 40);
  assert.equal(result.pass, true); // overlapping region is identical
});

test('differing heights are reported via heightMismatch', () => {
  const result = compareBlockCrops(
    solidPng(200, 200, [255, 255, 255]), solidPng(200, 320, [255, 255, 255]), CONFIG,
  );
  assert.ok(result.heightMismatch);
  assert.equal(result.heightMismatch.deltaPx, 120);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test aem-visual-checker/tools/page-diff/lib/block-compare.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// aem-visual-checker/tools/page-diff/lib/block-compare.js
import { PNG } from 'pngjs';
import { diffScreenshots } from './screenshot-diff.js';

// Left-align crop a PNG buffer to a narrower width (keeps full height).
function cropWidth(buffer, width) {
  const src = PNG.sync.read(buffer);
  if (src.width === width) return buffer;
  const dst = new PNG({ width, height: src.height });
  PNG.bitblt(src, dst, 0, 0, width, src.height, 0, 0);
  return PNG.sync.write(dst);
}

// Compares a migrated block crop against its saved live baseline. Widths are
// normalized to the common min (diffScreenshots throws on width mismatch); differing
// heights are handled by diffScreenshots itself and surfaced as heightMismatch.
export function compareBlockCrops(baselineBuffer, migratedBuffer, config) {
  const baseline = PNG.sync.read(baselineBuffer);
  const migrated = PNG.sync.read(migratedBuffer);
  const widthDelta = Math.abs(baseline.width - migrated.width);
  const commonWidth = Math.min(baseline.width, migrated.width);

  const {
    diffPngBuffer, regions, pageLengthMismatch,
  } = diffScreenshots(cropWidth(baselineBuffer, commonWidth), cropWidth(migratedBuffer, commonWidth), config);

  const diffPixelCount = regions.reduce((sum, r) => sum + r.diffPixelCount, 0);
  return {
    pass: regions.length === 0,
    diffPixelCount,
    widthDelta,
    heightMismatch: pageLengthMismatch,
    diffPngBuffer,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test aem-visual-checker/tools/page-diff/lib/block-compare.test.js`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add aem-visual-checker/tools/page-diff/lib/block-compare.js aem-visual-checker/tools/page-diff/lib/block-compare.test.js
git commit -m "feat: add block crop comparison with width/height reconciliation"
```

---

### Task 4: `capture-live-block.js` script

**Files:**
- Create: `aem-visual-checker/tools/page-diff/capture-live-block.js`

**Interfaces:**
- Consumes: `runCompare` (`./compare-page-diff.js`), `collectBlockBoxes` (`./lib/dom-capture.js`), `extractAnchors`/`findAnchorsInLiveDom`/`unionBox`/`computeConfidence` (`./lib/anchor-match.js`), `cropPng` (`./lib/crop-images.js`), `baselinePath`/`baselineDir`/`upsertManifestEntry` (`./lib/block-baseline.js`), `VIEWPORTS`/`THRESHOLDS`/`ANCHOR_MATCH` (`./config.js` — added in Task 6).
- Produces: `runCaptureLiveBlock({ runId, mappingFile, block, viewport, liveSelector, targetDir }) => { runId, results }`. `results` is per-viewport `{ viewportLabel, baselinePath, confidence, liveSelectorUsed, candidateSelectors }`. Prints `Captured live block <block> for run <runId>`.

- [ ] **Step 1: Write the script (browser-dependent — verified manually, no unit test)**

```js
// aem-visual-checker/tools/page-diff/capture-live-block.js
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { runCompare } from './compare-page-diff.js';
import { collectBlockBoxes } from './lib/dom-capture.js';
import { extractAnchors, findAnchorsInLiveDom, unionBox, computeConfidence } from './lib/anchor-match.js';
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
        const migratedBlocks = await collectBlockBoxes(migratedPage);
        const migratedBlock = findBlockBox(migratedBlocks, block);
        if (!migratedBlock) throw new Error(`Block "${block}" not found on migrated page at ${vp.label}`);
        const anchors = await extractAnchors(migratedPage, migratedBlock.selector);

        const livePage = await liveContext.newPage();
        await livePage.goto(pair.liveUrl, { waitUntil: 'networkidle' });

        let region;
        let confidence;
        let liveSelectorUsed = liveSelector || null;
        let candidateSelectors = [];
        if (liveSelector) {
          region = await livePage.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
          }, liveSelector);
          if (!region) throw new Error(`liveSelector "${liveSelector}" not found on live page`);
          confidence = 1;
        } else {
          const { matchedBoxes, matchedCount, totalCount } = await findAnchorsInLiveDom(livePage, anchors);
          region = unionBox(matchedBoxes);
          const viewportArea = vp.width * (region ? region.height : vp.height);
          confidence = region
            ? computeConfidence({
              totalAnchors: totalCount, matchedAnchors: matchedCount,
              regionArea: region.width * region.height, viewportArea: vp.width * (await livePage.evaluate(() => document.body.scrollHeight)),
            }, ANCHOR_MATCH)
            : 0;
          if (!region || confidence < ANCHOR_MATCH.minConfidence) {
            candidateSelectors = matchedBoxes.length ? ['(low confidence — pass liveSelector to override)'] : ['(no anchors matched — pass liveSelector)'];
          }
        }

        if (region) {
          const fullPage = await livePage.screenshot({ fullPage: true, type: 'png', animations: 'disabled' });
          const meta = await livePage.evaluate(() => ({ w: document.body.scrollWidth, h: document.body.scrollHeight }));
          const crop = cropPng(fullPage, region, THRESHOLDS.cropPadding, Math.max(meta.w, vp.width), meta.h);
          await mkdir(baselineDir(targetDir, pair.pairSlug), { recursive: true });
          const outPath = baselinePath(targetDir, pair.pairSlug, block, vp.label);
          await writeFile(outPath, crop);
          await upsertManifestEntry(targetDir, pair.pairSlug, {
            block, viewport: vp.label, liveSelector: liveSelectorUsed, boundingBox: region,
            anchors, confidence, sourceUrl: pair.liveUrl, capturedAt: new Date().toISOString(),
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
      run: { type: 'string' }, mapping: { type: 'string' }, block: { type: 'string' },
      viewport: { type: 'string' }, 'live-selector': { type: 'string' },
    },
  });
  if (!values.block || (!values.run && !values.mapping)) {
    console.error('Usage: node capture-live-block.js --block <kind:name> (--run <id> | --mapping <path>) [--viewport <label>] [--live-selector <css>]');
    process.exit(1);
  }
  const { runId, results } = await runCaptureLiveBlock({
    runId: values.run, mappingFile: values.mapping, block: values.block,
    viewport: values.viewport, liveSelector: values['live-selector'], targetDir: process.cwd(),
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
```

- [ ] **Step 2: Verify it parses and the pure deps resolve**

Run: `node --check aem-visual-checker/tools/page-diff/capture-live-block.js`
Expected: no output, exit 0. (End-to-end run needs a live/migrated pair — verified manually in Task 9.)

- [ ] **Step 3: Commit**

```bash
git add aem-visual-checker/tools/page-diff/capture-live-block.js
git commit -m "feat: add capture-live-block script (live baseline via anchor matching)"
```

---

### Task 5: `compare-block.js` script

**Files:**
- Create: `aem-visual-checker/tools/page-diff/compare-block.js`

**Interfaces:**
- Consumes: `collectBlockBoxes`, `cropPng`, `compareBlockCrops`, `baselinePath`, `serveReport`-free (report handled by workflow); `VIEWPORTS`/`THRESHOLDS`; `parseBlock`/`findBlockBox` logic (duplicated locally — small, avoids exporting from the sibling script).
- Produces: `runCompareBlock({ runId, mappingFile, block, viewport, targetDir }) => { runId, runDir, results }`. `results` per-viewport `{ viewportLabel, pass, diffPixelCount, widthDelta, heightMismatch, crops: {baseline, migrated, diff} }`. Writes crops to `runs/<runId>/block-compare/<blockSlug>/`. Prints `Compared block <block> for run <runId>`.

- [ ] **Step 1: Write the script (browser-dependent — verified manually, no unit test)**

```js
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
          viewportLabel: vp.label, pass: cmp.pass, diffPixelCount: cmp.diffPixelCount,
          widthDelta: cmp.widthDelta, heightMismatch: cmp.heightMismatch,
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
```

- [ ] **Step 2: Verify it parses**

Run: `node --check aem-visual-checker/tools/page-diff/compare-block.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add aem-visual-checker/tools/page-diff/compare-block.js
git commit -m "feat: add compare-block script (migrated block vs saved live baseline)"
```

---

### Task 6: Config additions (`ANCHOR_MATCH`)

**Files:**
- Modify: `aem-visual-checker/tools/page-diff/config.js`

**Interfaces:**
- Produces: `export const ANCHOR_MATCH = { minConfidence, maxTextAnchors, maxAncestorAreaRatio }` — consumed by Task 1 (`computeConfidence`) and Task 4.

- [ ] **Step 1: Add the export**

Append to `aem-visual-checker/tools/page-diff/config.js` (after the existing `THRESHOLDS` export):

```js

export const ANCHOR_MATCH = {
  minConfidence: 0.6,      // below this, surface candidates and ask for a liveSelector
  maxTextAnchors: 5,       // longest text runs used as search anchors
  maxAncestorAreaRatio: 0.6, // matched region beyond this fraction of page area is penalized
};
```

- [ ] **Step 2: Verify all tool tests still pass**

Run: `npm test`
Expected: PASS — existing suite plus Tasks 1-3 tests all green.

- [ ] **Step 3: Commit**

```bash
git add aem-visual-checker/tools/page-diff/config.js
git commit -m "feat: add ANCHOR_MATCH config for block baseline capture"
```

---

### Task 7: `captureLiveBlock` Mastra workflow + MCP tool

**Files:**
- Create: `src/workflows/capture-live-block.ts`
- Create: `src/tools/capture-live-block-tool.ts`
- Modify: `src/mcp-server.ts` (register the tool + mention it in `instructions`)

**Interfaces:**
- Consumes: the `capture-live-block.js` script via `execFile` (mirrors `localize-page-diff.ts`).
- Produces: `captureLiveBlockTool` (MCP id `captureLiveBlock`), registered in the server tool map.

- [ ] **Step 1: Write the workflow**

```ts
// src/workflows/capture-live-block.ts
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { resolveProjectDir } from './project-dir.js';

const execFileAsync = promisify(execFile);

export const captureLiveBlockStep = createStep({
  id: 'run-capture-live-block',
  description: 'Runs node tools/page-diff/capture-live-block.js in the target project.',
  inputSchema: z.object({
    block: z.string(),
    runId: z.string().optional(),
    mappingFile: z.string().optional(),
    viewport: z.string().optional(),
    liveSelector: z.string().optional(),
    projectDir: z.string().optional(),
  }),
  outputSchema: z.object({
    ranSuccessfully: z.boolean(),
    message: z.string(),
    output: z.string(),
  }),
  execute: async ({ getInitData }) => {
    const {
      block, runId, mappingFile, viewport, liveSelector, projectDir,
    } = getInitData<{ block: string; runId?: string; mappingFile?: string; viewport?: string; liveSelector?: string; projectDir?: string }>();
    const targetDir = resolveProjectDir(projectDir);

    if (!block || (!runId && !mappingFile)) {
      return { ranSuccessfully: false, message: 'block and one of runId/mappingFile are required.', output: '' };
    }

    const args = ['tools/page-diff/capture-live-block.js', '--block', block];
    if (runId) args.push('--run', runId);
    if (mappingFile) args.push('--mapping', mappingFile);
    if (viewport) args.push('--viewport', viewport);
    if (liveSelector) args.push('--live-selector', liveSelector);

    let stdout = '';
    let commandError: string | null = null;
    try {
      ({ stdout } = await execFileAsync('node', args, { cwd: targetDir }));
    } catch (error) {
      const e = error as { stdout?: string; message: string };
      stdout = e.stdout ?? '';
      commandError = e.message;
    }

    const ok = /Captured live block .+ for run \S+/.test(stdout);
    return {
      ranSuccessfully: ok,
      message: ok ? 'Ran captureLiveBlock.' : (commandError ?? 'capture-live-block.js did not report success.'),
      output: stdout,
    };
  },
});

export const captureLiveBlockWorkflow = createWorkflow({
  id: 'capture-live-block',
  description: 'Captures a live-site block rendering as a durable per-block baseline via content-anchor matching.',
  inputSchema: captureLiveBlockStep.inputSchema,
  outputSchema: captureLiveBlockStep.outputSchema,
})
  .then(captureLiveBlockStep)
  .commit();
```

- [ ] **Step 2: Write the MCP tool**

```ts
// src/tools/capture-live-block-tool.ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { captureLiveBlockWorkflow } from '../workflows/capture-live-block.js';

export const captureLiveBlockTool = createTool({
  id: 'captureLiveBlock',
  description: 'Locates a block on the LIVE site (by matching the migrated block\'s content) and saves its rendering as a durable per-block baseline for later comparison. Given a comparePageDiff runId and a block name, hits the live site once. On low match confidence it returns candidate info and asks you to re-run with an explicit liveSelector.',
  inputSchema: z.object({
    block: z.string().describe('Block to capture, as "name" or "kind:name" (e.g. "hero-spotlight", "landmark:nav"), matched against the run\'s block roll-up.'),
    runId: z.string().optional().describe('An existing comparePageDiff run ID (supplies the live/migrated URL pair). Omit to run a fresh comparison via mappingFile.'),
    mappingFile: z.string().optional().describe('Path to a CSV/JSON mapping file to run a fresh comparison first. Omit if runId is given.'),
    viewport: z.string().optional().describe('A single viewport label (Mobile/Tablet/Desktop/Large). Omit to capture all configured viewports.'),
    liveSelector: z.string().optional().describe('A CSS selector on the live page to screenshot instead of anchor-matching. Use to override a low-confidence auto-match.'),
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory.'),
  }),
  execute: async ({ block, runId, mappingFile, viewport, liveSelector, projectDir }) => {
    const run = await captureLiveBlockWorkflow.createRun();
    const result = await run.start({ inputData: { block, runId, mappingFile, viewport, liveSelector, projectDir } });
    const output = result.status === 'success' ? result.result : undefined;
    const text = output?.output
      ? `${output.message}\n\n${output.output}`
      : (output?.message ?? `captureLiveBlock did not complete (status: ${result.status}).`);
    return { content: [{ type: 'text', text }] };
  },
});
```

- [ ] **Step 3: Register in the server**

In `src/mcp-server.ts`, add the import and the tool-map entry alongside the other page-diff tools:

```ts
import { captureLiveBlockTool } from './tools/capture-live-block-tool.js';
```

and in the tools object (next to `comparePageDiff`/`localizePageDiff`):

```ts
    captureLiveBlock: captureLiveBlockTool,
```

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/capture-live-block.ts src/tools/capture-live-block-tool.ts src/mcp-server.ts
git commit -m "feat: register captureLiveBlock MCP tool and workflow"
```

---

### Task 8: `compareBlock` Mastra workflow + MCP tool

**Files:**
- Create: `src/workflows/compare-block.ts`
- Create: `src/tools/compare-block-tool.ts`
- Modify: `src/mcp-server.ts` (register + mention in `instructions`)

**Interfaces:**
- Consumes: the `compare-block.js` script via `execFile`; `serveReport` (`../workflows/report-server.js`) to serve the run dir.
- Produces: `compareBlockTool` (MCP id `compareBlock`).

- [ ] **Step 1: Write the workflow**

```ts
// src/workflows/compare-block.ts
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
```

- [ ] **Step 2: Write the MCP tool**

```ts
// src/tools/compare-block-tool.ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { compareBlockWorkflow } from '../workflows/compare-block.js';

export const compareBlockTool = createTool({
  id: 'compareBlock',
  description: 'Re-screenshots one migrated block and pixel-diffs it against its saved live baseline (from captureLiveBlock), per viewport. Fast and offline (migrated page only). Re-run after each CSS/markup fix until every viewport passes.',
  inputSchema: z.object({
    block: z.string().describe('Block to compare, as "name" or "kind:name". A live baseline must exist (run captureLiveBlock first).'),
    runId: z.string().optional().describe('The comparePageDiff run ID whose live baselines / migrated URL to use. Omit to run a fresh comparison via mappingFile.'),
    mappingFile: z.string().optional().describe('Path to a CSV/JSON mapping file to run a fresh comparison first. Omit if runId is given.'),
    viewport: z.string().optional().describe('A single viewport label (Mobile/Tablet/Desktop/Large). Omit to compare all captured viewports.'),
    projectDir: z.string().optional().describe('Absolute path to the target AEM project. Defaults to CLAUDE_PROJECT_DIR or the server process\'s working directory.'),
  }),
  execute: async ({ block, runId, mappingFile, viewport, projectDir }) => {
    const run = await compareBlockWorkflow.createRun();
    const result = await run.start({ inputData: { block, runId, mappingFile, viewport, projectDir } });
    const output = result.status === 'success' ? result.result : undefined;
    if (!output) {
      return { content: [{ type: 'text', text: `compareBlock did not complete (status: ${result.status}).` }] };
    }
    const body = output.output ? `${output.message}\n\n${output.output}` : output.message;
    const text = output.reportUrl ? `${body}\n\n**page-diff report:** ${output.reportUrl}` : body;
    return { content: [{ type: 'text', text }] };
  },
});
```

- [ ] **Step 3: Register in the server**

In `src/mcp-server.ts`:

```ts
import { compareBlockTool } from './tools/compare-block-tool.js';
```

and in the tools object:

```ts
    compareBlock: compareBlockTool,
```

- [ ] **Step 4: Verify type-check + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` exit 0; test suite all green.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/compare-block.ts src/tools/compare-block-tool.ts src/mcp-server.ts
git commit -m "feat: register compareBlock MCP tool and workflow"
```

---

### Task 9: Server instructions + docs

**Files:**
- Modify: `src/mcp-server.ts` (extend the page-diff `instructions` narrative)
- Modify: `AGENTS.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing at runtime; documents Tasks 4-8.

- [ ] **Step 1: Extend the server `instructions`**

In `src/mcp-server.ts`, in the page-diff section of the `instructions` string, after the `localizePageDiff` bullet (item 3), add:

```
4. captureLiveBlock -- for a block the roll-up flagged as broken, locate it on the LIVE site by content-anchor matching and save its rendering as a durable per-block baseline (tools/page-diff/baselines/). On low confidence it returns candidates; re-run with an explicit liveSelector to override.
5. compareBlock -- re-screenshot just that migrated block and diff it against the saved live baseline, per viewport. Fast and offline. After each fix to the block's CSS/markup, re-run compareBlock until every viewport passes, then move to the next broken block.
```

- [ ] **Step 2: Update AGENTS.md**

After the `### localizePageDiff` section in `AGENTS.md`, add two sections documenting `captureLiveBlock` and `compareBlock` (inputs from Tasks 7-8, and the end-to-end loop: `comparePageDiff` → pick a broken block from the roll-up → `captureLiveBlock` → `compareBlock` → fix → repeat → next block). State that live baselines are captured once and committed, and that low-confidence matches surface candidates + accept a `liveSelector` override.

- [ ] **Step 3: Update README.md**

Add two rows to the page-diff tools table in `README.md`:

```markdown
| `captureLiveBlock` | Locates a broken block on the live site (content-anchor matching) and saves its rendering as a durable per-block baseline | "Capture the live baseline for the hero-spotlight block." |
| `compareBlock` | Re-diffs one migrated block against its saved live baseline, per viewport, for a fast fix loop | "Compare the hero-spotlight block against its live baseline." |
```

- [ ] **Step 4: End-to-end manual verification (browser-dependent scripts)**

With a running migrated dev server and a reachable live URL, from the target project:

Run: `node tools/page-diff/capture-live-block.js --block hero-spotlight --mapping <mapping.json> --viewport Desktop`
Expected: prints a `Desktop: <path> (confidence …)` line and `Captured live block hero-spotlight for run <id>`; a baseline PNG exists under `tools/page-diff/baselines/`.

Run: `node tools/page-diff/compare-block.js --block hero-spotlight --run <id> --viewport Desktop`
Expected: prints `Desktop: PASS|FAIL (…px …)` and `Compared block hero-spotlight for run <id>`; diff crops exist under `runs/<id>/block-compare/hero-spotlight/`.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server.ts AGENTS.md README.md
git commit -m "docs: document captureLiveBlock/compareBlock and the block-fix loop"
```

---

## Self-Review

**Spec coverage:**
- Content-anchor matching (extract/find/score/confidence) → Task 1. ✓
- Durable baselines + manifest → Task 2. ✓
- In-context diff with size reconciliation (`heightDelta`/width normalization) → Task 3. ✓
- `captureLiveBlock` (once, live, confidence gate + `liveSelector` fallback) → Tasks 4, 7. ✓
- `compareBlock` (migrated-only, offline, per-viewport, report) → Tasks 5, 8. ✓
- Config thresholds → Task 6. ✓
- MCP registration + instructions + AGENTS/README → Tasks 7-9. ✓
- Ship via `tools/page-diff/` (installPageDiff) → all script/lib files live there. ✓
- Out-of-scope (Sidekick suite, auto-fix, mobile bug) → untouched. ✓

**Placeholder scan:** No TBD/"handle edge cases"; every code step shows complete code and exact commands. Browser scripts have `node --check` gates plus a Task-9 end-to-end manual check (consistent with how the existing browser-dependent page-diff code is verified).

**Type consistency:** `runCaptureLiveBlock`/`runCompareBlock` signatures, the `{ runId, mappingFile, block, viewport, liveSelector?, projectDir }` input shape, `blockSlug`/`baselinePath`/`upsertManifestEntry`/`compareBlockCrops`/`computeConfidence`/`unionBox` names, and the stdout success strings (`Captured live block … for run …`, `Compared block … for run …`) match across the scripts, workflows, and tools. Config `ANCHOR_MATCH` fields (`minConfidence`, `maxTextAnchors`, `maxAncestorAreaRatio`) are consistent between Task 1's test, Task 6, and Task 4's usage.
