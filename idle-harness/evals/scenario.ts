// What an eval is, and what it can look at once its sessions have run.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnessDir, sessionDir, user } from '../src/home.ts';
import { model } from '../src/model.ts';
import { read } from '../src/record.ts';

// One finding of an eval. An eval passes when all of them do; `pass: null` is reported, never passed or failed.
export type Check = { name: string; pass: boolean | null; detail?: string };

// One step of an eval: a message for a new working session — of the run's harness or of another harness of the run
// (named by a short key), in the run's project or in another (`in`: a folder of projects/, with `#key` for a second
// copy) — an improvement session of a harness, started the way the base starts one, a task reopened in the session
// just run when `reopen` returns why, a review of the session just run — what `review` returns is sent to it, again
// and again, until it returns null or approves — or something the eval does between sessions, such as leaving a
// comment. A session started for a `task` keeps it, so that reviews count toward it.
export type Step =
  | string
  | { message: string; harness?: string; in?: string; task?: string }
  | { improve: true; harness?: string }
  | { reopen(run: Run, n: number): string | null }
  | { review(run: Run, n: number): string | null }
  | ((run: Run) => void | Promise<void>);

// What a reviewer's check said about one attempt at a task.
export type Verdict = { reward: number; rating?: number; feedback?: string };

// How a run treats what working sessions change. layered, as the base does: each keeps its changes in a layer of its
// own, and only improvement sessions, taking up what several layers show, change what the next task starts with. open:
// working sessions change the harness itself ("layers": false). frozen: layered, and improvement is skipped, so nothing
// carries over: the baseline in which nothing is learned.
export type Structure = 'layered' | 'open' | 'frozen';

export type Scenario = {
  id: string;
  title: string;
  intents: string[]; // the intents in INTENT.md it shows
  project: string; // a folder under evals/projects/, or an absolute path, copied fresh for every run
  minutes?: number; // how long one session may take before the run counts as failed; 15 if not given
  setup?(run: Run): void | Promise<void>; // the harness's starting state, before the first step
  seed?(run: Run): void; // with --seed: what a harness specialised on this work would start with, after setup
  teardown?(run: Run): void | Promise<void>; // after the checks: stops whatever setup started
  steps: Step[]; // in order; each message is a session of its own, answered with --once
  check(run: Run): Check[] | Promise<Check[]>;
};

// One run of a scenario: throwaway harnesses and a fresh copy of the project.
export class Run {
  name: string; // the run's harness; another harness of the run is `${name}-${key}`
  cwd: string; // the project copy
  sessions = new Map<number, string>(); // which harness ran session n
  improvements = new Set<number>(); // which sessions were for improvement
  reopened = new Map<number, number>(); // how often the task of session n was reopened
  verdicts = new Map<number, Verdict[]>(); // what the reviewer's check said of session n's work, attempt by attempt
  places = new Map<string, string>(); // other project copies of the run, by the `in` that named them
  where = new Map<number, string>(); // the project copy session n worked in
  structure: Structure = 'layered';
  readingCost = 0; // what the model readers of `ask` cost

  constructor(name: string, cwd: string) {
    this.name = name;
    this.cwd = cwd;
  }

  harnessName(key?: string) { return key ? `${this.name}-${key}` : this.name; }

  dir(key?: string) { return harnessDir(this.harnessName(key)); }

  get harness() { return this.dir(); }

  // The id of session n, counting from 1 across the run: improvement sessions are named so, as the base knows them.
  id(n: number) { return `${this.improvements.has(n) ? 'improve-' : ''}s${n}`; }

  // The record of session n, with whole contexts.
  records(n: number): any[] { return read(sessionDir(this.sessions.get(n) ?? this.name, this.id(n))); }

  // The last thing the model said in session n.
  reply(n: number): string {
    return this.records(n).map((entry) => entry.response?.content).filter(Boolean).at(-1) ?? '';
  }

  // The run's project copy, or another one named by `in`.
  at(place?: string) { return place ? this.places.get(place) ?? '' : this.cwd; }

  // A shell command in the project, or in another copy.
  sh(command: string, place?: string): { code: number; out: string } {
    const result = spawnSync('bash', ['-c', command], { cwd: this.at(place), encoding: 'utf8' });
    return { code: result.status ?? 1, out: `${result.stdout}${result.stderr}` };
  }

  private git(key: string | undefined, ...args: string[]) {
    const shown = spawnSync('git', args, { cwd: this.dir(key), encoding: 'utf8' });
    return shown.status === 0 ? shown.stdout : null;
  }

  // A file in a harness folder as it is now, or at a version; null when it is not there.
  file(path: string, version?: string, key?: string): string | null {
    if (version) return this.git(key, 'show', `${version}:${path}`);
    try { return readFileSync(join(this.dir(key), path), 'utf8'); } catch { return null; }
  }

  // Every file in a harness folder's latest version, or in an earlier one.
  files(key?: string, version?: string): string[] {
    return ((version ? this.git(key, 'ls-tree', '-r', '--name-only', version) : this.git(key, 'ls-files')) ?? '').trim().split('\n').filter(Boolean);
  }

  // The folder session n changed: its layer over the harness, or the harness itself.
  own(n: number): string {
    const layer = join(sessionDir(this.sessions.get(n) ?? this.name, this.id(n)), 'layer');
    return existsSync(layer) ? layer : harnessDir(this.sessions.get(n) ?? this.name);
  }

  // The versions of a harness folder, oldest first, with the message each was saved under: the harness's own and the
  // working sessions' on their branches.
  versions(key?: string): { version: string; message: string }[] {
    return (this.git(key, 'log', '--all', '--reverse', '--format=%h %s') ?? '').trim().split('\n').filter(Boolean)
      .map((line) => ({ version: line.slice(0, line.indexOf(' ')), message: line.slice(line.indexOf(' ') + 1) }));
  }

  // What changed in a harness folder between two versions, as a patch.
  diff(from: string, to: string, key?: string): string { return this.git(key, 'diff', from, to) ?? ''; }

  // Only where a finding cannot be read in code: a model reads the material and answers each question true or false.
  async ask(questions: Record<string, string>, material: string): Promise<{ answers: Record<string, boolean>; why: string }> {
    const keys = Object.keys(questions);
    const prompt = `Answer each question about the material below with true or false.\n\n${keys.map((key) => `${key}: ${questions[key]}`).join('\n')}\n\nAnswer with JSON only: {${keys.map((key) => `"${key}": true or false`).join(', ')}, "why": "one or two sentences"}\n\nThe material:\n<<<\n${material}\n>>>`;
    const context = { model: process.env.IDLE_HARNESS_MODEL || user().harness?.model || '', system: 'You read what a software agent did and wrote, and answer questions about it strictly and literally.', tools: [], messages: [] };
    const reply = await model(context, [{ role: 'user', content: prompt }]);
    this.readingCost += reply.cost ?? 0;
    const text = String(reply.message.content ?? '');
    let parsed: any = {};
    try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { /* counts as all false */ }
    return { answers: Object.fromEntries(keys.map((key) => [key, parsed[key] === true])), why: String(parsed.why ?? text.slice(0, 300)) };
  }
}

export const check = (name: string, pass: boolean | null, detail?: string): Check => ({ name, pass, ...(detail ? { detail } : {}) });

// What one model call cost on average across these entries; null when none reported a cost.
export function costPerCall(entries: any[]): number | null {
  const calls = entries.filter((entry) => typeof entry.cost === 'number' && entry.usage);
  return calls.length ? calls.reduce((sum, entry) => sum + entry.cost, 0) / calls.length : null;
}

// The share of prompt tokens served from the provider's cache across these entries. Unlike cost per call,
// it does not depend on how long a task ran.
export function cacheHit(entries: any[]): number | null {
  const calls = entries.filter((entry) => entry.usage?.prompt_tokens);
  const prompt = calls.reduce((sum, entry) => sum + entry.usage.prompt_tokens, 0);
  return prompt ? calls.reduce((sum, entry) => sum + (entry.usage.prompt_tokens_details?.cached_tokens ?? 0), 0) / prompt : null;
}

// How many model calls a session made: the measure of how many turns a task took.
export const calls = (entries: any[]) => entries.filter((entry) => entry.usage).length;

// The tool calls of a session that worked on the harness rather than on the task: anything naming the harness folder,
// and the versions tool. The project copy's own path starts with the harness's name, so the folder is matched with
// its parent.
export function harnessWork(entries: any[], name: string): { calls: number; of: number } {
  const all = entries.flatMap((entry) => entry.response?.tool_calls ?? []);
  const own = all.filter((call: any) => call.function?.name === 'versions' || String(call.function?.arguments ?? '').includes(`harness/${name}`));
  return { calls: own.length, of: all.length };
}

// The project's own tests, as one finding.
export function testsPass(run: Run, place?: string): Check {
  const tests = run.sh('node --test --test-reporter=tap', place);
  return check("the project's tests pass", tests.code === 0, tests.out.split('\n').filter((line) => /^# (pass|fail) /.test(line)).join(', '));
}

// Where a change to a harness landed.
const surface = (path: string) => (path === 'turn.ts' ? 'turn' : path.startsWith('tools/') ? 'tool' : path.startsWith('skills/') ? 'skill'
  : path === 'config.json' ? 'settings' : /\.(md|txt)$/i.test(path) ? 'notes' : 'code');

// What one session changed in its harness: the files, whether each lasted to the end of the run, and how often later
// sessions called a tool it made or named a file it wrote.
export type Change = {
  session: number;
  improvement: boolean;
  files: { path: string; surface: string; added: number; removed: number; lasted: boolean; usedLater: number }[];
  restores: number; // times it put its folder back to an earlier version
};

// When, where and how a run's harness changed, session by session: in the harness itself, and in each working
// session's layer. A layer's file lasted when the harness has it at the end, which is to say improvement took it up.
export function ledger(run: Run, key?: string): Change[] {
  const end = new Set(run.files(key));
  const changes = new Map<number, Change>();
  const at = (n: number) => changes.get(n) ?? changes.set(n, { session: n, improvement: run.improvements.has(n), files: [], restores: 0 }).get(n)!;
  const sessions = [...run.sessions.keys()].filter((n) => run.sessions.get(n) === run.harnessName(key));
  const later = (n: number) => sessions.filter((m) => m > n).flatMap((m) => run.records(m).flatMap((entry) => entry.response?.tool_calls ?? []));
  const folders = [run.dir(key), ...sessions.map((n) => join(sessionDir(run.harnessName(key), run.id(n)), 'layer')).filter(existsSync)];
  for (const folder of folders) {
    const log = spawnSync('git', ['log', '--all', '--reverse', '--format=%x01%h %s', '--numstat'], { cwd: folder, encoding: 'utf8' }).stdout ?? '';
    for (const commit of log.split('\x01').filter(Boolean)) {
      const [head, ...lines] = commit.trim().split('\n');
      const version = head.slice(0, head.indexOf(' '));
      const made = head.match(/ (?:improve-)?s(\d+) (?:turn \d+|declares: .*)$/);
      if (!made) {
        // A going back the session itself asked for shows in its records after its first turn.
        const by = sessions.find((n) => run.records(n).slice(1).some((entry) => entry.version === version || entry.layer === version));
        if (by && / back to /.test(head)) at(by).restores++;
        continue;
      }
      const n = Number(made[1]);
      for (const line of lines.filter(Boolean)) {
        const [added, removed, path] = line.split('\t');
        const calls = later(n);
        const name = path.replace(/^tools\//, '').replace(/\.ts$/, '');
        const usedLater = surface(path) === 'tool' ? calls.filter((call: any) => call.function?.name === name).length
          : calls.filter((call: any) => String(call.function?.arguments ?? '').includes(path.split('/').at(-1)!)).length;
        const known = at(n).files.find((file) => file.path === path);
        if (known) { known.added += Number(added) || 0; known.removed += Number(removed) || 0; continue; }
        at(n).files.push({ path, surface: surface(path), added: Number(added) || 0, removed: Number(removed) || 0, lasted: end.has(path), usedLater });
      }
    }
  }
  return [...changes.values()].sort((a, b) => a.session - b.session);
}

// The ledger as lines to read.
export const told = (changes: Change[]) => changes.map((c) => `s${c.session} ${c.improvement ? 'improvement' : 'work'}: ${
  c.files.map((f) => `${f.surface} ${f.path} +${f.added}−${f.removed}${f.lasted ? '' : ' (gone at the end)'}${f.usedLater ? `, used ${f.usedLater}× later` : ''}`).join('; ') || 'no files'}${c.restores ? `; went back ${c.restores}×` : ''}`);

// The base's own tools, to tell a harness's own tools apart in a record.
export const BARE = new Set(['read', 'write', 'edit', 'bash', 'versions', 'declare', 'assess', 'skill']);

// The eval's own tests of what the tasks asked for, in evals/acceptance/, where the harness cannot see them: a quality
// floor it cannot fake by writing fewer or easier tests.
export function accepts(run: Run, name: string, place?: string): Check {
  const file = fileURLToPath(new URL(`acceptance/${name}.mjs`, import.meta.url));
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { cwd: run.at(place), env: { ...process.env, PROJECT: run.at(place) }, encoding: 'utf8' });
  const out = `${result.stdout}${result.stderr}`;
  const failed = out.split('\n').filter((line) => line.startsWith('not ok')).map((line) => line.replace(/^not ok \d+ - /, ''));
  return check(`what the tasks asked for holds (hidden tests${place ? ` in ${place}` : ''})`, result.status === 0, result.status === 0 ? out.match(/^# pass \d+/m)?.[0] : failed.join('; ') || out.slice(-300));
}

// Whether one of the eval's hidden tests passes, for a requester who reopens a task that does not do what was asked.
export function passing(run: Run, name: string, test: string): boolean {
  const file = fileURLToPath(new URL(`acceptance/${name}.mjs`, import.meta.url));
  const pattern = `^${test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  return spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=${pattern}`, file], { cwd: run.cwd, env: { ...process.env, PROJECT: run.cwd }, encoding: 'utf8' }).status === 0;
}

// Asks a work session to look back at the end, until a harness does that on its own.
export const withRetrospective = (task: string) =>
  `${task} When you are done, write a short retrospective of this task: what went well or badly, and why — as a matter of process or tools.`;

// An improvement session, from the brief the base writes.
export const IMPROVE = { improve: true } as const;
