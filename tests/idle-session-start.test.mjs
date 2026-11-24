import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repo = resolve(new URL('..', import.meta.url).pathname);
const hook = resolve(repo, 'idle-tasks/hooks/session-start.mjs');
const start = (format) => spawnSync(process.execPath, [hook, format], { encoding: 'utf8' });

test('a session is told its work is tracked in the record, in each host\'s shape', () => {
  const claude = JSON.parse(start('claude').stdout).hookSpecificOutput;
  assert.equal(claude.hookEventName, 'SessionStart');
  assert.match(claude.additionalContext, /idle-tasks:idle/);
  assert.match(JSON.parse(start('cursor').stdout).additional_context, /idle-tasks:idle/);
  assert.equal(start('codex').stdout, '');
});

test('the session-start hook is wired for every host that reads hooks', () => {
  const hooks = JSON.parse(readFileSync(resolve(repo, 'idle-tasks/hooks/hooks.json'), 'utf8')).hooks;
  assert.match(hooks.SessionStart[0].hooks[0].command, /session-start\.mjs/);
  const cursor = JSON.parse(readFileSync(resolve(repo, 'idle-tasks/hooks/cursor-hooks.json'), 'utf8')).hooks;
  assert.match(cursor.sessionStart[0].command, /session-start\.mjs cursor/);
});
