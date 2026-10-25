// Improvement: a session of its own, not the one that did the work, that reads what many tasks took and changes the
// harness only where a pattern holds across them. It recurs on its own once a harness says how often, in approved
// tasks; its cost is the platform loop's, kept apart from the tasks'.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attribute, improving, report, sessions } from './analytics.ts';
import * as harness from './harness.ts';
import { harnessDir, sessionDir } from './home.ts';
import { holder, pending, send } from './record.ts';

const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);

// What the improvement session starts from: what counts, the numbers, where the evidence is, and how to change.
export function brief(name: string): string {
  const dir = harnessDir(name);
  const last = sessions(name).filter((s) => improving(s.id)).at(-1);
  return `Improvement session. You do no task here: you improve the harness ${name}, the folder ${dir}, from what its work shows.

What counts is the cost to reach a solution the human approved, and the human's rating of it from 1 to 5. Everything else is a cause to look into. ${last ? `The last improvement session was ${last.id}, on ${last.entries[0].at}; what came after it is what is new.` : 'This is the first improvement session.'}

${report(name)}

The evidence: every session's record is ${join(dir, '.sessions')}/<session>/record.jsonl, one JSON entry per turn with what arrived, every call and its result, what the model saw, its answer and cost; long tool answers are in spill/. Retrospectives and outcomes are in idle-tasks: idle list --memories --kind retro --all, and idle show --id <task>.

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

// Whether a harness wants improving now: as many approved tasks since the last improvement as it asked for in
// config.json ("improveEvery"), and no improvement session running or about to.
export function due(name: string): boolean {
  const every = Number(harness.settings(harnessDir(name)).improveEvery);
  if (!(every > 0) || running(name)) return false;
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
  send(sessionDir(name, session), 'base', brief(name));
  return session;
}

// Starts an improvement session in its own process, which ends when its work is done. Returns its id.
export function start(name: string): string {
  const session = prepare(name);
  const bin = fileURLToPath(new URL('../bin/idle-harness.mjs', import.meta.url));
  spawn(process.execPath, [bin, 'run', name, session, '--once'], { cwd: harnessDir(name), detached: true, stdio: 'ignore' }).unref();
  return session;
}
