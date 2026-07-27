# page-diff: automatic per-block impact roll-up

## Problem

`comparePageDiff` already attributes every diff region to the migrated page's owning component (block / section / landmark) and groups the output by component *within each viewport* (see the block-grouping design). But it stops there. To answer the question a migration reviewer actually asks first — **"which blocks are broken, and which do I fix first?"** — someone still has to read the region detail across every viewport and mentally roll it up per block: sum the diff, notice that `carousel-testimonial` is broken in all three viewports, judge that a 61%-coverage break matters more than a physically-large hero with a 5% break, and rank accordingly. That manual roll-up is exactly what an agent had to do by hand on a real run.

This design makes the tool do that roll-up itself: compute a ranked, cross-viewport **per-block impact summary** once at run time, persist it in `run-summary.json`, and surface it at the top of both the MCP text response and the HTML report.

It is purely additive: diffing, clustering, cropping, block attribution, and ignore-rule handling are all unchanged. It adds one pure aggregation pass over the already-attributed regions and a ranked presentation on top.

## Goals

- Aggregate failing regions **per block, across all viewports**, into one ranked list per pair, so one broken block reads as one ranked finding rather than N scattered per-viewport region groups.
- Rank blocks by a **coverage-first composite severity** so genuinely-wrong blocks outrank merely-large ones.
- Include all three attribution kinds (`block`, `landmark`, `section`) but present them grouped **Blocks → Landmarks → Sections**, so the reviewer's eye lands on real authored blocks first without hiding the pervasive section-spacing class of problem.
- Surface the roll-up in **both** the MCP text response (`comparePageDiff`, inherited by `localizePageDiff`) and the HTML report, from a **single computed source of truth** persisted in the run summary.

## Non-goals

- **No "clean blocks" list.** The roll-up covers only blocks that appear in at least one failing region. Blocks present on the page with no diff are not enumerated. (Confirmed scope decision.)
- **No `blocks/` directory cross-reference.** The tool does not read the target project's source tree to enumerate defined-but-untested blocks.
- **No "new block required" detection.** Detecting live-page content with no migrated counterpart needs live-side semantic analysis the tool does not do; it stays a human/agent judgment call.
- No change to the diff algorithm, clustering, cropping, viewport set, block-attribution logic, or ignore-rule matching.
- Out of scope: the mobile viewport-width mismatch bug (`live 356px vs migrated 320px`) — a separate config issue.

## Grouping model

For each pair, all **failing** regions (`status === 'failed'`) across all viewports are grouped by block identity.

- **Identity key:** `kind:name` (e.g. `block:carousel-testimonial`, `landmark:nav`, `section:section`). This groups a block *type* across viewports, which is the unit a reviewer fixes (multiple instances share code). Merging distinct on-page instances of the same block type is an accepted, documented simplification.
- Regions with no attributed block (`block == null`, the "Unattributed" group) are **excluded** from the roll-up — they have no block to identify. They remain visible in the existing per-region detail.
- `ignored` regions are excluded (they do not count toward pass/fail today; they do not count toward the roll-up either).

## Severity metric

Per block group:

- `regionCount` — number of failing regions across all viewports.
- `viewportsAffected` — sorted list of distinct viewport labels with ≥1 failing region for this block (e.g. `["Tablet","Desktop","Large"]`).
- `totalDiffPx` — sum of `diffPixelCount` over the block's failing regions.
- `coverage` — for each viewport, `sum(diffPixelCount of this block's failing regions in that viewport) / (blockBoundingBox.width × blockBoundingBox.height)` using the block box carried on the region (`region.block.boundingBox`, which is the box **at that viewport**); the block's `coverage` is the **max across viewports**, clamped to `[0, 1]`. Division guarded against a zero-area box (contributes `0`).
- `worstViewport` — the viewport that produced the max coverage; ties broken by greater `totalDiffPx` in that viewport.
- `worstCrop` — the diff-crop path (`crops.diff`) of the single largest-`diffPixelCount` failing region in `worstViewport`, for a report thumbnail; `null` if unavailable.

**Ranking (within each kind group):** sort by `coverage` desc, then `viewportsAffected.length` desc, then `totalDiffPx` desc. `severityScore` is stored as the coverage value (the primary sort key) so consumers can render it without re-deriving; ordering is fully determined by the tuple above.

**Kind ordering in output:** `block`, then `landmark`, then `section`.

## Architecture — single source of truth (Approach A)

The roll-up is computed **once**, inside the target project's `tools/page-diff/compare-page-diff.js`, and persisted into `run-summary.json`. Both consumers read the persisted field; neither recomputes.

- **New pure module `tools/page-diff/lib/block-summary.js`** — `buildBlockSummary(viewports)` takes one pair's `viewports[]` (each with its `regions[]` already carrying `block`) and returns the ranked `blockSummary[]` described below. Pure and synthetic-input testable → unit-tested.
- **`compare-page-diff.js`** — after a pair's viewports are assembled (regions already attributed), call `buildBlockSummary(pair.viewports)` and attach the result as `pair.blockSummary` before writing the run summary.
- This module and the schema field are additive to the already-copied `tools/page-diff/` tree; the block-attribution data it consumes is already present.

## Data model

`pairResultSchema` (the Zod schema in `src/workflows/compare-page-diff.ts`, shared by `comparePageDiff` and `localizePageDiff`) gains one field:

```ts
blockSummary: z.array(z.object({
  kind: z.enum(['block', 'section', 'landmark']),
  name: z.string(),
  selector: z.string(),            // representative selector (worstViewport occurrence)
  regionCount: z.number(),
  totalDiffPx: z.number(),
  coverage: z.number(),            // 0..1, max across viewports
  viewportsAffected: z.array(z.string()),
  severityScore: z.number(),       // == coverage (primary sort key), stored for consumers
  worstViewport: z.string(),
  worstCrop: z.string().nullable(),
})).optional()                     // optional → runs produced before this change still parse
```

Ordering of the array is the final ranked order (kind groups concatenated `block`→`landmark`→`section`, each internally severity-sorted), so consumers render it as-is.

## Output

- **MCP text (`comparePageDiff`)** — `formatSummary` in `src/tools/compare-page-diff-tool.ts` gains a **"Blocks affected"** section at the top of each pair, before the existing per-viewport region detail, driven by `pair.blockSummary`. Grouped by kind with a subheading per kind, one line per block, e.g.:
  `❌ Block "carousel-testimonial" — coverage 61%, 3/3 viewports [Tablet, Desktop, Large], 9 regions, 1,712,285 px`.
  The existing per-viewport, per-component region detail is retained beneath, unchanged.
- **`localizePageDiff`** — reads the same `run-summary.json`, so its response inherits the "Blocks affected" section with no separate code path. (If its formatter is a distinct function, it calls the same shared renderer; no recompute.)
- **HTML report (`tools/page-diff/lib/report-html.js`)** — a **"Block impact"** panel at the top of each pair, above the existing nested location→breakpoint→block→region accordions. Grouped by kind; each block row shows name, a coverage bar (0–100%), `viewportsAffected` chips, region count, total diff px, and the `worstCrop` thumbnail, linking/anchoring down to that block's existing accordion. Stays a single self-contained HTML file (inline `<style>`, minimal vanilla JS, no external assets); all interpolated values HTML-escaped via the existing `escapeHtml` discipline.

## Testing plan

- **Unit tests** (`node:test` + `node:assert/strict`) for `lib/block-summary.js` — this is where the real logic lives:
  - coverage math (sum diff px / block area) and **max-across-viewports** selection;
  - coverage **clamp to 1** when regions overlap or exceed the block box;
  - **zero-area** block box → coverage contributes 0, no divide-by-zero/NaN;
  - grouping by `kind:name` merges same-type regions across viewports; distinct kinds/names stay separate;
  - **ranking order**: coverage desc → viewportsAffected desc → totalDiffPx desc, and kind grouping order `block`→`landmark`→`section`;
  - `null`-block and `ignored` regions excluded;
  - empty / no-failing-region input → empty array.
- **`report-html.js`** gets a unit-test assertion that a `RunSummary` with a `blockSummary` renders the "Block impact" panel with the expected ranked rows, kind grouping, and escaped values; a summary without `blockSummary` renders the report unchanged (no panel).
- **MCP formatter** (`compare-page-diff-tool.ts`) gets an assertion that a summary with `blockSummary` produces the "Blocks affected" section in ranked order, and one without it omits the section cleanly.
- Existing tests stay green; `npx tsc --noEmit` stays clean (the schema field addition is type-checked through the shared `runSummarySchema`).

## Compatibility

- Runs produced before this change have no `blockSummary` field; it is `optional`, so they parse fine and both consumers simply omit the new section/panel.
- HTML-report changes ship inside the copied `tools/page-diff/` tree, so target projects must **re-run `installPageDiff`** (which force-overwrites `tools/`) to pick up the new report panel and the `block-summary.js` module. The MCP text section works immediately (it lives in the pixel-guard server), but only for runs produced by a `compare-page-diff.js` that has the roll-up computation — i.e. after re-install. Until re-install, the field is absent and the section is omitted (matches the "older run" path above).
- No new external dependencies; the report stays a single self-contained file.
