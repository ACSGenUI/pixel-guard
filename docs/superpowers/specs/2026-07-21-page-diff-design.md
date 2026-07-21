# page-diff: URL-pair visual diff + DOM localization

## Problem

pixel-guard currently compares block variations against committed baseline screenshots *within* one project (before/after a code change). There's no way to compare two arbitrary already-rendered pages — e.g. a live production page against its migrated/rebuilt AEM EDS counterpart — find where they visually differ, and localize those differences to the DOM elements responsible so an agent can fix them.

## Goals

- Given a mapping of `{liveUrl, migratedUrl}` pairs, screenshot both sides at multiple viewports and report where they visually differ.
- Localize each visual difference to the migrated page's DOM element(s) (selector, computed style, markup) — not just a diff image — so an LLM can reason about *why* it differs and how to fix it.
- Let users flag known/expected differences so they stop being reported as failures.
- Work both as pixel-guard MCP tools and as standalone scripts runnable without Mastra/MCP at all.

## Non-goals

- No automatic style-diffing or fix-suggestion algorithm. The tool surfaces structured facts (crops + migrated DOM context); interpreting them into a fix is left to the agent/LLM.
- No DOM capture on the live page — its structure isn't fixable code, so it's treated as a pixels-only reference.
- No automatic dev-server management for localhost migrated URLs — the tool assumes whatever URL it's given (localhost, stage, UAT, prod) is already reachable.

## Architecture

Feature name: **page-diff**. Core logic lives as standalone Node scripts under `aem-visual-checker/tools/page-diff/`, copied into the target project by the installer (mirroring how `tools/visual-tests/*.js` is installed today), runnable two ways:

- **Directly**, no Mastra/MCP involved: `node tools/page-diff/compare-page-diff.js --mapping urls.csv` and `node tools/page-diff/localize-page-diff.js --run <run-id>`, also wired to `npm run test:page-diff:compare` / `test:page-diff:localize`.
- **Via MCP**, as two new pixel-guard tools — `comparePageDiff` and `localizePageDiff` — whose Mastra workflows `execFile` these same scripts in the target project and format the output, the same relationship `generateVisualTests` (`src/tools/generate-visual-tests-tool.ts` / `src/workflows/generate-visual-tests.ts`) has to `npm run test:visual:generate`.

One set of logic, two entry points.

## Tool 1 — `comparePageDiff`

**Input:** `mappingFile` (path to CSV/JSON with `liveUrl`/`migratedUrl` columns or `{liveUrl, migratedUrl}[]`), `projectDir?`.

**Per pair, per viewport** (reusing the existing 4-viewport config already defined in `tools/visual-tests/config.js` — mobile/tablet/desktop/large):

1. Launch Chromium with the same launch args the existing Playwright config uses for pixel-stable captures (disabled font hinting/subpixel positioning, forced device-scale-factor 1). Navigate to `liveUrl` and `migratedUrl`, take `fullPage: true` screenshots of each.
2. Diff the overlapping region: `pixelmatch` over `min(liveHeight, migratedHeight)` rows at full width. If the two heights differ by more than a configurable tolerance (`config.js`, default 50px), record a `pageLengthMismatch: { liveHeight, migratedHeight, deltaPx }` finding alongside (not folded into) the pixel diff.
3. Cluster differing pixels into regions: grid-bucket the diff mask (e.g. 16×16px cells), flag cells over a per-cell diff-pixel-count threshold, merge adjacent/near flagged cells (union-find over the cell grid) into bounding boxes, and drop clusters below a minimum area (anti-aliasing noise). This favors speed/simplicity over perfect connected-component precision — reasonable at page scale where a region means "this whole hero moved," not a single stray pixel.
4. Apply ignore rules (see below) to mark some regions `"ignored"` instead of `"failed"`.
5. Crop `live.png`/`migrated.png`/`diff.png` to each region's bounding box + 24px padding, saved as `region-<n>-live.png` / `region-<n>-migrated.png` / `region-<n>-diff.png`.
6. Write all artifacts under `tools/page-diff/runs/<run-id>/<pair-slug>/<viewport>/`.
7. Generate one self-contained `report.html` for the whole run (mirroring the existing Playwright HTML report / `report-server.ts` pattern): every pair × viewport with pass/fail, and for each non-passing region, its three crops side by side (live | migrated | diff) plus bounding box, diff-pixel count, and — if ignored — the rule that suppressed it.

**Output (MCP + CLI):** per pair/viewport — pass/fail, region count (failed vs. ignored), artifact paths, and a "page-diff report: http://localhost:<port>/..." line surfacing the browsable report, the same way `runVisualTests` surfaces its Playwright report link.

## Tool 2 — `localizePageDiff`

**Input:** `runId` (an existing `comparePageDiff` run) or an inline `mappingFile` to re-run fresh; `projectDir?`.

**Per non-ignored failing region**, on the **migrated** page only, at that region's viewport:

1. Navigate to `migratedUrl`.
2. **Pass 1 (bulk, cheap):** `page.evaluate()` walks every element in the document collecting `{selector, boundingBox}` via `getBoundingClientRect()` only — no style computation.
3. Filter to elements whose bounding box intersects the region's bounding box (accounting for full-page scroll offset), sorted innermost-first (smallest area first).
4. **Pass 2 (targeted):** for just that filtered set, compute a curated style set — position, size, color, background, font, padding/margin, display, transform, opacity, z-index — via `getComputedStyle()`, plus `outerHTML` (truncated if large) and a stable CSS selector (nth-child path).
5. Attach as `region.elements = [{selector, boundingBox, computedStyle, outerHTML}, ...]`.

**Output:** extends each region in `regions.json` with its `elements` array, and folds the same data into `report.html` — each region's crops now sit alongside the migrated element's selector and key computed styles, turning "here's a blurry crop" into "here's `.hero > h1`; it's `padding-top: 0` where the live crop shows visible top padding."

## Ignore rules

`tools/page-diff/ignore.json`, checked into the target project:

```json
[
  { "pairSlug": "home", "selector": ".promo-banner" },
  { "pairSlug": "home", "viewport": "mobile", "region": { "x": 0, "y": 900, "width": 320, "height": 120 } },
  { "urlPattern": "*/blog/*", "selector": ".ad-slot" }
]
```

Each rule matches by `pairSlug` (exact) or `urlPattern` (glob against `liveUrl`), optionally scoped to one `viewport` (omitted = all viewports), and targets either a `selector` or an explicit `region`.

In `comparePageDiff`, after clustering regions for a pair/viewport:

1. Load `ignore.json` if present (missing file = no rules, not an error); filter to rules matching this pair and viewport.
2. `region` rules: direct bounding-box overlap check against each diff region.
3. `selector` rules: run a cheap `document.querySelectorAll(selector)` on the **migrated** page (bounding boxes only, not the full Tool 2 element walk) to get the ignored element(s)' boxes, then overlap-check the same way.
4. A region is ignored if it overlaps a matching rule's box by ≥50% of the region's own area (guards against an unrelated adjacent diff being swept in just for touching an edge).
5. Ignored regions get `status: "ignored"` in `regions.json` and appear in `report.html` greyed out with the matching rule shown — visible, but excluded from pass/fail. A pair/viewport passes if every region is either absent or `"ignored"`.

## File layout

```
tools/page-diff/
  compare-page-diff.js
  localize-page-diff.js
  config.js              # viewports, crop padding, clustering/overlap thresholds (mirrors visual-tests/config.js)
  ignore.json            # checked in, user-maintained
  runs/
    <run-id>/
      report.html
      <pair-slug>/
        <viewport>/
          live.png  migrated.png  diff.png
          regions.json
          region-<n>-live.png  region-<n>-migrated.png  region-<n>-diff.png
```

## Error handling

- Unreachable/erroring URL (network failure, non-2xx, timeout): recorded as a pair-level error, distinct from a visual-diff failure, surfaced separately in both the report and MCP output.
- Malformed mapping file / missing required columns: fail fast before launching any browser, with a message identifying the bad row.
- Missing `ignore.json`: treated as "no ignore rules," not an error.

## Testing plan

- Unit tests (Vitest, matching the existing `*.test.ts` convention) for: region-clustering (grid-bucket → bounding boxes) against synthetic diff masks, ignore-rule matching (selector/region rules, overlap-ratio threshold, viewport scoping), and mapping-file parsing (CSV/JSON, malformed rows).
- No new Playwright-in-Docker test beyond what exists — the scripts drive Playwright directly; correctness is exercised via unit tests on the pure logic plus manual runs against real URLs during implementation.

## Open questions for implementation

None — all decisions above were confirmed during design.
