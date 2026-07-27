# pixel-guard: installable client-repo skills

## Problem

pixel-guard's MCP tools work, but client agents don't reliably drive them well — a real client run had the agent improvise (screenshotting pages itself) instead of using `captureLiveBlock`/`compareBlock`, and fix blocks in random order. The MCP `instructions` field steers passively, but there is no invokable, step-by-step procedure the client's agent (Claude Code) can discover and follow.

This design ships two **Claude Code skills** as installer templates. When a capability is installed into a client repo, its installer also drops the matching skill into `.claude/skills/`, so the client agent gains `/pixel-guard-page-diff-fix` and `/pixel-guard-visual-test-fix` — richer, discoverable versions of the workflow than the terse MCP instructions.

## Goals

- Ship a **page-diff fix loop** skill and a **block visual-test fix loop** skill as static, reviewed templates in the repo.
- Have each installer copy its skill into the client repo's `.claude/skills/`, namespaced `pixel-guard-*`, force-overwritten (pixel-guard owns them, like `tools/`) so they never clobber the client's own skills.
- Encode the exact tool sequence, decision points, and gotchas (top-to-bottom order, prepare.js/ignore.json, don't-screenshot-manually, regression-vs-intentional) so the client agent stops improvising.

## Non-goals

- No setup/onboarding skill (deferred).
- No change to the MCP `instructions` (they stay as the always-on fallback for non-Claude-Code hosts; the skills are the richer invokable layer).
- No new MCP tool — skills are files copied by the existing installers.

## Skills

Templates live under `aem-visual-checker/skills/<name>/SKILL.md` (alongside the other installer assets). Each is a Claude Code project skill: YAML frontmatter (`name`, `description`) + a procedure body.

1. **`pixel-guard-page-diff-fix`** (installed by `installPageDiff`) — the migration "test & fix" loop: `comparePageDiff` → read report (full-page → block roll-up → regions) → summarize (sources, major fixes, quick fixes) → add `prepare.js` if a live-only overlay skews the diff → **top-to-bottom** per broken block: `captureLiveBlock` (check confidence / override with `liveSelector`) → `compareBlock` → fix → repeat until every viewport passes → `ignore.json` for intentional diffs → re-run to confirm. Explicit: never screenshot the pages yourself.

2. **`pixel-guard-visual-test-fix`** (installed by `aemVisualTestInstall`) — the block regression loop: `generateVisualTests` (if blocks changed) → `runVisualTests` mode `diagnose` → per failure inspect the diff image and decide regression (fix + re-run) vs intentional (`updateVisualSnapshots`, confirm with user first) → re-run to confirm.

## Install mechanism

New shared helper `src/workflows/copy-skill.ts`:

```ts
export async function copySkill(sourceDir, targetDir, skillName): Promise<void>
// cp(sourceDir/skills/<skillName> -> targetDir/.claude/skills/<skillName>,
//    { recursive: true, force: true, filter: skip .DS_Store })
```

- `installPageDiff` — `copyPageDiffFilesStep` calls `copySkill(ASSETS_SOURCE_DIR, targetDir, 'pixel-guard-page-diff-fix')` after copying `tools/page-diff/`; its message notes the skill.
- `aemVisualTestInstall` — `copyRequiredFilesStep` calls `copySkill(ASSETS_SOURCE_DIR, targetDir, 'pixel-guard-visual-test-fix')` after copying `tools/`; its message notes the skill.

No new workflow steps or output-schema changes — the copy rides inside the existing "files copied" step, so the install tool responses already surface it via that step's message.

## Testing

- Unit-test `copySkill`: source `skills/<name>/SKILL.md` → temp target, assert `.claude/skills/<name>/SKILL.md` exists and its frontmatter has `name:` and `description:`. Mirrors the existing `copyPageDiffFiles` copy test.
- Skill bodies are static prose — verified by review, not unit tests.
- Existing tests stay green; `npx tsc --noEmit` clean.

## Docs

- AGENTS.md / README: note that `installPageDiff` / `aemVisualTestInstall` also install a `.claude/skills/pixel-guard-*` skill, and that re-running the installer (force-overwrite) refreshes it.

## Compatibility

- Additive. Clients that installed before this get the skill by **re-running the installer**.
- Namespaced `pixel-guard-*` under `.claude/skills/`, so a client's own skills are untouched.
- Force-overwrite means local edits to the pixel-guard skills are replaced on re-install (intended — pixel-guard owns them).
