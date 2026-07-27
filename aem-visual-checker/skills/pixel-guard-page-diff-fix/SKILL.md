---
name: pixel-guard-page-diff-fix
description: Use when fixing visual differences between a live site and its migrated AEM Edge Delivery page — a full "test and fix" loop over the pixel-guard page-diff MCP tools. Triggers on "fix the migration", "make the migrated page match live", "run a page diff and fix it", or a visual mismatch between a live URL and its migrated counterpart. Requires the pixel-guard MCP server connected and page-diff installed (installPageDiff / a tools/page-diff/ directory).
---

# Fix a migration with page-diff

Fix the visual differences between a live page and its migrated AEM Edge Delivery Services (EDS) page, block by block, top to bottom, using the pixel-guard page-diff MCP tools. **Do not screenshot the pages yourself — the tools capture, locate, and diff for you.**

## Prerequisites

- The pixel-guard MCP server is connected and `installPageDiff` has been run in this project (there is a `tools/page-diff/` directory). If it isn't installed, run `installPageDiff` first.
- A mapping file of `{ liveUrl, migratedUrl }` pairs (CSV or JSON). If none exists, ask the user for the live URL and its migrated URL and create one.
- The migrated page is reachable (e.g. the local dev server is running).

## Steps

1. **Compare.** Call `comparePageDiff` with the mapping file. Open the page-diff report linked in the response.

2. **Summarize.** Read the report top to bottom — the full-page live/migrated/diff comparison, then the **Blocks affected (top to bottom)** roll-up, then the per-region detail. Give the user a complete summary: where the differences come from (which blocks / landmarks / sections and why), the **major fixes**, and the **quick fixes**.

3. **Clear noise first (only if needed).** If a live-only overlay is skewing the whole diff — a cookie-consent banner, an ad, or a chat widget that appears on live but not migrated — add a `tools/page-diff/prepare.js` hook to remove it, then re-run `comparePageDiff`. The hook runs on every page before each screenshot; branch on `ctx.side` (`'live'` / `'migrated'`):

   ```js
   // tools/page-diff/prepare.js
   export default async (page, ctx) => {
     if (ctx.side === 'live') {
       await page.evaluate(() => document.querySelector('#onetrust-consent-sdk')?.remove());
     }
   };
   ```

4. **Fix top to bottom.** Work the roll-up in the order given — it is sorted by on-page position, header/nav first, then down the page. Starting from the **topmost** broken block, for each one:
   1. `captureLiveBlock` with the block name + the `runId`, to save the live rendering as a baseline. Check the confidence in the response; if it's low or the match looks wrong, re-run with an explicit `liveSelector` you pick from the live page.
   2. `compareBlock` with the same block + `runId`, to see the current gap against that baseline.
   3. Fix the migrated block's CSS/markup in `blocks/<block>/`.
   4. Re-run `compareBlock` until every viewport passes.
   5. Move down to the next broken block and repeat.

5. **Intentional differences.** If a difference is expected and should not count (a deliberate design change), add a rule to `tools/page-diff/ignore.json` scoped by CSS selector / pixel region and pair / viewport — don't try to "fix" it.

6. **Finish.** When the roll-up is clean (or only intentional / ignored differences remain), re-run `comparePageDiff` to confirm, and give the user a final summary of what changed.

## Notes

- Never take your own screenshots of the live or migrated page — `captureLiveBlock` and `compareBlock` already do this per block, and locate the block on the live DOM for you.
- `captureLiveBlock` hits the live site once per block; the fix loop after that runs entirely against the migrated page (fast, offline).
- To instead catch regressions in your own blocks against committed baselines (not against live), use the `pixel-guard-visual-test-fix` skill.
