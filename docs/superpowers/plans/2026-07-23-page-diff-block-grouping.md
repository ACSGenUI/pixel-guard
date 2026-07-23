# page-diff Block-Grouping + Report Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attribute every `comparePageDiff` diff region to the migrated page's enclosing EDS component (block → section → landmark → Unattributed), group the tool output and HTML report by component so one component's change reads as one grouped finding, and redesign the HTML report around that grouped view.

**Architecture:** Purely additive on top of the existing page-diff feature. A new pure function `assignRegionToBlock` plus a browser helper `collectBlockBoxes` (both in `lib/dom-capture.js`) tag each clustered region with a `block` field during `compare-page-diff.js` (while the migrated page is already open). The Zod `runSummarySchema` gains a nullable `block` field; `report-html.js` and the MCP tool formatters group regions by that field. No change to diffing, clustering, cropping, or ignore-rule handling.

**Tech Stack:** Node.js (`node:test`, `node:assert/strict`), plain ESM JS under `aem-visual-checker/tools/page-diff/`, `playwright` (target-project dep only), Zod v4, TypeScript (pixel-guard `src/`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-page-diff-block-grouping-design.md` — read it before starting.
- Attribution uses the **migrated** page DOM only, never the live page.
- Core logic stays plain ESM JavaScript under `aem-visual-checker/tools/page-diff/`, runnable with a bare `node` invocation — no TypeScript, no build step, no dependency on pixel-guard's `src/`, and no import from outside `tools/page-diff/` (the config.js standalone rule).
- No new npm dependencies. The HTML report stays a single self-contained file: inline `<style>`, no external assets; minimal inline vanilla JS is acceptable, no frameworks.
- Purely additive: do not change the diff algorithm, clustering, cropping, viewport set, or ignore-rule matching.
- Grouping is orthogonal to status: a component group is `failed` if any region is `failed`, `ignored` if all its regions are `ignored`. Ignored regions still render (greyed) and stay excluded from pass/fail.
- "Unattributed" (regions with no enclosing migrated container) always sorts **last**.
- Report is light-mode only; keep it accessible (semantic headings, sufficient contrast) and keep all user-derived values HTML-escaped.
- Follow existing test conventions: `node:test` + `node:assert/strict`, one `*.test.js`/`*.test.ts` per module, run via the root `npm test`.

---

## Task 1: Region-to-block attribution logic

**Files:**
- Modify: `aem-visual-checker/tools/page-diff/lib/dom-capture.js`
- Test: `aem-visual-checker/tools/page-diff/lib/dom-capture.test.js`

**Interfaces:**
- Consumes: `overlapArea(a, b)` (already exported from `dom-capture.js`).
- Produces:
  - `assignRegionToBlock(region: {x,y,width,height}, blockBoxes: Array<{name,selector,kind,boundingBox}>): {name,selector,kind,boundingBox} | null` — pure, unit-tested. Used by Task 2.
  - `collectBlockBoxes(page): Promise<Array<{name,selector,kind:'block'|'section'|'landmark',boundingBox:{x,y,width,height}}>>` — browser-dependent, NOT unit-tested (manual verification), like the sibling `collectAllBoundingBoxes`. Used by Task 2.

- [ ] **Step 1: Write the failing tests**

Append to `aem-visual-checker/tools/page-diff/lib/dom-capture.test.js`:

```javascript
import { assignRegionToBlock } from './dom-capture.js';

test('assignRegionToBlock returns the smallest box whose bounds contain the region center', () => {
  const section = { name: 'section', selector: 'main > div:nth-of-type(2)', kind: 'section', boundingBox: { x: 0, y: 0, width: 1000, height: 1000 } };
  const block = { name: 'columns', selector: 'main > div:nth-of-type(2) > div', kind: 'block', boundingBox: { x: 100, y: 100, width: 200, height: 100 } };

  const region = { x: 150, y: 130, width: 20, height: 20 };

  const result = assignRegionToBlock(region, [section, block]);

  assert.equal(result.name, 'columns');
  assert.equal(result.kind, 'block');
});

test('assignRegionToBlock breaks a same-area tie by greatest overlap with the region', () => {
  const a = { name: 'a', selector: '.a', kind: 'block', boundingBox: { x: 0, y: 0, width: 100, height: 100 } };
  const b = { name: 'b', selector: '.b', kind: 'block', boundingBox: { x: 40, y: 0, width: 100, height: 100 } };

  // region center (60,50) is inside both; overlaps b more than a.
  const region = { x: 50, y: 40, width: 20, height: 20 };

  const result = assignRegionToBlock(region, [a, b]);

  assert.equal(result.name, 'b');
});

test('assignRegionToBlock returns null when no box contains the region center', () => {
  const block = { name: 'columns', selector: '.columns', kind: 'block', boundingBox: { x: 0, y: 0, width: 50, height: 50 } };

  const region = { x: 500, y: 500, width: 10, height: 10 };

  assert.equal(assignRegionToBlock(region, [block]), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test 'aem-visual-checker/tools/page-diff/lib/dom-capture.test.js'`
Expected: FAIL — `assignRegionToBlock is not a function` (or import error).

- [ ] **Step 3: Implement `assignRegionToBlock` and `collectBlockBoxes`**

Append to `aem-visual-checker/tools/page-diff/lib/dom-capture.js` (after the existing `filterOverlappingElements`, before `CURATED_STYLE_PROPERTIES` is fine; keep `overlapArea` above):

```javascript
function regionCenterInBox(region, box) {
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  return cx >= box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height;
}

// Attributes a diff region to the smallest migrated-page component box whose bounds contain the
// region's center (blocks nest inside sections, so "smallest containing" yields the most specific
// block over its section). Same-area ties broken by greatest overlap with the region. Returns null
// when no box contains the center (region collects in the "Unattributed" group).
export function assignRegionToBlock(region, blockBoxes) {
  const containing = blockBoxes.filter((candidate) => regionCenterInBox(region, candidate.boundingBox));
  if (containing.length === 0) return null;
  return containing.reduce((best, candidate) => {
    const candidateArea = candidate.boundingBox.width * candidate.boundingBox.height;
    const bestArea = best.boundingBox.width * best.boundingBox.height;
    if (candidateArea < bestArea) return candidate;
    if (candidateArea === bestArea
      && overlapArea(region, candidate.boundingBox) > overlapArea(region, best.boundingBox)) {
      return candidate;
    }
    return best;
  });
}
```

Also append the browser helper (near the other `page.evaluate` helpers at the bottom of the file). The `cssPath` walker is inlined because `page.evaluate` serializes the function to run in the browser and cannot reference module-scope helpers:

```javascript
// Browser-dependent: collects bounding boxes of the migrated page's EDS components -- blocks
// (main .block), section wrappers (main > div.section), and landmarks (header/footer/nav) -- using
// the same full-page scroll-offset convention as collectAllBoundingBoxes. Not unit-tested (no
// headless browser here); verified manually against a real EDS page.
export async function collectBlockBoxes(page) {
  return page.evaluate(() => {
    function cssPath(el) {
      const parts = [];
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
        let selector = node.tagName.toLowerCase();
        if (node.id) {
          selector += `#${node.id}`;
          parts.unshift(selector);
          break;
        }
        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === node.tagName);
          if (siblings.length > 1) {
            selector += `:nth-of-type(${siblings.indexOf(node) + 1})`;
          }
        }
        parts.unshift(selector);
        node = parent;
      }
      return parts.join(' > ');
    }

    function boxOf(el) {
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      };
    }

    const results = [];
    document.querySelectorAll('main .block').forEach((el) => {
      const name = el.dataset.blockName
        || Array.from(el.classList).find((cls) => cls !== 'block')
        || el.tagName.toLowerCase();
      results.push({ name, selector: cssPath(el), kind: 'block', boundingBox: boxOf(el) });
    });
    document.querySelectorAll('main > div.section').forEach((el) => {
      results.push({ name: 'section', selector: cssPath(el), kind: 'section', boundingBox: boxOf(el) });
    });
    document.querySelectorAll('header, footer, nav').forEach((el) => {
      results.push({ name: el.tagName.toLowerCase(), selector: cssPath(el), kind: 'landmark', boundingBox: boxOf(el) });
    });
    return results;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the 3 new `assignRegionToBlock` tests plus all existing tests green.

- [ ] **Step 5: Syntax-check the module (it will be imported by a playwright-using script)**

Run: `node --check aem-visual-checker/tools/page-diff/lib/dom-capture.js`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add aem-visual-checker/tools/page-diff/lib/dom-capture.js aem-visual-checker/tools/page-diff/lib/dom-capture.test.js
git commit -m "feat: add page-diff region-to-block attribution logic"
```

---

## Task 2: Tag each region with its owning block in compare-page-diff.js

**Files:**
- Modify: `aem-visual-checker/tools/page-diff/compare-page-diff.js`

**Interfaces:**
- Consumes: `collectBlockBoxes(page)` and `assignRegionToBlock(region, blockBoxes)` from Task 1.
- Produces: each region object written to `regions.json` / the run summary gains `block: {name,selector,kind,boundingBox} | null`. Consumed by Tasks 3, 4, 5.
- No automated test — integration script driving a real browser; verified by `node --check` + full suite + Task 6 manual run.

- [ ] **Step 1: Add the import**

In `aem-visual-checker/tools/page-diff/compare-page-diff.js`, change the ignore-rules/crop import block to also import the two new dom-capture functions. After the existing `import { cropPng } from './lib/crop-images.js';` line, add:

```javascript
import { collectBlockBoxes, assignRegionToBlock } from './lib/dom-capture.js';
```

- [ ] **Step 2: Collect block boxes once per pair/viewport**

In `runCompare`, right after the line `const ignoredBoxes = await resolveIgnoreBoxes(migratedPage, applicableRules);`, add:

```javascript
          const blockBoxes = await collectBlockBoxes(migratedPage);
```

- [ ] **Step 3: Attach the block to each region in the crop loop**

In the `for (let index = 0; ...)` loop that builds `regionsWithCrops`, add a `block` field to the pushed object. Change the `regionsWithCrops.push({ ... })` call so its object includes, right after `matchedRule: region.matchedRule,`:

```javascript
              block: assignRegionToBlock(region, blockBoxes),
```

(The pushed object's fields become: `index, x, y, width, height, diffPixelCount, status, matchedRule, block, elements, crops`.)

- [ ] **Step 4: Syntax-check**

Run: `node --check aem-visual-checker/tools/page-diff/compare-page-diff.js`
Expected: no output (clean).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS — all existing tests still green (this task adds no automated test).

- [ ] **Step 6: Commit**

```bash
git add aem-visual-checker/tools/page-diff/compare-page-diff.js
git commit -m "feat: tag page-diff regions with their owning migrated block"
```

---

## Task 3: Add the `block` field to the Zod run-summary schema

**Files:**
- Modify: `src/workflows/compare-page-diff.ts`

**Interfaces:**
- Consumes: the `block` field shape produced by Task 2.
- Produces: `runSummarySchema` (and its inferred `RunSummary` type) now carries `region.block`. Consumed by Task 5's tool formatters.

- [ ] **Step 1: Add the block schema and field**

In `src/workflows/compare-page-diff.ts`, immediately before `const regionSchema = z.object({`, add:

```typescript
const blockSchema = z.object({
  name: z.string(),
  selector: z.string(),
  kind: z.enum(['block', 'section', 'landmark']),
  boundingBox: z.object({
    x: z.number(), y: z.number(), width: z.number(), height: z.number(),
  }),
});
```

Then, inside `regionSchema`, add this line immediately after `matchedRule: z.record(z.string(), z.unknown()).nullable(),`:

```typescript
  block: blockSchema.nullable().optional(),
```

(`.nullable()` accepts the explicit `null` compare writes; `.optional()` tolerates older `regions.json` produced before this change.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/workflows/compare-page-diff.ts
git commit -m "feat: add nullable block field to page-diff run-summary schema"
```

---

## Task 4: Redesign report-html.js around block groups

**Files:**
- Modify: `aem-visual-checker/tools/page-diff/lib/report-html.js`
- Test: `aem-visual-checker/tools/page-diff/lib/report-html.test.js`

**Interfaces:**
- Consumes: `RunSummary` with `region.block` (Task 2 shape).
- Produces: `generateReportHtml(runSummary): string` — signature unchanged, output now grouped by component with a redesigned layout.

- [ ] **Step 1: Replace the test file with grouped-structure tests**

Overwrite `aem-visual-checker/tools/page-diff/lib/report-html.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReportHtml } from './report-html.js';

const RUN_SUMMARY = {
  runId: '2026-07-23T10-00-00-000Z',
  createdAt: '2026-07-23T10:00:00.000Z',
  pairs: [{
    pairSlug: 'home',
    liveUrl: 'https://live.example.com/',
    migratedUrl: 'https://migrated.example.com/',
    viewports: [{
      viewportLabel: 'Desktop',
      status: 'fail',
      errorMessage: null,
      pageLengthMismatch: null,
      regions: [
        {
          index: 0, x: 10, y: 10, width: 100, height: 50, diffPixelCount: 500,
          status: 'failed', matchedRule: null, elements: null,
          block: { name: 'hero', selector: 'main > div:nth-of-type(1) > div', kind: 'block', boundingBox: { x: 0, y: 0, width: 1200, height: 400 } },
          crops: { live: 'home/desktop/region-0-live.png', migrated: 'home/desktop/region-0-migrated.png', diff: 'home/desktop/region-0-diff.png' },
        },
        {
          index: 1, x: 20, y: 20, width: 30, height: 30, diffPixelCount: 120,
          status: 'failed', matchedRule: null, elements: null,
          block: { name: 'hero', selector: 'main > div:nth-of-type(1) > div', kind: 'block', boundingBox: { x: 0, y: 0, width: 1200, height: 400 } },
          crops: { live: 'home/desktop/region-1-live.png', migrated: 'home/desktop/region-1-migrated.png', diff: 'home/desktop/region-1-diff.png' },
        },
        {
          index: 2, x: 500, y: 900, width: 40, height: 40, diffPixelCount: 200,
          status: 'ignored', matchedRule: { selector: '.promo' }, elements: null,
          block: { name: 'columns', selector: 'main > div:nth-of-type(2) > div', kind: 'block', boundingBox: { x: 0, y: 800, width: 1200, height: 300 } },
          crops: { live: 'home/desktop/region-2-live.png', migrated: 'home/desktop/region-2-migrated.png', diff: 'home/desktop/region-2-diff.png' },
        },
        {
          index: 3, x: 700, y: 1500, width: 25, height: 25, diffPixelCount: 90,
          status: 'failed', matchedRule: null, elements: null,
          block: null,
          crops: { live: 'home/desktop/region-3-live.png', migrated: 'home/desktop/region-3-migrated.png', diff: 'home/desktop/region-3-diff.png' },
        },
      ],
    }],
  }],
};

test('generateReportHtml groups regions by their owning block and shows both crops of the hero group', () => {
  const html = generateReportHtml(RUN_SUMMARY);

  // Block group headers.
  assert.match(html, /hero/);
  assert.match(html, /columns/);
  // Both hero regions' crops appear under the one hero group.
  assert.match(html, /home\/desktop\/region-0-diff\.png/);
  assert.match(html, /home\/desktop\/region-1-diff\.png/);
  // The two hero regions are grouped: "hero" text appears once as a group header, not once per region.
  const heroHeaderMatches = html.match(/data-group-name="hero"/g) ?? [];
  assert.equal(heroHeaderMatches.length, 1);
});

test('generateReportHtml renders an ignored-only group as ignored and an Unattributed group for block-less regions', () => {
  const html = generateReportHtml(RUN_SUMMARY);

  // columns group has only an ignored region -> group marked ignored.
  assert.match(html, /class="group[^"]*\bignored\b[^"]*"[^>]*data-group-name="columns"/);
  // Region 3 has no block -> Unattributed group present.
  assert.match(html, /Unattributed/);
  assert.match(html, /home\/desktop\/region-3-diff\.png/);
});

test('generateReportHtml escapes HTML-sensitive characters in URLs', () => {
  const withHtmlChars = {
    ...RUN_SUMMARY,
    pairs: [{ ...RUN_SUMMARY.pairs[0], liveUrl: 'https://live.example.com/?a=1&b=<2>' }],
  };

  const html = generateReportHtml(withHtmlChars);

  assert.doesNotMatch(html, /b=<2>/);
  assert.match(html, /b=&lt;2&gt;/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test 'aem-visual-checker/tools/page-diff/lib/report-html.test.js'`
Expected: FAIL — current `report-html.js` does not group by block, has no `data-group-name` attribute, and renders no "Unattributed" group.

- [ ] **Step 3: Rewrite `report-html.js`**

Overwrite `aem-visual-checker/tools/page-diff/lib/report-html.js`:

```javascript
const ESCAPE_MAP = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);
}

// Groups a viewport's regions by owning block (keyed on kind:selector); block-less regions
// collect under a single "Unattributed" group that always sorts last.
function groupRegionsByBlock(regions) {
  const groups = new Map();
  regions.forEach((region) => {
    const block = region.block ?? null;
    const key = block ? `${block.kind}:${block.selector}` : '__unattributed__';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: block ? block.name : 'Unattributed',
        kind: block ? block.kind : 'unattributed',
        regions: [],
      });
    }
    groups.get(key).regions.push(region);
  });
  return [...groups.values()].sort((a, b) => {
    if (a.kind === 'unattributed') return 1;
    if (b.kind === 'unattributed') return -1;
    return 0;
  });
}

function groupStatus(group) {
  return group.regions.some((region) => region.status === 'failed') ? 'failed' : 'ignored';
}

function renderRegion(region) {
  const statusLabel = region.status === 'ignored'
    ? `Ignored — ${escapeHtml(JSON.stringify(region.matchedRule))}`
    : 'Failed';
  const elementsHtml = (region.elements ?? [])
    .map((el) => `<li><code>${escapeHtml(el.selector)}</code><span class="styles">${escapeHtml(JSON.stringify(el.computedStyle))}</span></li>`)
    .join('');

  return `
      <div class="region ${escapeHtml(region.status)}">
        <div class="region-head">
          <span class="region-title">Region ${region.index}</span>
          <span class="chip ${escapeHtml(region.status)}">${statusLabel}</span>
          <span class="meta">${region.diffPixelCount} px · (${region.x},${region.y}) ${region.width}×${region.height}</span>
        </div>
        <div class="crops">
          <figure><img loading="lazy" src="${escapeHtml(region.crops.live)}" alt="live"><figcaption>Live</figcaption></figure>
          <figure><img loading="lazy" src="${escapeHtml(region.crops.migrated)}" alt="migrated"><figcaption>Migrated</figcaption></figure>
          <figure><img loading="lazy" src="${escapeHtml(region.crops.diff)}" alt="diff"><figcaption>Diff</figcaption></figure>
        </div>
        ${elementsHtml ? `<ul class="elements">${elementsHtml}</ul>` : ''}
      </div>`;
}

function renderGroup(group) {
  const status = groupStatus(group);
  const totalPx = group.regions.reduce((sum, region) => sum + region.diffPixelCount, 0);
  const kindLabel = group.kind === 'unattributed' ? '' : `<span class="kind">${escapeHtml(group.kind)}</span>`;
  return `
    <details class="group ${status}" data-group-name="${escapeHtml(group.name)}" open>
      <summary>
        <span class="group-name">${escapeHtml(group.name)}</span>
        ${kindLabel}
        <span class="chip ${status}">${status === 'failed' ? 'Failed' : 'Ignored'}</span>
        <span class="meta">${group.regions.length} region${group.regions.length === 1 ? '' : 's'} · ${totalPx} px</span>
      </summary>
      ${group.regions.map(renderRegion).join('')}
    </details>`;
}

function renderViewport(viewport) {
  const chip = `<span class="chip ${escapeHtml(viewport.status)}">${escapeHtml(viewport.status.toUpperCase())}</span>`;
  const mismatch = viewport.pageLengthMismatch
    ? `<p class="banner mismatch">Page length mismatch: live ${viewport.pageLengthMismatch.liveHeight}px vs migrated ${viewport.pageLengthMismatch.migratedHeight}px (Δ${viewport.pageLengthMismatch.deltaPx}px)</p>`
    : '';
  const error = viewport.errorMessage ? `<p class="banner error">${escapeHtml(viewport.errorMessage)}</p>` : '';
  const groups = viewport.regions.length > 0
    ? groupRegionsByBlock(viewport.regions).map(renderGroup).join('')
    : '<p class="empty">No differing regions.</p>';
  return `
    <section class="viewport">
      <h3>${escapeHtml(viewport.viewportLabel)} ${chip}</h3>
      ${error}
      ${mismatch}
      ${groups}
    </section>`;
}

function renderPair(pair) {
  return `
  <article class="pair">
    <h2>${escapeHtml(pair.pairSlug)}</h2>
    <p class="urls">${escapeHtml(pair.liveUrl)} <span class="arrow">→</span> ${escapeHtml(pair.migratedUrl)}</p>
    ${pair.viewports.map(renderViewport).join('')}
  </article>`;
}

function countGroups(runSummary) {
  let failed = 0;
  let ignored = 0;
  runSummary.pairs.forEach((pair) => pair.viewports.forEach((viewport) => {
    if (viewport.regions.length === 0) return;
    groupRegionsByBlock(viewport.regions).forEach((group) => {
      if (groupStatus(group) === 'failed') failed += 1;
      else ignored += 1;
    });
  }));
  return { failed, ignored };
}

const STYLES = `
    :root {
      --bg: #f7f8fa; --card: #fff; --ink: #1a1a1a; --muted: #666; --line: #e2e5ea;
      --pass: #2e7d32; --fail: #d32f2f; --ignored: #9aa0a6; --error: #b26a00; --accent: #1a73e8;
    }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; background: var(--bg); color: var(--ink); line-height: 1.5; }
    header.run { padding: 1.5rem 2rem; background: var(--card); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5; }
    header.run h1 { margin: 0 0 .25rem; font-size: 1.25rem; }
    header.run .sub { color: var(--muted); font-size: .85rem; }
    header.run .totals { margin-top: .5rem; display: flex; gap: .75rem; }
    main { padding: 1.5rem 2rem; max-width: 1100px; }
    .pair { margin-bottom: 2rem; }
    .pair h2 { font-size: 1.05rem; margin: 0 0 .25rem; }
    .urls { color: var(--muted); font-size: .85rem; margin: 0 0 1rem; word-break: break-all; }
    .urls .arrow { color: var(--accent); }
    .viewport { margin-bottom: 1.25rem; }
    .viewport h3 { font-size: .95rem; margin: 0 0 .5rem; display: flex; align-items: center; gap: .5rem; }
    .banner { padding: .5rem .75rem; border-radius: 6px; font-size: .85rem; }
    .banner.error { background: #fff3e0; color: var(--error); }
    .banner.mismatch { background: #fdecea; color: var(--fail); }
    .empty { color: var(--muted); font-size: .85rem; }
    .group { background: var(--card); border: 1px solid var(--line); border-radius: 8px; margin-bottom: .75rem; overflow: hidden; }
    .group.ignored { opacity: .6; }
    .group > summary { cursor: pointer; padding: .6rem .9rem; display: flex; align-items: center; gap: .6rem; font-weight: 600; list-style: none; }
    .group > summary::-webkit-details-marker { display: none; }
    .group-name { font-size: .95rem; }
    .kind { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 .35rem; }
    .meta { color: var(--muted); font-weight: 400; font-size: .8rem; margin-left: auto; }
    .chip { font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; padding: .1rem .45rem; border-radius: 999px; color: #fff; }
    .chip.pass { background: var(--pass); } .chip.fail, .chip.failed, .chip.error { background: var(--fail); } .chip.ignored { background: var(--ignored); }
    .region { border-top: 1px solid var(--line); padding: .75rem .9rem; }
    .region-head { display: flex; align-items: center; gap: .5rem; margin-bottom: .5rem; font-size: .85rem; }
    .region-title { font-weight: 600; }
    .crops { display: flex; gap: .75rem; flex-wrap: wrap; }
    .crops figure { margin: 0; font-size: .7rem; color: var(--muted); text-align: center; }
    .crops img { display: block; max-width: 260px; max-height: 320px; border: 1px solid var(--line); border-radius: 4px; background: #fff; }
    .elements { margin: .6rem 0 0; padding-left: 1.1rem; font-size: .8rem; }
    .elements code { background: #f1f3f4; padding: 1px 4px; border-radius: 3px; }
    .elements .styles { color: var(--muted); margin-left: .4rem; }`;

export function generateReportHtml(runSummary) {
  const { failed, ignored } = countGroups(runSummary);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>page-diff report — ${escapeHtml(runSummary.runId)}</title>
  <style>${STYLES}
  </style>
</head>
<body>
  <header class="run">
    <h1>page-diff report</h1>
    <div class="sub">Run ${escapeHtml(runSummary.runId)} · generated ${escapeHtml(runSummary.createdAt)}</div>
    <div class="totals">
      <span class="chip failed">${failed} failed group${failed === 1 ? '' : 's'}</span>
      <span class="chip ignored">${ignored} ignored group${ignored === 1 ? '' : 's'}</span>
    </div>
  </header>
  <main>
    ${runSummary.pairs.map(renderPair).join('')}
  </main>
</body>
</html>`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the 3 rewritten report-html tests plus all existing tests green.

- [ ] **Step 5: Commit**

```bash
git add aem-visual-checker/tools/page-diff/lib/report-html.js aem-visual-checker/tools/page-diff/lib/report-html.test.js
git commit -m "feat: group page-diff report regions by block and redesign the report"
```

---

## Task 5: Group the MCP tool text output by block

**Files:**
- Modify: `src/tools/compare-page-diff-tool.ts`
- Modify: `src/tools/localize-page-diff-tool.ts`

**Interfaces:**
- Consumes: `RunSummary` with `region.block` (Task 3 schema).
- Produces: `comparePageDiff` / `localizePageDiff` text responses lead with per-block group lines. No signature change.

- [ ] **Step 1: Rewrite `formatSummary` in `compare-page-diff-tool.ts` to group by block**

In `src/tools/compare-page-diff-tool.ts`, replace the entire `formatSummary` function with:

```typescript
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

  return lines.join('\n');
}
```

(The `type RunSummary = ...` line already exists at the top of the file — replace it with the two `type` lines shown, then the two helper functions, then `formatSummary`. Do not leave a duplicate `type RunSummary`.)

- [ ] **Step 2: Add the block label to each region line in `localize-page-diff-tool.ts`**

In `src/tools/localize-page-diff-tool.ts`, in its `formatSummary`, change the per-region header line so it names the owning block. Find the line that pushes `  Region ${region.index} (${region.diffPixelCount}px):` and replace it with:

```typescript
        const owner = region.block ? (region.block.kind === 'block' ? `Block "${region.block.name}"` : `${region.block.kind} "${region.block.name}"`) : 'Unattributed';
        lines.push(`  ${owner} — Region ${region.index} (${region.diffPixelCount}px):`);
```

(If the surrounding code uses a `for...of` over `failedRegions`, keep that loop; only the two lines that compute `owner` and push the header change. The existing element-detail lines below it stay as-is.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/compare-page-diff-tool.ts src/tools/localize-page-diff-tool.ts
git commit -m "feat: group page-diff MCP tool output by block"
```

---

## Task 6: End-to-end manual verification

No new files — a manual pass in a real target project, since the browser-driving pieces (`collectBlockBoxes`) have no automated test per the spec.

- [ ] **Step 1: Full suite + type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all unit tests pass (including Task 1's `assignRegionToBlock` and Task 4's grouped report tests), no type errors.

- [ ] **Step 2: Re-copy page-diff into a target project and run a comparison that produces a layout shift**

In an AEM EDS target project that has `installPageDiff` run (re-run it so the updated `tools/page-diff/` files land; then `npx playwright install chromium` if not already present), create a migrated build where one component has an added `margin-top` (or otherwise shifts content), and a mapping file pairing it against the pre-change build. Run:

`node tools/page-diff/compare-page-diff.js --mapping urls.json`

Confirm:
- The MCP/CLI-adjacent output (via `comparePageDiff` tool, or by reading `run-summary.json`) shows failed regions grouped under block names (e.g. `Block "columns" — N region(s)`), with an "Unattributed" group only if some region fell outside every block.
- Open the report `index.html`: regions are grouped into per-component cards, crops render inside each group, ignored groups are greyed, and the run header shows the failed/ignored group counts.

- [ ] **Step 3: Confirm attribution correctness on a known change**

For the component you changed, confirm at least one failed region is attributed to that component's block (not "Unattributed"), and that regions inside a different block are grouped under that other block.

- [ ] **Step 4: Final commit (only if Steps 1-3 surfaced fixes)**

If manual verification surfaced bugs, fix them, re-run `npm test && npx tsc --noEmit`, then:

```bash
git add -A
git commit -m "fix: address issues found during block-grouping manual verification"
```

If no fixes were needed, skip this step.
