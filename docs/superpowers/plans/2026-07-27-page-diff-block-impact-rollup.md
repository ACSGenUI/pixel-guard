# page-diff Block Impact Roll-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `comparePageDiff` automatically compute a ranked, cross-viewport per-block impact roll-up and surface it at the top of both the MCP text response and the HTML report.

**Architecture:** A new pure module (`lib/block-summary.js`) aggregates already-attributed failing regions per block across viewports and ranks them (coverage-first composite). `compare-page-diff.js` calls it once per pair and persists the result as `pair.blockSummary` in `run-summary.json` (single source of truth). The HTML report and the MCP formatter each read that persisted field; neither recomputes.

**Tech Stack:** Node.js ESM (`.js` modules under `tools/page-diff/`), `node:test` + `node:assert/strict` for target-tool tests; TypeScript + Zod + Mastra for the MCP server (`src/`); tests run via `npm test` (`tsx --test 'src/**/*.test.ts' 'aem-visual-checker/tools/page-diff/**/*.test.js'`).

## Global Constraints

- Roll-up covers only **failing** regions (`status === 'failed'`) that have a non-null `block`; `ignored` and unattributed regions are excluded.
- Grouping key is `kind:name`; distinct on-page instances of the same block type merge (accepted simplification).
- `coverage` = per-viewport `sum(diffPixelCount) / (block box width × height)`, taken as the **max across viewports**, clamped to `[0, 1]`, zero-area box → `0`.
- Ranking within a kind: `coverage` desc → `viewportsAffected.length` desc → `totalDiffPx` desc. Kind output order: `block`, `landmark`, `section`.
- `blockSummary` schema field is `.optional()` — runs produced before this change must still parse.
- HTML report stays a single self-contained file (inline `<style>`, minimal vanilla JS, no external assets); all interpolated values HTML-escaped via the existing `escapeHtml`.
- No new external dependencies.

---

### Task 1: Pure `buildBlockSummary` aggregation module

**Files:**
- Create: `aem-visual-checker/tools/page-diff/lib/block-summary.js`
- Test: `aem-visual-checker/tools/page-diff/lib/block-summary.test.js`

**Interfaces:**
- Consumes: a pair's `viewports[]`, where each viewport is `{ viewportLabel: string, regions: Region[] }` and each `Region` is `{ status, diffPixelCount, block, crops }` with `block = { name, selector, kind: 'block'|'section'|'landmark', boundingBox: {x,y,width,height} } | null` and `crops = { live, migrated, diff }`.
- Produces: `buildBlockSummary(viewports) => BlockRollup[]`, already sorted (kind groups concatenated `block`→`landmark`→`section`, each internally severity-sorted). Each `BlockRollup` is:
  ```
  { kind: 'block'|'section'|'landmark', name: string, selector: string,
    regionCount: number, totalDiffPx: number, coverage: number (0..1),
    viewportsAffected: string[], severityScore: number (== coverage),
    worstViewport: string, worstCrop: string | null }
  ```

- [ ] **Step 1: Write the failing test**

```js
// aem-visual-checker/tools/page-diff/lib/block-summary.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBlockSummary } from './block-summary.js';

function region(overrides) {
  return {
    status: 'failed', diffPixelCount: 100,
    block: { name: 'hero', selector: 'sel', kind: 'block', boundingBox: { x: 0, y: 0, width: 100, height: 100 } },
    crops: { live: 'l.png', migrated: 'm.png', diff: 'd.png' },
    ...overrides,
  };
}

test('aggregates a block across viewports: regionCount, totalDiffPx, viewportsAffected sorted', () => {
  const viewports = [
    { viewportLabel: 'Tablet', regions: [region({ diffPixelCount: 200 })] },
    { viewportLabel: 'Desktop', regions: [region({ diffPixelCount: 300 }), region({ diffPixelCount: 100 })] },
  ];
  const [hero] = buildBlockSummary(viewports);
  assert.equal(hero.name, 'hero');
  assert.equal(hero.regionCount, 3);
  assert.equal(hero.totalDiffPx, 600);
  assert.deepEqual(hero.viewportsAffected, ['Desktop', 'Tablet']);
});

test('coverage is max across viewports = sum(diffPx)/blockArea', () => {
  // block area 100x100 = 10000. Tablet 1000/10000=0.1, Desktop 5000/10000=0.5 -> max 0.5
  const viewports = [
    { viewportLabel: 'Tablet', regions: [region({ diffPixelCount: 1000 })] },
    { viewportLabel: 'Desktop', regions: [region({ diffPixelCount: 5000 })] },
  ];
  const [hero] = buildBlockSummary(viewports);
  assert.equal(hero.coverage, 0.5);
  assert.equal(hero.severityScore, 0.5);
  assert.equal(hero.worstViewport, 'Desktop');
});

test('coverage clamps to 1 when diff pixels exceed the block box area', () => {
  const viewports = [
    { viewportLabel: 'Desktop', regions: [region({ diffPixelCount: 999999 })] },
  ];
  const [hero] = buildBlockSummary(viewports);
  assert.equal(hero.coverage, 1);
});

test('zero-area block box contributes 0 coverage, no NaN', () => {
  const zeroBox = { name: 'ghost', selector: 's', kind: 'block', boundingBox: { x: 0, y: 0, width: 0, height: 0 } };
  const viewports = [
    { viewportLabel: 'Desktop', regions: [region({ block: zeroBox, diffPixelCount: 500 })] },
  ];
  const [ghost] = buildBlockSummary(viewports);
  assert.equal(ghost.coverage, 0);
  assert.equal(Number.isNaN(ghost.coverage), false);
});

test('excludes ignored and unattributed regions', () => {
  const viewports = [{
    viewportLabel: 'Desktop',
    regions: [
      region({ status: 'ignored' }),
      region({ block: null }),
      region({ block: { name: 'cards', selector: 's', kind: 'block', boundingBox: { x: 0, y: 0, width: 100, height: 100 } } }),
    ],
  }];
  const result = buildBlockSummary(viewports);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'cards');
});

test('ranks by coverage desc, then viewportsAffected desc, then totalDiffPx desc; kinds ordered block,landmark,section', () => {
  const mk = (name, kind, label, diffPx) => ({
    viewportLabel: label,
    regions: [region({ block: { name, selector: name, kind, boundingBox: { x: 0, y: 0, width: 100, height: 100 } }, diffPixelCount: diffPx })],
  });
  // blockA coverage 0.6 (Desktop). blockB coverage 0.3 across 2 viewports. landmarkC coverage 0.9. sectionD coverage 0.99.
  const viewports = [
    mk('A', 'block', 'Desktop', 6000),
    mk('B', 'block', 'Tablet', 3000), mk('B', 'block', 'Desktop', 3000),
    mk('C', 'landmark', 'Desktop', 9000),
    mk('D', 'section', 'Desktop', 9900),
  ];
  const names = buildBlockSummary(viewports).map((r) => `${r.kind}:${r.name}`);
  assert.deepEqual(names, ['block:A', 'block:B', 'landmark:C', 'section:D']);
});

test('worstCrop is the diff crop of the largest-diffPixelCount region in the worst viewport', () => {
  const viewports = [{
    viewportLabel: 'Desktop',
    regions: [
      region({ diffPixelCount: 100, crops: { live: 'a-l', migrated: 'a-m', diff: 'a-diff' } }),
      region({ diffPixelCount: 900, crops: { live: 'b-l', migrated: 'b-m', diff: 'b-diff' } }),
    ],
  }];
  const [hero] = buildBlockSummary(viewports);
  assert.equal(hero.worstCrop, 'b-diff');
});

test('empty / no failing regions returns []', () => {
  assert.deepEqual(buildBlockSummary([]), []);
  assert.deepEqual(buildBlockSummary([{ viewportLabel: 'Desktop', regions: [] }]), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test aem-visual-checker/tools/page-diff/lib/block-summary.test.js`
Expected: FAIL — `Cannot find module './block-summary.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// aem-visual-checker/tools/page-diff/lib/block-summary.js

const KIND_ORDER = { block: 0, landmark: 1, section: 2 };

// Aggregates a pair's failing, block-attributed regions into one ranked roll-up per block type.
// Grouping key is `kind:name`; coverage is the max across viewports of (sum diff px / block area),
// clamped to [0,1]. See docs/superpowers/specs/2026-07-27-page-diff-block-impact-rollup-design.md.
export function buildBlockSummary(viewports) {
  const groups = new Map();

  for (const viewport of viewports ?? []) {
    for (const region of viewport.regions ?? []) {
      if (region.status !== 'failed') continue;
      const block = region.block;
      if (!block) continue;

      const key = `${block.kind}:${block.name}`;
      if (!groups.has(key)) {
        groups.set(key, { kind: block.kind, name: block.name, perViewport: new Map() });
      }
      const group = groups.get(key);
      if (!group.perViewport.has(viewport.viewportLabel)) {
        const box = block.boundingBox;
        group.perViewport.set(viewport.viewportLabel, {
          diffPx: 0,
          area: box.width * box.height,
          selector: block.selector,
          regions: [],
        });
      }
      const pv = group.perViewport.get(viewport.viewportLabel);
      pv.diffPx += region.diffPixelCount;
      pv.regions.push(region);
    }
  }

  const rollups = [];
  for (const group of groups.values()) {
    let regionCount = 0;
    let totalDiffPx = 0;
    let coverage = 0;
    let worstViewport = null;
    let worstViewportDiffPx = -1;
    const viewportsAffected = [];

    for (const [label, pv] of group.perViewport) {
      regionCount += pv.regions.length;
      totalDiffPx += pv.diffPx;
      viewportsAffected.push(label);
      const vpCoverage = pv.area > 0 ? Math.min(1, pv.diffPx / pv.area) : 0;
      if (vpCoverage > coverage || (vpCoverage === coverage && pv.diffPx > worstViewportDiffPx)) {
        coverage = vpCoverage;
        worstViewport = label;
        worstViewportDiffPx = pv.diffPx;
      }
    }

    viewportsAffected.sort();
    const worst = group.perViewport.get(worstViewport);
    const worstRegion = worst.regions.reduce((a, b) => (b.diffPixelCount > a.diffPixelCount ? b : a));

    rollups.push({
      kind: group.kind,
      name: group.name,
      selector: worst.selector,
      regionCount,
      totalDiffPx,
      coverage,
      viewportsAffected,
      severityScore: coverage,
      worstViewport,
      worstCrop: worstRegion?.crops?.diff ?? null,
    });
  }

  rollups.sort((a, b) => {
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
    if (b.viewportsAffected.length !== a.viewportsAffected.length) {
      return b.viewportsAffected.length - a.viewportsAffected.length;
    }
    return b.totalDiffPx - a.totalDiffPx;
  });

  return rollups;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test aem-visual-checker/tools/page-diff/lib/block-summary.test.js`
Expected: PASS — 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add aem-visual-checker/tools/page-diff/lib/block-summary.js aem-visual-checker/tools/page-diff/lib/block-summary.test.js
git commit -m "feat: add pure buildBlockSummary block impact roll-up"
```

---

### Task 2: Persist `blockSummary` (schema + wire into compare-page-diff.js)

**Files:**
- Modify: `src/workflows/compare-page-diff.ts:54-59` (add `blockSummary` to `pairResultSchema`)
- Modify: `aem-visual-checker/tools/page-diff/compare-page-diff.js:12-13` (import) and `:126` (attach before push)

**Interfaces:**
- Consumes: `buildBlockSummary(viewports)` from Task 1.
- Produces: `pair.blockSummary: BlockRollup[]` present in `run-summary.json` and typed on the shared `runSummarySchema`. Downstream (`RunSummary['pairs'][number]['blockSummary']`) is the array shape defined in Task 1.

- [ ] **Step 1: Add the Zod field to the shared schema**

In `src/workflows/compare-page-diff.ts`, change `pairResultSchema` (currently lines 54-59) to:

```ts
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
```

- [ ] **Step 2: Verify the type-check passes**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 3: Wire the computation into compare-page-diff.js**

In `aem-visual-checker/tools/page-diff/compare-page-diff.js`, add the import next to the existing `report-html` import (line 13):

```js
import { generateReportHtml } from './lib/report-html.js';
import { buildBlockSummary } from './lib/block-summary.js';
```

Then change the pair-push (line 126) from:

```js
      summary.pairs.push(pairSummary);
```

to:

```js
      pairSummary.blockSummary = buildBlockSummary(pairSummary.viewports);
      summary.pairs.push(pairSummary);
```

- [ ] **Step 4: Verify existing tests still pass and types are clean**

Run: `npm test`
Expected: PASS — all existing target-tool and src tests pass, including Task 1's new tests. (The wiring itself is exercised end-to-end by a real `comparePageDiff` run, which needs a browser and is verified manually; the schema addition is covered by `tsc`.)

- [ ] **Step 5: Commit**

```bash
git add src/workflows/compare-page-diff.ts aem-visual-checker/tools/page-diff/compare-page-diff.js
git commit -m "feat: persist blockSummary in run-summary and shared schema"
```

---

### Task 3: HTML report "Block impact" panel

**Files:**
- Modify: `aem-visual-checker/tools/page-diff/lib/report-html.js` (add `renderBlockImpact`, call it in `renderPair`, add styles)
- Modify: `aem-visual-checker/tools/page-diff/lib/report-html.test.js` (assertions for the panel)

**Interfaces:**
- Consumes: `pair.blockSummary: BlockRollup[]` (Task 1 shape, Task 2 persisted).
- Produces: no new exports; `generateReportHtml(runSummary)` output gains a `.block-impact` section per pair when `blockSummary` is present.

- [ ] **Step 1: Write the failing test**

Add to `aem-visual-checker/tools/page-diff/lib/report-html.test.js`:

```js
test('renders a Block impact panel from pair.blockSummary, grouped by kind and escaped', () => {
  const summary = {
    runId: 'r', createdAt: 'c',
    pairs: [{
      pairSlug: 'home', liveUrl: 'https://l/', migratedUrl: 'https://m/',
      blockSummary: [
        {
          kind: 'block', name: 'carousel-testimonial', selector: 's',
          regionCount: 9, totalDiffPx: 1712285, coverage: 0.61,
          viewportsAffected: ['Desktop', 'Large', 'Tablet'], severityScore: 0.61,
          worstViewport: 'Large', worstCrop: 'home/large/region-5-diff.png',
        },
        {
          kind: 'landmark', name: 'nav', selector: 's2',
          regionCount: 2, totalDiffPx: 6904, coverage: 0.05,
          viewportsAffected: ['Large'], severityScore: 0.05,
          worstViewport: 'Large', worstCrop: null,
        },
      ],
      viewports: [],
    }],
  };
  const html = generateReportHtml(summary);
  assert.match(html, /Block impact/);
  assert.match(html, /Blocks<\/h4>/);
  assert.match(html, /Landmarks<\/h4>/);
  assert.match(html, /carousel-testimonial/);
  assert.match(html, /61% coverage/);
  assert.match(html, /home\/large\/region-5-diff\.png/);
});

test('omits the Block impact panel when a pair has no blockSummary', () => {
  const summary = {
    runId: 'r', createdAt: 'c',
    pairs: [{ pairSlug: 'home', liveUrl: 'https://l/', migratedUrl: 'https://m/', viewports: [] }],
  };
  assert.doesNotMatch(generateReportHtml(summary), /Block impact/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test aem-visual-checker/tools/page-diff/lib/report-html.test.js`
Expected: FAIL — the "Block impact" assertions fail (no such markup yet).

- [ ] **Step 3: Implement the panel**

In `aem-visual-checker/tools/page-diff/lib/report-html.js`, add these functions above `renderPair`:

```js
const KIND_GROUP_LABEL = { block: 'Blocks', landmark: 'Landmarks', section: 'Sections' };

function renderBlockImpactRow(item) {
  const pct = Math.round(item.coverage * 100);
  const vpChips = item.viewportsAffected
    .map((v) => `<span class="vp-chip">${escapeHtml(v)}</span>`).join('');
  const thumb = item.worstCrop
    ? `<img class="bi-thumb" loading="lazy" src="${escapeHtml(item.worstCrop)}" alt="worst diff crop">`
    : '';
  return `
      <div class="bi-row">
        ${thumb}
        <div class="bi-main">
          <div class="bi-name">${escapeHtml(item.name)}</div>
          <div class="bi-bar"><span style="width:${pct}%"></span></div>
        </div>
        <div class="bi-meta">
          <span class="bi-cov">${pct}% coverage</span>
          <span>${item.viewportsAffected.length} viewport${item.viewportsAffected.length === 1 ? '' : 's'}</span>
          ${vpChips}
          <span>${item.regionCount} region${item.regionCount === 1 ? '' : 's'}</span>
          <span>${item.totalDiffPx.toLocaleString('en-US')} px</span>
        </div>
      </div>`;
}

function renderBlockImpact(pair) {
  const summary = pair.blockSummary ?? [];
  if (summary.length === 0) return '';
  const byKind = { block: [], landmark: [], section: [] };
  summary.forEach((item) => { (byKind[item.kind] ?? byKind.block).push(item); });
  const groups = ['block', 'landmark', 'section']
    .filter((kind) => byKind[kind].length > 0)
    .map((kind) => `
    <div class="bi-kind">
      <h4>${KIND_GROUP_LABEL[kind]}</h4>
      ${byKind[kind].map(renderBlockImpactRow).join('')}
    </div>`)
    .join('');
  return `
  <section class="block-impact">
    <h3>Block impact</h3>
    ${groups}
  </section>`;
}
```

Then in `renderPair`, insert the panel between the `</summary>` and the viewports map:

```js
    </summary>
    ${renderBlockImpact(pair)}
    ${pair.viewports.map(renderViewport).join('')}
  </details>`;
```

Add these rules to the end of the `STYLES` template string (before its closing backtick):

```css
    section.block-impact { background: var(--card); border: 1px solid var(--line); border-radius: 8px; margin: .6rem 0 .6rem .5rem; padding: .6rem .9rem; }
    section.block-impact h3 { margin: 0 0 .5rem; font-size: .95rem; }
    .bi-kind h4 { margin: .5rem 0 .3rem; font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
    .bi-row { display: flex; align-items: center; gap: .7rem; padding: .35rem 0; border-top: 1px solid var(--line); }
    .bi-thumb { width: 60px; height: 40px; object-fit: cover; border: 1px solid var(--line); border-radius: 4px; flex: none; }
    .bi-main { flex: 1; min-width: 0; }
    .bi-name { font-weight: 600; font-size: .88rem; }
    .bi-bar { height: 6px; background: var(--line); border-radius: 999px; margin-top: .25rem; overflow: hidden; }
    .bi-bar span { display: block; height: 100%; background: var(--fail); }
    .bi-meta { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; font-size: .74rem; color: var(--muted); }
    .bi-cov { font-weight: 700; color: var(--ink); }
    .vp-chip { font-size: .66rem; border: 1px solid var(--line); border-radius: 4px; padding: 0 .3rem; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test aem-visual-checker/tools/page-diff/lib/report-html.test.js`
Expected: PASS — all report-html tests, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add aem-visual-checker/tools/page-diff/lib/report-html.js aem-visual-checker/tools/page-diff/lib/report-html.test.js
git commit -m "feat: render Block impact panel in page-diff HTML report"
```

---

### Task 4: MCP "Blocks affected" text section

**Files:**
- Modify: `src/tools/compare-page-diff-tool.ts` (export `formatSummary`, add `formatBlockSummary`, call it per pair)
- Create: `src/tools/compare-page-diff-tool.test.ts`

**Interfaces:**
- Consumes: `RunSummary['pairs'][number]['blockSummary']` (Task 2 schema).
- Produces: `export function formatSummary(summary: RunSummary): string` whose output now contains a "Blocks affected (ranked)" block per pair when `blockSummary` is present. `localizePageDiff` inherits this because it reads the same `run-summary.json` through the same formatter path (no separate change).

- [ ] **Step 1: Write the failing test**

```ts
// src/tools/compare-page-diff-tool.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSummary } from './compare-page-diff-tool.js';

const base = {
  pairSlug: 'home', liveUrl: 'https://l/', migratedUrl: 'https://m/',
  viewports: [{ viewportLabel: 'Desktop', status: 'fail', errorMessage: null, pageLengthMismatch: null, regions: [] }],
};

test('renders a ranked Blocks affected section grouped by kind when blockSummary is present', () => {
  const summary = {
    runId: 'r', createdAt: 'c',
    pairs: [{
      ...base,
      blockSummary: [
        {
          kind: 'block', name: 'carousel-testimonial', selector: 's',
          regionCount: 9, totalDiffPx: 1712285, coverage: 0.61,
          viewportsAffected: ['Desktop', 'Large', 'Tablet'], severityScore: 0.61,
          worstViewport: 'Large', worstCrop: 'x-diff.png',
        },
        {
          kind: 'landmark', name: 'nav', selector: 's2',
          regionCount: 2, totalDiffPx: 6904, coverage: 0.05,
          viewportsAffected: ['Large'], severityScore: 0.05,
          worstViewport: 'Large', worstCrop: null,
        },
      ],
    }],
  } as any;
  const text = formatSummary(summary);
  assert.match(text, /Blocks affected \(ranked\)/);
  assert.match(text, /Blocks:/);
  assert.match(text, /Landmarks:/);
  assert.match(text, /Block "carousel-testimonial" — coverage 61%, 3 viewports \[Desktop, Large, Tablet\], 9 regions, 1,712,285 px/);
  assert.match(text, /Landmark "nav" — coverage 5%, 1 viewport \[Large\], 2 regions, 6,904 px/);
});

test('omits the Blocks affected section when blockSummary is absent', () => {
  const summary = { runId: 'r', createdAt: 'c', pairs: [{ ...base }] } as any;
  assert.doesNotMatch(formatSummary(summary), /Blocks affected/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/tools/compare-page-diff-tool.test.ts`
Expected: FAIL — `formatSummary` is not exported (import error) / assertions fail.

- [ ] **Step 3: Implement the section**

In `src/tools/compare-page-diff-tool.ts`:

Add above `formatSummary`:

```ts
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
```

Change the `formatSummary` signature to export it and inject the section right after the pair header line. The current loop body starts:

```ts
  for (const pair of summary.pairs) {
    lines.push(`### ${pair.pairSlug} — ${pair.liveUrl} → ${pair.migratedUrl}`);
    for (const viewport of pair.viewports) {
```

Change to:

```ts
export function formatSummary(summary: RunSummary): string {
  const lines: string[] = [`## Compare Page Diff (run ${summary.runId})`, ''];

  for (const pair of summary.pairs) {
    lines.push(`### ${pair.pairSlug} — ${pair.liveUrl} → ${pair.migratedUrl}`);
    lines.push(...formatBlockSummary(pair));
    for (const viewport of pair.viewports) {
```

(Leave the rest of the function body unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/tools/compare-page-diff-tool.test.ts`
Expected: PASS — both tests pass.

- [ ] **Step 5: Full suite + type-check**

Run: `npm test && npx tsc --noEmit`
Expected: PASS — whole suite green, `tsc` exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/tools/compare-page-diff-tool.ts src/tools/compare-page-diff-tool.test.ts
git commit -m "feat: add ranked Blocks affected section to comparePageDiff response"
```

---

### Task 5: Docs — describe the roll-up in AGENTS.md and README

**Files:**
- Modify: `AGENTS.md` (the `comparePageDiff` section, ~line 115-119)
- Modify: `README.md` (page-diff tools table row)

**Interfaces:**
- Consumes: nothing at runtime; documents Task 2-4 behavior.
- Produces: nothing importable.

- [ ] **Step 1: Update AGENTS.md**

In the `### comparePageDiff` section of `AGENTS.md`, append a sentence after the existing description paragraph:

```markdown
The response and the HTML report now lead with a **Blocks affected (ranked)** roll-up: failing regions are aggregated per block across all viewports and ranked by a coverage-first composite (share of the block's own area that differs, then how many viewports it breaks in, then total diff pixels), grouped Blocks → Landmarks → Sections. Use it to decide which block to fix first. It covers only blocks that appear in a failing region — it does not enumerate clean blocks or detect blocks that are missing entirely (that remains a judgment call from comparing the live and migrated pages).
```

- [ ] **Step 2: Update README.md**

In the page-diff tools table in `README.md`, update the `comparePageDiff` row's "What it does" cell to end with: `; leads with a ranked per-block impact roll-up (coverage-first) so you can see which block to fix first`.

- [ ] **Step 3: Verify the two docs read consistently**

Run: `git diff --stat AGENTS.md README.md`
Expected: both files show as modified; re-read both changed sections to confirm they describe the same behavior implemented in Tasks 2-4 (coverage-first ranking, Blocks→Landmarks→Sections, broken-only).

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md README.md
git commit -m "docs: describe per-block impact roll-up in AGENTS.md and README"
```

---

## Self-Review

**Spec coverage:**
- Pure aggregation module + severity metric + ranking → Task 1. ✓
- Single source of truth persisted in `run-summary.json` + optional schema field → Task 2. ✓
- HTML report "Block impact" panel → Task 3. ✓
- MCP text "Blocks affected" section + `localizePageDiff` inheritance → Task 4. ✓
- Kinds grouped Blocks→Landmarks→Sections; coverage clamp; zero-area guard; exclude ignored/unattributed → covered by Task 1 tests. ✓
- Compatibility (older runs parse, re-install note) → schema `.optional()` in Task 2; panel/section omitted when field absent (Task 3 + Task 4 negative tests). ✓
- Docs → Task 5. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code and exact commands.

**Type consistency:** `buildBlockSummary(viewports)` and the `BlockRollup` field names (`kind, name, selector, regionCount, totalDiffPx, coverage, viewportsAffected, severityScore, worstViewport, worstCrop`) are identical across Tasks 1-4 and the Zod schema in Task 2. `formatSummary` exported in Task 4 matches its test import.
