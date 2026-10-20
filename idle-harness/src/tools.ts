// The tools a turn can call: the base's bare ones, and how a harness's own tools join them.

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ToolSpec } from './model.ts';
import type { Blocks } from './turn.ts';
import * as versions from './versions.ts';

// What the model is told about a tool, and what runs when it calls it. The result is what the model reads back.
export type Tool = { spec: ToolSpec; run(args: any, base: Blocks): Promise<unknown> | unknown };

// Output past what a session should hold is cut in the middle: the start says what ran, the end says how it went.
// Anything shorter reaches the base whole, which keeps a long answer in a file and gives the context its two ends.
const MAX = 4_000_000;
const clip = (text: string) => (text.length <= MAX ? text : `${text.slice(0, MAX / 2)}\n… cut …\n${text.slice(-MAX / 2)}`);

// Commands run in their own process group, so a timeout or the end of the session stops everything they started,
// background jobs included.
const running = new Set<number>();
const stop = (pid: number) => { try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ } };
process.on('exit', () => running.forEach(stop));

function bash(command: string, timeout: number | undefined, base: Blocks): Promise<string> {
  return new Promise((done) => {
    const child = spawn('bash', ['-c', command], { cwd: base.cwd, env: { ...process.env, IDLE_BY: `harness/${base.name}@${base.version}` }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    let finished = false;
    const finish = (end: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      for (const stream of [child.stdout, child.stderr]) (stream as any).unref?.(); // what is left in the background may not keep the process alive
      done(clip(`${out}${end}`) || '(no output)');
    };
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8'); // decodes across chunks, so a character is never cut in two
      stream.on('data', (data: string) => {
        if (finished) return; // a background job still writing is drained, not read
        out += data;
        if (out.length > MAX) out = clip(out);
      });
    }
    if (child.pid) running.add(child.pid);
    const timer = timeout ? setTimeout(() => { out += `\n[stopped after ${timeout}s]`; stop(child.pid!); }, timeout * 1000) : undefined;
    // The shell exiting is the end, even while a job it left in the background keeps the output open.
    child.on('exit', (code) => setTimeout(() => finish(code ? `\n[exit ${code}]` : ''), 100));
    child.on('close', (code) => { running.delete(child.pid!); finish(code ? `\n[exit ${code}]` : ''); });
    child.on('error', (error) => finish(`error: ${error.message}`));
  });
}

// A bare tool says what is missing, and what it got instead, rather than writing "undefined" into a file.
// Aliases take the names other harnesses use for the same argument.
function tool(name: string, description: string, properties: Record<string, object>, required: string[], run: (a: any, base: Blocks) => unknown, aliases: Record<string, string> = {}): Tool {
  return {
    spec: { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } },
    run: (given, base) => {
      const a = { ...given };
      for (const [alias, key] of Object.entries(aliases)) if (a[key] === undefined && a[alias] !== undefined) a[key] = a[alias];
      const missing = required.find((key) => typeof a?.[key] !== 'string');
      return missing ? `error: ${missing} is missing (got ${Object.keys(given ?? {}).join(', ') || 'nothing'})` : run(a, base);
    },
  };
}

const text = { type: 'string' };
const at = (base: Blocks, path: string) => resolve(base.cwd, path);

export const BARE: Tool[] = [
  tool('read', 'Read a text file.', { path: text, offset: { type: 'number', description: 'first line, counting from 1' }, limit: { type: 'number', description: 'how many lines' } }, ['path'], (a, base) => {
    const lines = readFileSync(at(base, a.path), 'utf8').split('\n');
    const first = Math.max(1, a.offset ?? 1) - 1;
    return lines.slice(first, a.limit ? first + a.limit : undefined).join('\n');
  }),
  tool('write', 'Write a file, creating its folders. Replaces what is there.', { path: text, content: text }, ['path', 'content'], (a, base) => {
    mkdirSync(dirname(at(base, a.path)), { recursive: true });
    writeFileSync(at(base, a.path), a.content);
    return `wrote ${a.path}`;
  }),
  tool('edit', 'Replace one exact piece of text in a file: old_string must occur in it exactly once.', { path: text, old_string: text, new_string: text }, ['path', 'old_string', 'new_string'], (a, base) => {
    const before = readFileSync(at(base, a.path), 'utf8');
    const count = a.old_string ? before.split(a.old_string).length - 1 : 0;
    if (count !== 1) return `error: the text occurs ${count} times in ${a.path}; it must occur exactly once`;
    writeFileSync(at(base, a.path), before.replace(a.old_string, () => a.new_string));
    return `edited ${a.path}`;
  }, { old: 'old_string', new: 'new_string' }),
  tool('bash', 'Run a shell command. There is no time limit unless you set one. A job left in the background runs until the session ends.', { command: text, timeout: { type: 'number', description: 'seconds' } }, ['command'], (a, base) => bash(a.command, a.timeout, base)),
  tool('versions', 'Earlier versions of your harness folder: list them, show what one changed, or restore the folder to one.', { action: { type: 'string', enum: ['list', 'show', 'restore'] }, version: text }, ['action'], (a, base) => {
    if (a.action === 'list') return versions.list(base.harness);
    if (a.action === 'show') return versions.show(base.harness, a.version);
    if (a.action === 'restore') return `the folder is back at ${a.version}; that is now version ${versions.restore(base.harness, a.version)}`;
    return 'error: action is list, show or restore';
  }),
  tool('declare', 'Declare a change to your harness folder: one mechanism per change. Saves the folder as it is now and keeps the declaration with that version. A change that cites no records is not kept.', {
    change: { type: 'string', description: 'what it changes' },
    friction: { type: 'string', description: 'what friction it answers' },
    expect: { type: 'string', description: 'what should get better: cost to an approved solution, its rating, or a cause of either' },
    scope: { type: 'string', enum: ['general', 'domain'], description: 'general: about how an agent works, could carry over to another harness; domain: about this harness\'s work' },
    evidence: { type: 'array', items: text, description: 'the records it rests on: session#turn, task ids, replays' },
  }, ['change', 'friction', 'expect', 'scope'], (a, base) => {
    const evidence = Array.isArray(a.evidence) ? a.evidence.map(String).filter((e: string) => e.trim()) : [];
    if (!evidence.length) return 'error: cite the records the change rests on in evidence: session#turn, task ids, replays';
    if (a.scope !== 'general' && a.scope !== 'domain') return 'error: scope is general or domain';
    const version = versions.declare(base.harness, { change: a.change, friction: a.friction, expect: a.expect, scope: a.scope, evidence, by: `${base.session}#${base.n}`, at: new Date().toISOString() }, `${base.session} declares: ${a.change}`.slice(0, 120));
    return `declared on version ${version}`;
  }),
  tool('assess', 'Assess an earlier declared change against what happened since: kept, undone, or flagged as not paying off. Undoing or removing it is a change of its own.', {
    version: text,
    verdict: { type: 'string', enum: ['kept', 'undone', 'flagged'] },
    signals: { type: 'string', description: 'what cost to approval, ratings and their causes did after it' },
    evidence: { type: 'array', items: text, description: 'the records it rests on' },
  }, ['version', 'verdict', 'signals'], (a, base) => {
    const evidence = Array.isArray(a.evidence) ? a.evidence.map(String).filter((e: string) => e.trim()) : [];
    if (!evidence.length) return 'error: cite the records the assessment rests on in evidence';
    if (!['kept', 'undone', 'flagged'].includes(a.verdict)) return 'error: verdict is kept, undone or flagged';
    versions.assess(base.harness, a.version, { verdict: a.verdict, signals: a.signals, evidence, by: `${base.session}#${base.n}`, at: new Date().toISOString() });
    return `assessed ${a.version}: ${a.verdict}`;
  }),
];

// Bare tools a harness cannot replace: the way back to an earlier version, and what its changes say, stay the base's.
export const KEPT = new Set(['versions', 'declare', 'assess']);

// A skill a harness can load: a way of solving a kind of problem, its description saying when it applies.
export type Skill = { name: string; description: string; path: string };

// Loading a skill: its SKILL.md, and the other files beside it, which the skill says when to read.
export function skill(skills: Skill[]): Tool {
  const list = skills.map((s) => `- ${s.name}: ${s.description || '(no description)'}`).join('\n');
  return tool('skill', `Load a skill: a way of solving a kind of problem, with when it applies. Load one when a task needs it.\n${list}`, { name: { type: 'string', enum: skills.map((s) => s.name) } }, ['name'], (a) => {
    const found = skills.find((s) => s.name === a.name);
    if (!found) return `error: there is no skill named ${a.name}`;
    const others = readdirSync(dirname(found.path), { recursive: true }).map(String).filter((file) => file !== 'SKILL.md');
    return `${readFileSync(found.path, 'utf8')}${others.length ? `\n\nFiles beside it, in ${dirname(found.path)}:\n${others.map((file) => `- ${file}`).join('\n')}` : ''}`;
  });
}

// The tools a turn can call: the bare ones, the skill loader when there are skills, and the harness's own, which
// replace those of the same name.
export function registry(own: Tool[], skills: Skill[] = []): Tool[] {
  const mine = own.filter((t) => !KEPT.has(t.spec.function.name));
  const names = new Set(mine.map((t) => t.spec.function.name));
  return [...BARE, ...(skills.length ? [skill(skills)] : [])].filter((t) => !names.has(t.spec.function.name)).concat(mine);
}
