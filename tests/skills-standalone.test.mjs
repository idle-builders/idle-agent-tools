import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const skills = join(root, 'idle-skills');

const TRACKER = [
  /idle-tasks|idle-agent-tasks/,
  /~\/\.idle|IDLE_HOME|IDLE_BIN/,
  /\/idle(?![\w-])/,
  /\bidle (show|list|task|memory|doctor)\b/,
  /\bmemory --|--kind\b|--task\b/,
  /record of work/i,
  /\bclaim(ed|s)?\b/i,
  /\bsubmit(ted|s)?\b/i,
  /\bretro memor/i,
  /mcp__plugin_idle/,
];

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'viewer' ? [] : files(p);
    return [p];
  });
}

const shipped = [
  ...files(join(skills, 'skills')),
  ...files(join(skills, 'hooks')),
  join(skills, '.opencode', 'plugins', 'pipeline.js'),
  join(skills, 'pipeline.config.example.yml'),
];

test('idle-skills never names the task tracker', () => {
  const hits = [];
  for (const file of shipped) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const re of TRACKER) if (re.test(line)) hits.push(`${file.slice(root.length + 1)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('skills that exist to mine the tracker live with it', () => {
  for (const name of ['retro', 'self-improve']) {
    assert.ok(!existsSync(join(skills, 'skills', name)), `${name} is still in idle-skills`);
    assert.ok(existsSync(join(root, 'idle-tasks', 'skills', name, 'SKILL.md')), `${name} is missing from idle-tasks`);
  }
});

test('skill-load injection is wired from idle-tasks, not idle-skills', () => {
  assert.ok(!existsSync(join(skills, 'hooks', 'inject.mjs')));
  for (const f of ['hooks.json', 'cursor-hooks.json']) {
    assert.doesNotMatch(readFileSync(join(skills, 'hooks', f), 'utf8'), /inject|Skill/);
    assert.match(readFileSync(join(root, 'idle-tasks', 'hooks', f), 'utf8'), /inject\.mjs/);
  }
});
