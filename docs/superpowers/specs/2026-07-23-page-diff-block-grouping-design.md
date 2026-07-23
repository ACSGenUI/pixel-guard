# page-diff: block-grouped diff regions + report redesign

## Problem

`comparePageDiff` clusters raw pixel differences into regions. Because pixel diffing is layout-sensitive, a single logical change that shifts layout — e.g. adding `margin-top: 10px` to one component — moves that component and everything below it down, so the pixel comparison flags differences across a large band of the page. The clusterer then shatters that band into many independent regions (a real report showed ~10 regions from one margin change), and there is no signal tying them back to the components responsible. Reviewing region-by-region, and localizing each region, is far more work than the one underlying change warrants.

This design adds a **block-attribution pass** that maps each diff region to the migrated page's EDS block/section it belongs to, and groups the output **by component** so one component's worth of change reads as one grouped finding. It also **redesigns the HTML report** to present that grouped view clearly.

It is purely additive: diffing, clustering, cropping, and ignore-rule handling are unchanged. It adds an attribution pass and a grouped presentation on top.

## Goals

- Attribute every diff region to the migrated page's enclosing component (EDS block, else section, else landmark), so findings can be grouped by component.
- Group `comparePageDiff` output — both the MCP text response and the HTML report — by component, with per-region crops preserved as drill-down detail.
- Work in the "mix of both" pairing cases: attribution uses the **migrated** DOM only (never the live page), so it is unaffected by whether the live side is EDS or a legacy page.
- Redesign the HTML report to be clean, scannable, and organized around the grouped-by-component structure.

## Non-goals

- **No shift/translation detection.** This design does not try to recognize that content below a change "merely moved by Δpx." Blocks that genuinely shifted will still appear as findings; they are simply grouped by component rather than scattered as loose regions. (Shift-collapse is a possible future follow-up, explicitly out of scope here.)
- No change to the diff algorithm, clustering, cropping, viewport set, or ignore-rule matching.
- No DOM capture on the live page (unchanged from the base design — the live side stays pixels-only).
- No new external dependencies; the HTML report stays a single self-contained file (inline CSS, no external assets) so `serveReport` can serve it offline.

## Component definition (migrated page only)

For a diff region, the owning component is the smallest enclosing container, resolved in this precedence:

1. **EDS block** — an element matched by `main .block` (EDS decorates blocks with `class="<name> block"`, `data-block-name`, `data-block-status`). Name taken from `dataset.blockName`, falling back to the first non-`block` class.
2. **Section** — the enclosing `main > div.section` (EDS section wrapper). This is the granularity for **default content** (loose text/images not inside a block) — per decision, default content is attributed at section level, not per paragraph.
3. **Landmark** — `header`, `footer`, or `nav` when the region is outside `main`.
4. **`null`** — no enclosing container found (e.g. a diff in whitespace, or live-only content with no migrated counterpart). These collect in an "Unattributed" group.

When the same block type repeats on a page (e.g. three `columns` blocks), each occurrence is distinguished by an occurrence index and a stable CSS selector (nth-of-type path, reusing the `cssPath` approach already in `collectAllBoundingBoxes`).

## Capture & attribution

Both steps run in the plain-JS scripts under `tools/page-diff/` (migrated-only, always available regardless of installer):

- **`collectBlockBoxes(page)`** — new browser-dependent helper in `lib/dom-capture.js`. Returns `[{ name, selector, kind, boundingBox: {x,y,width,height} }]` for every block, section, and landmark on the migrated page, using the full-page scroll-offset convention already used by `collectAllBoundingBoxes` (`x: rect.left + window.scrollX`, etc.). Browser-dependent → verified manually, like the sibling browser helpers (not unit-tested).
- **`assignRegionToBlock(region, blockBoxes)`** — new **pure** function in `lib/dom-capture.js` (or a small sibling module). Chooses the component box whose bounds contain the region's center; ties broken by greatest overlap area; returns `null` when no box contains the center. Pure and synthetic-input testable → unit-tested.
- In `compare-page-diff.js`: while the migrated page is already open (it is opened today for ignore-rule box resolution), call `collectBlockBoxes` once per pair/viewport, then set `region.block = { name, selector, kind, boundingBox } | null` on each clustered region via `assignRegionToBlock`, before writing `regions.json` / the run summary.

## Data model

`region` gains one nullable field, `block`:

```
block: { name: string, selector: string, kind: 'block'|'section'|'landmark', boundingBox: {x,y,width,height} } | null
```

`runSummarySchema` (the Zod schema in `src/workflows/compare-page-diff.ts`, shared with `localizePageDiff`) adds this field as an optional/nullable object. `report-html.js` and both MCP tool formatters read it. All other fields are unchanged.

## Output

Grouping is orthogonal to pass/fail and ignore status: a component group is **failed** if any of its regions is `failed`, **ignored** if all its regions are `ignored`; ignored regions still show, greyed, and are excluded from pass/fail exactly as today.

- **MCP text (`comparePageDiff`)** — under each pair/viewport, lead with one line per component group:
  `Block "columns" (section 2) — 3 regions, 4,200 px — FAILED`, with the existing per-region coord/crop lines nested beneath. The "Unattributed" group, if any, lists last.
- **`localizePageDiff`** — mechanism unchanged (still walks elements within failing regions); its per-region element detail naturally nests under the same component groups in the report.

## Report redesign

The current `report-html.js` output is a bare inline-styled dump. Redesign goals (still one self-contained HTML file, inline `<style>`, no external assets, no JS frameworks — minimal vanilla JS for collapse is acceptable):

- **Run header** with run id, timestamp, and an at-a-glance summary (pairs, viewports, total failed vs. ignored component groups).
- **Per pair → per viewport** structure with clear status chips (pass/fail/error) and any page-length-mismatch banner.
- **Component groups** as the primary unit within a viewport: a card/section per component showing name, kind, occurrence, aggregate diff-pixel count, and pass/fail/ignored state. Ignored groups visually de-emphasized (greyed).
- **Per-region drill-down** nested inside each group: the existing live / migrated / diff crops shown side by side, with coordinates and diff-pixel count; when localized, the migrated element selector + curated computed styles shown alongside.
- Visual quality: readable type scale, consistent spacing, a restrained status color system (pass/fail/ignored/error), responsive crop layout. Light-mode is sufficient; keep it accessible (sufficient contrast, semantic headings). All user-derived values remain HTML-escaped (preserve the existing `escapeHtml` discipline; extend escaping to any newly interpolated values, closing the earlier "status in class attribute" gap).

## Testing plan

- Unit tests (`node:test` + `node:assert/strict`, one `*.test.js` per module) for `assignRegionToBlock`: region-center-inside-box, overlap tiebreak between two candidates, and the `null` fallback when no box contains the center.
- `collectBlockBoxes` is browser-dependent → manual verification against a real EDS page, alongside the existing manual page-diff verification.
- `report-html.js` gets a unit test asserting the grouped structure renders correctly: a `RunSummary` with two distinct component groups plus one unattributed region produces the expected group headers, nested crops, and ignored-group treatment, and that HTML-sensitive characters remain escaped.
- Existing tests remain green; `npx tsc --noEmit` stays clean (schema field addition is type-checked through the shared `runSummarySchema`).

## Compatibility

- Existing runs without a `block` field parse fine (the field is optional/nullable); an older `regions.json` simply renders in the "Unattributed" group.
- No installer changes: attribution logic ships inside the already-copied `tools/page-diff/` tree and depends on nothing outside it.
