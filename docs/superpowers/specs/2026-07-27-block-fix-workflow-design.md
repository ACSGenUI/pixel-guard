# page-diff: per-block live-baseline fix workflow

## Problem

`comparePageDiff` (with the block-impact roll-up) tells you *which* migrated blocks are visually wrong versus the live original, ranked by severity. But it stops at diagnosis. Actually fixing a block is a manual loop with no tooling: figure out what the block is *supposed* to look like (the live site), eyeball the migrated rendering against it, change CSS, and re-check — repeatedly, per block, per viewport. There is no way to (a) capture the live site's rendering of one specific block as a fix target, or (b) re-check just that one block quickly after each edit without re-diffing the whole page.

This design adds two MCP tools that turn the roll-up into a complete, per-block fix loop:

1. **`captureLiveBlock`** — locate a block on the **live** page (whose DOM does not match the migrated EDS structure) by matching the migrated block's content, and save its rendering as a durable per-block **live baseline**.
2. **`compareBlock`** — re-screenshot just the **migrated** block and pixel-diff it against that saved baseline, giving a fast, offline, deterministic pass/fail the agent can re-run after each fix.

The comparison is **in-context**: both images are the block as rendered on its real page (live vs. migrated) at the same viewport width, so block fidelity — not synthetic-context noise — drives the diff. The Sidekick Library block-testing suite is **not** involved.

## Goals

- Given a block identified by a prior `comparePageDiff` run, capture the live site's rendering of that block as a committed baseline, robustly locating it on the live DOM.
- Re-diff a single migrated block against its saved live baseline per viewport, fast and offline, so the agent can iterate: fix → `compareBlock` → repeat until pass.
- Keep the live site hit **once** per block (at capture time); the fix loop touches only the migrated page.
- Make live-DOM location mostly automatic (content-anchor matching) with a reliable agent-override path for messy live sites.
- Reuse the existing page-diff infrastructure (screenshotting, `diffScreenshots`, `cropPng`, `serveReport`, block attribution) — additive, no changes to the diff algorithm, clustering, or ignore rules.

## Non-goals

- **No changes to the Sidekick Library block-testing suite** (`tools/visual-tests/`). That suite's isolated-iframe baselines are unrelated to this in-context, live-target comparison.
- **No automated CSS/markup fixing.** The tools capture and compare; the agent makes the fix between `compareBlock` runs.
- **No loop orchestration tool.** The agent drives the loop: read the roll-up, pick the top block, capture, compare-fix-repeat, move on. The tools are primitives.
- No shift/translation detection, no new external dependencies, no change to the mobile viewport-width mismatch bug (separate issue).
- Landmarks (`header`/`footer`/`nav`) and `section`-kind entries from the roll-up are in scope as block identifiers on the same footing as real blocks — the tools key on `kind:name`, they do not special-case blocks.

## Workflow

```
comparePageDiff (existing, + block roll-up)
        │  ranked broken blocks
        ▼
   agent picks the top block
        │
        ▼
captureLiveBlock(runId, block)  ── hits LIVE once ──▶ baselines/<pair>/<block>-<vp>.png + manifest
        │  (low confidence → returns candidate selectors; agent re-runs with liveSelector)
        ▼
   ┌───────────────────────────────────────────────┐
   │ compareBlock(runId, block)  (MIGRATED only)     │
   │   migrated block crop  vs  saved live baseline  │
   │        └── pass? ──no──▶ agent fixes CSS ──┐     │
   └────────────────────────────────────────────┘    │
        │ yes                                    ▲     │
        ▼                        └───────────────┘     │
   next block ◀───────────────────────────────────────┘
```

## Content-anchor matching (`lib/anchor-match.js`)

The core new capability: given the migrated block's content, find the corresponding region on the live page.

**Anchor extraction (from the migrated block element):**
- Heading text (`h1`–`h6`) — normalized (trimmed, collapsed whitespace, lowercased).
- Distinctive text snippets — the N longest text runs in the block, normalized.
- Image anchors — `src` basename (filename without path/query) and `alt` text.

**Matching (against the live DOM):**
- For each text anchor, find live elements whose normalized text content contains the snippet.
- For each image anchor, find live `img` elements whose `src` basename or `alt` matches.
- Collect all matched live elements; the target region is the bounding box of their **smallest common ancestor** (lowest element in the live DOM that contains all matches).

**Confidence score** (`0..1`): weighted fraction of anchors matched, penalized when the common-ancestor box is implausibly large relative to the number of matches (a sign the matches are scattered, not one block). A `MIN_CONFIDENCE` threshold (config) gates automatic acceptance.

**Split for testability** (mirrors `dom-capture.js`): the scoring/selection logic (`scoreMatches(anchors, candidateMatches)`, `smallestCommonAncestorBox(boxes)`, `computeConfidence(...)`) is **pure** and unit-tested with synthetic inputs; the browser-side DOM extraction/query (`extractAnchors(blockEl)`, `findAnchorsInLiveDom(page, anchors)`) runs in `page.evaluate` and is browser-verified, not unit-tested (no headless browser in the unit test files).

## Tool 1: `captureLiveBlock`

Ships as `tools/page-diff/capture-live-block.js` (plain-JS script) + a Mastra workflow + MCP tool in `src/`, following the exact pattern of `localize-page-diff.js` / `localize-page-diff.ts` / `localize-page-diff-tool.ts` (script writes artifacts, workflow `execFile`s it and parses stdout for the run id, tool formats the result).

**MCP input:**
- `runId` (string, required in practice) — an existing `comparePageDiff` run. Supplies the `{liveUrl, migratedUrl}` pair and the block's migrated selector + bounding box from attribution. (`mappingFile` alternative accepted for parity with the other tools: run a fresh compare first.)
- `block` (string, required) — the block to capture, as `name` or `kind:name` (e.g. `hero-spotlight`, `landmark:nav`), matched against the run's `blockSummary` / region `block` fields.
- `viewport` (string, optional) — a single viewport label (`Mobile`/`Tablet`/`Desktop`/`Large`); default is all viewports where the block appears in the run.
- `liveSelector` (string, optional) — agent override; when given, skip anchor matching and screenshot this live selector's bounding box.
- `projectDir` (string, optional) — standard resolution.

**Script behavior (per selected viewport):**
1. Resolve the block from the run summary → migrated selector, `liveUrl`, `migratedUrl`, `pairSlug`.
2. Open the **migrated** page at the viewport, locate the block by selector, run `extractAnchors` on it.
3. Open the **live** page at the viewport; if `liveSelector` given, use its bounding box; else `findAnchorsInLiveDom` + `scoreMatches` → matched region + confidence.
4. Screenshot the live page and `cropPng` the region → write `tools/page-diff/baselines/<pairSlug>/<block-slug>-<viewport>.png`.
5. Upsert a `tools/page-diff/baselines/<pairSlug>/manifest.json` entry: `{ block, viewport, liveSelector, boundingBox, anchors, confidence, sourceUrl, capturedAt }`.

**MCP response:** per viewport — saved baseline path, confidence, the matched live selector; **when confidence < threshold and no `liveSelector` was given**, the top candidate live selectors (with their boxes) and an explicit instruction to re-run with `liveSelector` if none of the auto-matches are right. Prints `Captured live block <block> for run <runId>` so the workflow can confirm success (mirrors the localize stdout contract).

## Tool 2: `compareBlock`

Ships as `tools/page-diff/compare-block.js` + workflow + MCP tool, same three-file pattern.

**MCP input:** `block` (string, required), `runId` (string; or `mappingFile`), `viewport` (string, optional — default all captured viewports for the block), `projectDir` (optional).

**Script behavior (per selected viewport):**
1. Load the saved live baseline PNG for `block`+viewport from `baselines/<pairSlug>/`. **Missing → error** telling the agent to run `captureLiveBlock` first.
2. Open the **migrated** page at the viewport, locate the block by selector, screenshot + `cropPng` its bounding-box region.
3. **Size reconciliation** (reusing the page-diff convention): both crops are full-width at the viewport, so widths normally match. If **heights differ**, diff the common (min) height and report a `heightDelta` (analogous to `pageLengthMismatch`). If **widths differ**, report it and diff the top-left overlapping area.
4. `diffScreenshots(baselineBuf, migratedBuf, THRESHOLDS)` → diff-pixel count + diff image; write the migrated crop, the baseline copy, and the diff crop into a run-scoped dir; pass/fail on the existing threshold.
5. Serve an HTML report via `serveReport` (a compact block-comparison report: per viewport, baseline | migrated | diff, pass/fail, `heightDelta`).

**MCP response:** per viewport — pass/fail, diff-pixel count, `heightDelta`, crop paths, and the report URL. Prints `Compared block <block> for run <runId>`.

**Fix loop:** the agent edits the migrated block's CSS/markup in the project, then re-runs `compareBlock` (migrated-only, offline, fast) until every viewport passes.

## Data model & artifacts

New, all under the already-copied `tools/page-diff/` tree so `installPageDiff`'s force-overwrite ships them:

- `tools/page-diff/baselines/<pairSlug>/<block-slug>-<viewport>.png` — committed live baselines (the fix target; intended to be committed to the target repo).
- `tools/page-diff/baselines/<pairSlug>/manifest.json` — per-entry `{ block, viewport, liveSelector, boundingBox, anchors, confidence, sourceUrl, capturedAt }`. Lets `compareBlock` and re-captures resolve baselines without re-deriving anchors.
- `compareBlock` diff artifacts live in a run-scoped dir under `tools/page-diff/runs/…/` (ephemeral, like existing region crops).

No change to `run-summary.json` or `runSummarySchema` — these tools read the existing `block` attribution; they don't write into the run summary.

## Config additions (`tools/page-diff/config.js`)

- `ANCHOR_MATCH = { minConfidence, maxTextAnchors, maxAncestorAreaRatio }` — thresholds for matching/acceptance.
- Reuse existing `VIEWPORTS` and `THRESHOLDS` (crop padding, pixelmatch threshold, height tolerance) unchanged.

## Testing plan

- **`lib/anchor-match.js`** unit tests (`node:test` + `node:assert/strict`): `smallestCommonAncestorBox` (nested boxes, disjoint boxes, single box); `scoreMatches` / `computeConfidence` (all anchors matched → high; partial → mid; scattered matches with a huge common ancestor → penalized below threshold; zero matches → 0); anchor normalization (whitespace/case). Browser-side `extractAnchors` / `findAnchorsInLiveDom` are browser-verified, not unit-tested (consistent with `dom-capture.js`).
- **Size-reconciliation helper** in `compare-block.js` (pure): equal size → full diff; height delta → common-height diff + reported delta; width delta → overlap diff + reported delta. Unit-tested.
- **Manifest read/write** helper: round-trips entries, upserts by `block`+`viewport`. Unit-tested.
- The workflow/tool layers are thin `execFile` wrappers (as with the existing page-diff tools) — covered by `npx tsc --noEmit` for the schemas and manual end-to-end verification against a real live/migrated pair (the same way `collectBlockBoxes` and the localize flow are verified).
- Existing tests stay green; `npm test` and `npx tsc --noEmit` clean.

## MCP registration & docs

- Register `captureLiveBlock` and `compareBlock` in `src/mcp-server.ts` (tool map + the `instructions` string describing the new page-diff fix loop).
- Update `AGENTS.md` and `README.md`: document the two tools and the end-to-end loop (comparePageDiff → captureLiveBlock → compareBlock → fix → repeat), and state the anchor-match confidence / `liveSelector` override behavior.

## Compatibility

- Purely additive: existing `comparePageDiff` / `localizePageDiff` runs and reports are unchanged; the block roll-up they now emit is the input to `captureLiveBlock`.
- Target projects must **re-run `installPageDiff`** (force-overwrites `tools/`) to get the new scripts, `lib/anchor-match.js`, the `baselines/` convention, and the config additions.
- No new external dependencies; anchor matching and diffing use Playwright + the existing `pixelmatch`/`pngjs` already in the page-diff dependency set.

## Main risk

Anchor-matching reliability on messy or heavily-restructured live sites (duplicated text, boilerplate, images renamed during migration). Mitigations baked in: the confidence score gates auto-acceptance, low-confidence results surface candidate selectors, and the `liveSelector` override lets the agent (which can see both the live screenshot and the DOM) pin the region deterministically. Capturing once and committing the baseline means a human/agent validates the target a single time, after which the fix loop is stable.
