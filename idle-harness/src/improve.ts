// Improvement: a session of its own, not the one that did the work, that reads what many tasks took and changes the
// harness only where a pattern holds across them. It recurs on its own once a harness asks: when what the working
// sessions since the last one show is ripe, or every so many approved tasks. Its cost is the platform loop's, kept
// apart from the tasks'.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attribute, digest, improving, rebuilt, report, sessions } from './analytics.ts';
import type { Session } from './analytics.ts';
import * as harness from './harness.ts';
import { harnessDir, sessionDir } from './home.ts';
import { holder, pending, send } from './record.ts';
import * as versions from './versions.ts';

// The turns an improvement session gets: ten, six more per ripe thing, at most thirty; and the few more after them
// in which it may finish the change in hand before the base ends it.
export const TURNS = { base: 10, each: 6, most: 30, grace: 4 };

const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);

// What the improvement session starts from: what counts, the numbers, where the evidence is, and how to change.
export function brief(name: string, reading = ripe(name)): string {
  const dir = harnessDir(name);
  const { things, after, unused, turns } = reading;
  const last = sessions(name).filter((s) => improving(s.id)).at(-1);
  return `Improvement session. You do no task here: you improve the harness ${name}, the folder ${dir}, from what its work shows.

What counts is the cost to reach a solution the human approved, and the human's rating of it from 1 to 5. Everything else is a cause to look into. ${last ? `The last improvement session was ${last.id}, on ${last.entries[0].at}; what came after it is what is new.` : 'This is the first improvement session.'}

What is ripe, by the base's reading of the working sessions since: ${things.length ? `\n${things.map((thing) => `- ${thing}`).join('\n')}\nLook there first.` : 'nothing yet.'}

You have ${turns} turns. When they are spent the base says so, and ends this session ${TURNS.grace} turns later: finish one change and declare it before you start the next.
${harness.settings(dir).improve === 'ripe' ? `
Improvement starts when ${after} working sessions since the last one show the same thing: improveAfter in ${join(dir, 'config.json')}, ${after - unused} now${unused ? `, raised by ${unused} because the last ${unused} improvements took up no tool or skill a later session used` : ''}. If the records show it comes too early, what it took up going unused, or too late, the same tool built many times before it ran, change improveAfter, never below 2, and declare it like any change.
` : ''}
${report(name)}

What each working session ${last ? 'since then' : 'so far'} did:

${digest(name).join('\n\n') || 'none'}

That should answer most questions. To check something specific, the evidence is in ${join(dir, '.sessions')}/<session>/: record.jsonl, one JSON entry per turn with what arrived, every call and its result, what the model saw, its answer and cost; spill/ for long tool answers; layer/ for what it built. Retrospectives and outcomes are in idle-tasks: idle list --memories --kind retro --all, and idle show <task>.

How to change it:
- Working sessions build what they need in layers of their own, in ${join(dir, '.sessions')}/<session>/layer/: tools, a turn, skills, memory. Nothing of theirs is in the harness until you take it up. The layers above list what each built, by path, and the control loops what each tool cost and did.
- What you take up as a tool must be tools/<name>.ts, exporting description, parameters and run, so that every session is offered it. A script anywhere else is found only if something points to it.
- Take something up only where at least two sessions show it: two or more built the same kind of thing, or one built it and it kept paying off. Of their versions, keep the one that did the job best for least, or combine the best parts. Bring memory that several sessions wrote together into memory/. With fewer examples, write down what to watch and change nothing.
- One mechanism per change. After each, call declare: what friction it answers, what it changes, what it expects, general or domain, and the records it rests on (session#turn, task ids). A change that cites nothing is not kept.
- Call assess on earlier changes the numbers now speak to: kept, undone, or flagged. A part that has not paid off is flagged; removing it is a change of its own.
- What fires on nearly every task belongs in turn.ts or tools/, always loaded. What fires rarely belongs in skills/, loaded when a task needs it.
- Read the projects and the layers, never change them.

When you are done, say in a few lines what you changed and why.`;
}

// What is ripe for improvement among the working sessions since the last one: a tool built again, near-identical, in
// `after` sessions, a memory note written again in as many, as many rejections. `after` is the harness's improveAfter,
// three unless it says otherwise, raised by one for each improvement in a row that went unused. The more is ripe,
// the more turns the session gets.
export function ripe(name: string): { things: string[]; after: number; unused: number; turns: number } {
  const all = sessions(name);
  const since = all.filter((s) => improving(s.id)).at(-1)?.entries[0]?.at ?? '';
  const window = all.filter((s) => !improving(s.id) && String(s.entries[0].at) >= since);
  const unused = idle(name, all);
  const after = Math.max(2, Number(harness.settings(harnessDir(name)).improveAfter) || 3) + unused;
  const things = rebuilt(name, window.map((s) => s.id)).filter((g) => g.sessions.length >= after)
    .map((g) => `${g.kind === 'tool' ? 'a tool built again' : 'a memory note written again'} in ${g.sessions.join(', ')}: ${g.paths.join(', ')}`);
  const rejections = window.flatMap((s) => s.entries.flatMap((e) => (e.arrived ?? []).filter((item: any) => item.review?.verdict === 'rejected').map(() => s.id)));
  if (rejections.length >= after) things.push(`${rejections.length} rejections, in ${[...new Set(rejections)].join(', ')}`);
  return { things, after, unused, turns: Math.min(TURNS.most, TURNS.base + TURNS.each * things.length) };
}

// How many improvements in a row, the latest first, took up no tool or skill that a working session after it, and
// before the next, called or loaded. One no working session came after yet is not judged.
function idle(name: string, all: Session[]): number {
  const dir = harnessDir(name);
  let streak = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    if (!improving(all[i].id)) continue;
    const later = all.slice(i + 1);
    const until = later.findIndex((s) => improving(s.id));
    const working = until < 0 ? later : later.slice(0, until);
    if (!working.length) continue;
    let paths: string[] = [];
    try { paths = versions.changed(dir, all[i].entries[0].version, working[0].entries[0].version); } catch { /* an unsaved version */ }
    const parts = new Set(paths.map((p) => p.match(/^(?:tools\/([\w-]+)\.ts|skills\/([\w-]+)\/)/)).filter(Boolean).map((m) => m![1] ?? m![2]));
    const used = working.some((s) => s.entries.some((e) => (e.calls ?? []).some((call: any) => {
      if (call?.block !== 'tool') return false;
      const called = String(call.call?.function?.name ?? '');
      if (called !== 'skill') return parts.has(called);
      try { return parts.has(String(JSON.parse(call.call.function.arguments).name)); } catch { return false; }
    })));
    if (used) break;
    streak++;
  }
  return streak;
}

// Whether a harness wants improving now, and no improvement session is running or about to: something is ripe, when
// it asked for that in config.json ("improve": "ripe"), or as many approved tasks since the last improvement as it
// asked for ("improveEvery").
export function due(name: string): boolean {
  const asked = harness.settings(harnessDir(name));
  const every = Number(asked.improveEvery);
  if ((!(every > 0) && asked.improve !== 'ripe') || running(name)) return false;
  if (asked.improve === 'ripe' && ripe(name).things.length) return true;
  if (!(every > 0)) return false;
  const all = sessions(name);
  const earlier = ids(name);
  const since = all.find((s) => s.id === earlier.at(-1))?.entries[0]?.at ?? '';
  return attribute(all).tasks.filter((t) => t.approved && t.approved > since).length >= every;
}

const ids = (name: string) => {
  const folder = join(harnessDir(name), '.sessions');
  return existsSync(folder) ? readdirSync(folder).filter(improving).sort() : [];
};

// Whether an improvement session is at work on the harness, or about to start.
export const running = (name: string) => ids(name).some((id) => holder(sessionDir(name, id)) || pending(sessionDir(name, id)));

// A new improvement session with its brief in the inbox. Returns its id.
export function prepare(name: string, session = `improve-${stamp()}-${Math.random().toString(36).slice(2, 6)}`): string {
  if (!improving(session)) throw new Error(`an improvement session's name starts with improve-, not ${session}`);
  const reading = ripe(name);
  send(sessionDir(name, session), 'base', brief(name, reading), { budget: reading.turns });
  return session;
}

// Starts an improvement session in its own process, which ends when its work is done. Returns its id.
export function start(name: string): string {
  const session = prepare(name);
  const bin = fileURLToPath(new URL('../bin/idle-harness.mjs', import.meta.url));
  spawn(process.execPath, [bin, 'run', name, session, '--once'], { cwd: harnessDir(name), detached: true, stdio: 'ignore' }).unref();
  return session;
}
