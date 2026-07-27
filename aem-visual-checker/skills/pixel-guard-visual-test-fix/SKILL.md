---
name: pixel-guard-visual-test-fix
description: Use when block visual-regression tests fail, or after adding or changing a block or variation in the Sidekick Library — a "test and fix" loop over the pixel-guard block visual-testing MCP tools (generateVisualTests, runVisualTests, updateVisualSnapshots). Triggers on "visual tests are failing", "a block looks different", "I changed a block, check for regressions". Requires the pixel-guard MCP server connected and the block-testing suite installed (aemVisualTestInstall / a tools/visual-tests/ directory).
---

# Fix block visual regressions

Catch and resolve unintended visual changes to blocks, using the pixel-guard block visual-testing MCP tools. Baselines here are **committed screenshots of your own blocks** rendered from the Sidekick Library (regression testing) — not the live site.

## Prerequisites

- The pixel-guard MCP server is connected and `aemVisualTestInstall` has been run (there is a `tools/visual-tests/` directory). If it isn't installed, run `aemVisualTestInstall` first.

## Steps

1. **Regenerate tests if blocks changed.** If you added or changed a block, or a Sidekick Library variation, call `generateVisualTests` first so every current variation has a test.

2. **Run and diagnose.** Call `runVisualTests` with `mode: "diagnose"`. The response lists every block/viewport test as pass ✅ / fail ❌, and for each failure gives a clean error message and the file path to its Playwright screenshot-diff image (`*-diff.png`). Read the diff images for the failures.

3. **Decide per failure — regression vs intentional.**
   - **Regression** (you did not mean to change how the block looks): fix the block's code in `blocks/<block>/`, then re-run `runVisualTests` for that block (`blockName`) until it passes.
   - **Intentional** (you meant to change the block's appearance): accept it as the new baseline with `updateVisualSnapshots` (optionally scoped to that block via `blockName`). **Confirm with the user before accepting** — an updated baseline is committed and becomes the new source of truth.

4. **Confirm.** Re-run `runVisualTests` to verify everything passes, and summarize for the user which blocks were fixed and which baselines were intentionally updated.

## Notes

- Only run `updateVisualSnapshots` when a change is intentional — it overwrites the committed baseline.
- This suite tests blocks in isolation against committed baselines. To instead check a migrated page against the **live original**, use the `pixel-guard-page-diff-fix` skill.
