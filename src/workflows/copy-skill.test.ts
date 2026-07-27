import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copySkill } from './copy-skill.js';

test('copySkill copies skills/<name>/ into <target>/.claude/skills/<name>/, force-overwriting', async () => {
  const source = await mkdtemp(join(tmpdir(), 'pg-src-'));
  const target = await mkdtemp(join(tmpdir(), 'pg-tgt-'));
  try {
    const skillName = 'pixel-guard-page-diff-fix';
    await mkdir(join(source, 'skills', skillName), { recursive: true });
    await writeFile(join(source, 'skills', skillName, 'SKILL.md'), '---\nname: x\n---\nbody v1');

    await copySkill(source, target, skillName);
    const dest = join(target, '.claude', 'skills', skillName, 'SKILL.md');
    assert.equal(await readFile(dest, 'utf8'), '---\nname: x\n---\nbody v1');

    // re-install overwrites
    await writeFile(join(source, 'skills', skillName, 'SKILL.md'), '---\nname: x\n---\nbody v2');
    await copySkill(source, target, skillName);
    assert.equal(await readFile(dest, 'utf8'), '---\nname: x\n---\nbody v2');
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});
