// What improvement learns from, read from a harness's session records every time and never kept: per task, what it
// took to reach a solution the human approved and how they rated it; per control loop — a tool a session built for
// itself — what each version cost and did. Until idle-tasks keeps approvals and ratings, the record's reviews are read.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { harnessDir } from './home.ts';
import { read } from './record.ts';
import { BARE } from './tools.ts';
import * as versions from './versions.ts';
import type { Assessment, Declaration } from './versions.ts';

export type Session = { id: string; entries: any[] };

// Improvement sessions are the platform loop's own work: their cost is kept apart from the tasks'.
export const improving = (session: string) => session.startsWith('improve-');

// Tasks set against one declared change: the ones started before it and the ones started after, by what they took to
// reach approval and how they were rated.
export type Side = { tasks: number; approved: number; toApproval: number | null; rating: number | null };
export type Change = { version: string; at: string; declaration: Declaration; assessments: Assessment[]; before: Side; after: Side };

// What one task took: everything spent while it was the task in hand, across sessions and harness versions. toApproval
// is what it had cost when the human approved it; a rejection reopens it, and the next approval counts. commits are the
// ones its turns started from.
export type TaskTook = {
  task: string; cost: number; turns: number; input: number; cached: number; output: number; sessions: string[]; versions: string[];
  attempts: number; submits: number; rejections: number; approved?: string; toApproval?: number; rating?: number; commits: string[]; first: string; last: string;
};

// One version of a tool a session wrote, in its own layer or in the harness itself, with what it cost to write and
// what it did afterwards.
export type LoopVersion = { tool: string; session: string; where: 'layer' | 'harness'; buildCost: number; lines: number; uses: number; answerChars: number; problems: number; usedIn: string[]; tasks: string[] };

// A tool file in a harness folder, or in a session's layer over it.
const TOOL = /(?:^|\/)harness\/[\w-]+\/(?:\.sessions\/([\w-]+)\/layer\/)?tools\/([\w-]+)\.ts/;

const BARE_NAMES = new Set(BARE.map((tool) => tool.spec.function.name));

// What a tool's answer looks like when it reports a problem, and not when it reports none ("# fail 0").
const PROBLEM = /\bfail(?:ed|s|ure)?\b(?!:? ?0\b)|error\b|mismatch|incomplete|"complete": ?false|not ok|✗|differ|missing|wrong/i;

export function sessions(harness: string): Session[] {
  const dir = join(harnessDir(harness), '.sessions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((id) => ({ id, entries: read(join(dir, id)) })).filter((s) => s.entries.length)
    .sort((a, b) => String(a.entries[0].at).localeCompare(String(b.entries[0].at)));
}

// A change of a task's status in idle-tasks, as a call in the record shows it: the idle command line through bash,
// or an idle tool's arguments.
function taskMove(call: any): { task: string; status: string } | null {
  const name = String(call?.function?.name ?? '');
  const args = String(call?.function?.arguments ?? '');
  let text = args;
  try { const parsed = JSON.parse(args); text = name === 'bash' ? String(parsed.command ?? '') : JSON.stringify(parsed); } catch { /* not JSON */ }
  if (name === 'bash' && !/\bidle\s+task\b/.test(text)) return null;
  if (name !== 'bash' && !/(^|_)(idle|task)$/.test(name)) return null;
  const task = text.match(/--id[ =]+["']?([\w.-]+)/)?.[1] ?? text.match(/"id":\s*"([\w.-]+)"/)?.[1];
  const status = text.match(/--status[ =]+["']?(\w+)/)?.[1] ?? text.match(/"status":\s*"(\w+)"/)?.[1];
  return task && status ? { task, status } : null;
}

// Which task each turn belongs to: the task the session was started for, or the one it claimed, until it submits or
// lets it go. Turns with no task are unattributed and stay so.
export function attribute(all: Session[]): { tasks: TaskTook[]; unattributed: { cost: number; turns: number; sessions: string[] }; platform: { cost: number; sessions: string[] } } {
  const tasks = new Map<string, TaskTook>();
  const unattributed = { cost: 0, turns: 0, sessions: new Set<string>() };
  const platform = { cost: 0, sessions: [] as string[] };
  const at = (task: string, when: string) => tasks.get(task) ?? tasks.set(task, { task, cost: 0, turns: 0, input: 0, cached: 0, output: 0, sessions: [], versions: [], attempts: 0, submits: 0, rejections: 0, commits: [], first: when, last: when }).get(task)!;
  for (const session of all) {
    if (improving(session.id)) {
      platform.cost += session.entries.reduce((sum, entry) => sum + (entry.cost ?? 0), 0);
      platform.sessions.push(session.id);
      continue;
    }
    const bound: string | undefined = session.entries[0]?.task; // the task the session was started for, if any
    let current = bound;
    let submitted: string | undefined; // the task this session last handed in, which a review without a task is for
    if (current) at(current, session.entries[0].at).attempts++;
    for (const entry of session.entries) {
      const holder = current;
      // A review arrives before the turn that reads it, so what that turn costs comes after the approval.
      for (const { at: when, review } of (entry.arrived ?? []).filter((item: any) => item?.review)) {
        const task = review.task ?? current ?? submitted;
        if (!task) continue;
        const took = at(task, when);
        if (review.verdict === 'rejected') { took.rejections++; delete took.approved; delete took.toApproval; }
        if (review.verdict === 'approved' && !took.approved) { took.approved = when; took.toApproval = took.cost; }
        if (review.rating) took.rating = review.rating;
      }
      const moves = (entry.response?.tool_calls ?? []).map(taskMove).filter(Boolean) as { task: string; status: string }[];
      for (const move of moves.filter((m) => m.status === 'claimed' && m.task !== current)) { current = move.task; at(current, entry.at).attempts++; }
      const charged = current ?? holder;
      const cost = entry.cost ?? 0;
      if (!charged) {
        unattributed.cost += cost;
        if (entry.usage) unattributed.turns++;
        unattributed.sessions.add(session.id);
      } else {
        const took = at(charged, entry.at);
        took.cost += cost;
        if (entry.usage) took.turns++;
        took.input += entry.usage?.prompt_tokens ?? 0;
        took.cached += entry.usage?.prompt_tokens_details?.cached_tokens ?? 0;
        took.output += entry.usage?.completion_tokens ?? 0;
        if (!took.sessions.includes(session.id)) took.sessions.push(session.id);
        if (entry.version && !took.versions.includes(entry.version)) took.versions.push(entry.version);
        if (entry.work?.commit && !took.commits.includes(entry.work.commit)) took.commits.push(entry.work.commit);
        took.last = entry.at;
      }
      for (const move of moves) {
        if (move.status === 'submitted') { at(move.task, entry.at).submits++; submitted = move.task; }
        // Submitted or let go: the session is back on the task it was started for, or on none.
        if (move.task === current && ['submitted', 'open', 'blocked', 'done', 'archived'].includes(move.status)) current = bound === move.task ? undefined : bound;
      }
    }
  }
  return { tasks: [...tasks.values()], unattributed: { cost: unattributed.cost, turns: unattributed.turns, sessions: [...unattributed.sessions] }, platform };
}

// Every version of every tool the sessions wrote: a session that writes tools/<name>.ts makes a version of it, and the
// calls to that tool until the next version count for it. A session's calls go to its own layer's version first.
export function controlLoops(all: Session[]): LoopVersion[] {
  const { tasks } = attribute(all);
  const taskOf = (session: string) => tasks.filter((t) => t.sessions.includes(session)).map((t) => t.task);
  const versions: LoopVersion[] = [];
  const latest = new Map<string, LoopVersion>();
  for (const session of all) {
    for (const entry of session.entries) {
      for (const call of entry.calls ?? []) {
        if (call.block !== 'tool') continue;
        const name = String(call.call?.function?.name ?? '');
        const args = String(call.call?.function?.arguments ?? '');
        const found = args.match(TOOL);
        const path = found?.[2];
        if ((name === 'write' || name === 'edit') && path) {
          const key = found![1] ? `${found![1]}:${path}` : path;
          let version = latest.get(key);
          if (!version || version.session !== session.id) {
            version = { tool: path, session: session.id, where: found![1] ? 'layer' : 'harness', buildCost: 0, lines: 0, uses: 0, answerChars: 0, problems: 0, usedIn: [], tasks: [] };
            versions.push(version);
            latest.set(key, version);
          }
          version.buildCost += entry.cost ?? 0;
          if (name === 'write') try { version.lines = String(JSON.parse(args).content ?? '').split('\n').length; } catch { /* not JSON */ }
        }
        const version = name && !BARE_NAMES.has(name) ? latest.get(`${session.id}:${name}`) ?? latest.get(name) : undefined;
        if (!version) continue;
        version.uses++;
        version.answerChars += String(call.result ?? '').length;
        if (PROBLEM.test(String(call.result ?? ''))) version.problems++;
        if (!version.usedIn.includes(session.id)) version.usedIn.push(session.id);
      }
    }
  }
  for (const version of versions) version.tasks = [...new Set(version.usedIn.flatMap(taskOf))];
  return versions;
}

// How often each skill was loaded, in how many sessions: what fires on nearly every task belongs in the core.
export function skillUses(all: Session[]): { skill: string; loads: number; sessions: number }[] {
  const uses = new Map<string, { loads: number; sessions: Set<string> }>();
  for (const session of all) {
    for (const call of session.entries.flatMap((e) => e.calls ?? [])) {
      if (call?.block !== 'tool' || call.call?.function?.name !== 'skill') continue;
      let name = '';
      try { name = String(JSON.parse(call.call.function.arguments).name ?? ''); } catch { /* not JSON */ }
      const use = name && (uses.get(name) ?? uses.set(name, { loads: 0, sessions: new Set() }).get(name)!);
      if (!use) continue;
      use.loads++;
      use.sessions.add(session.id);
    }
  }
  return [...uses].map(([skill, use]) => ({ skill, loads: use.loads, sessions: use.sessions.size })).sort((a, b) => b.loads - a.loads);
}

// What each working session's layer holds now, by path: the same path in several layers is the same kind of thing
// built again, which improvement compares.
export function layers(harness: string): { path: string; built: { session: string; lines: number; file: string }[] }[] {
  const byPath = new Map<string, { session: string; lines: number; file: string }[]>();
  const folder = join(harnessDir(harness), '.sessions');
  for (const session of existsSync(folder) ? readdirSync(folder).filter((id) => !improving(id)).sort() : []) {
    const layer = join(folder, session, 'layer');
    if (!existsSync(layer)) continue;
    for (const path of readdirSync(layer, { recursive: true }).map(String).filter((p) => !p.startsWith('.git') && statSync(join(layer, p)).isFile()).sort()) {
      const file = join(layer, path);
      (byPath.get(path) ?? byPath.set(path, []).get(path)!).push({ session, lines: readFileSync(file, 'utf8').split('\n').length, file });
    }
  }
  return [...byPath].map(([path, built]) => ({ path, built })).sort((a, b) => b.built.length - a.built.length || a.path.localeCompare(b.path));
}

// Per version of the harness: how many turns ran on it and what they cost.
export function byVersion(all: Session[]): { version: string; turns: number; cost: number; first: string }[] {
  const out = new Map<string, { version: string; turns: number; cost: number; first: string }>();
  for (const entry of all.flatMap((s) => s.entries)) {
    if (!entry.version) continue;
    const row = out.get(entry.version) ?? out.set(entry.version, { version: entry.version, turns: 0, cost: 0, first: entry.at }).get(entry.version)!;
    if (entry.usage) row.turns++;
    row.cost += entry.cost ?? 0;
  }
  return [...out.values()].sort((a, b) => a.first.localeCompare(b.first));
}

// Every declared change, with the tasks before and after it. Noise is real: a trend over many tasks counts, not one.
export function changes(harness: string, tasks: TaskTook[]): Change[] {
  const side = (list: TaskTook[]): Side => {
    const approved = list.filter((t) => t.approved);
    const rated = approved.filter((t) => t.rating);
    const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
    return { tasks: list.length, approved: approved.length, toApproval: mean(approved.map((t) => t.toApproval ?? 0)), rating: mean(rated.map((t) => t.rating!)) };
  };
  return versions.history(harnessDir(harness)).flatMap((v) => v.declarations.map((declaration) => ({
    version: v.version, at: v.at, declaration, assessments: v.assessments,
    before: side(tasks.filter((t) => t.first < v.at)), after: side(tasks.filter((t) => t.first >= v.at)),
  })));
}

// Versions working sessions saved without saying why: changes improvement has yet to judge.
export const undeclared = (harness: string) => versions.history(harnessDir(harness)).filter((v) => !v.declarations.length && / turn \d+$/.test(v.why));

// The whole reading, for the human: as text, or as JSON for whatever reads it next.
export function report(harness: string, json = false): string {
  const all = sessions(harness);
  const { tasks, unattributed, platform } = attribute(all);
  const loops = controlLoops(all);
  const versions = byVersion(all);
  const declared = changes(harness, tasks);
  const skills = skillUses(all);
  const built = layers(harness);
  const loose = undeclared(harness);
  if (json) return JSON.stringify({ harness, tasks, unattributed, platform, loops, layers: built, skills, versions, changes: declared, undeclared: loose }, null, 2);
  const money = (n: number) => `$${n.toFixed(4)}`;
  const share = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : '-');
  const sided = (side: Side) => `${side.tasks} tasks, ${side.approved} approved${side.toApproval === null ? '' : ` for ${money(side.toApproval)} each`}${side.rating === null ? '' : `, rated ${side.rating.toFixed(1)}`}`;
  return [
    `${harness}: ${all.length} sessions, ${money(all.flatMap((s) => s.entries).reduce((t, e) => t + (e.cost ?? 0), 0))}`,
    '',
    'Tasks — what each took while it was the task in hand, and what it took to reach your approval',
    ...tasks.map((t) => `  ${t.task}: ${t.approved ? `approved for ${money(t.toApproval ?? 0)}${t.rating ? `, rated ${t.rating}` : ', not rated'}` : 'not approved'}${t.rejections ? ` after ${t.rejections} rejections` : ''} · ${money(t.cost)}, ${t.turns} turns, ${share(t.cached, t.input)} of input cached, ${t.sessions.length} sessions, ${t.attempts} attempts, ${t.submits} submits, ${t.versions.length} harness versions, ${t.commits.length} commits`),
    `  unattributed: ${money(unattributed.cost)}, ${unattributed.turns} turns in ${unattributed.sessions.length} sessions`,
    '',
    'Control loops — every version of a tool a session built',
    ...(loops.length ? loops.map((l) => `  ${l.tool} from ${l.session}${l.where === 'layer' ? "'s layer" : ', in the harness'}: ${l.lines || '?'} lines, ${money(l.buildCost)} to build, used ${l.uses}×${l.uses ? ` (answers ${Math.round(l.answerChars / l.uses)} characters, ${l.problems} reporting a problem)` : ''}${l.tasks.length ? `, for ${l.tasks.join(', ')}` : ''}`) : ['  none']),
    '',
    "Layers — what working sessions built for themselves, by path; the same path in several layers is the same kind of thing built again",
    ...(built.length ? built.map((b) => `  ${b.path}: ${b.built.map((x) => `${x.session} (${x.lines} lines)`).join(', ')}`) : ['  none']),
    '',
    `Skills — loaded how often, of ${all.length - platform.sessions.length} working sessions`,
    ...(skills.length ? skills.map((k) => `  ${k.skill}: ${k.loads} loads in ${k.sessions} sessions`) : ['  none']),
    '',
    'Harness versions',
    ...versions.map((v) => `  ${v.version}: ${v.turns} turns, ${money(v.cost)}`),
    '',
    'Declared changes — the tasks started before and after each',
    ...(declared.length ? declared.flatMap((c) => [
      `  ${c.version} (${c.declaration.scope}) ${c.declaration.change} — expects: ${c.declaration.expect}`,
      `    before: ${sided(c.before)} · after: ${sided(c.after)}${c.assessments.length ? ` · assessed ${c.assessments.at(-1)!.verdict}: ${c.assessments.at(-1)!.signals}` : ''}`,
    ]) : ['  none']),
    `  undeclared versions from working sessions: ${loose.length ? loose.map((v) => v.version).join(', ') : 'none'}`,
    '',
    `Improvement: ${platform.sessions.length} sessions, ${money(platform.cost)}`,
  ].join('\n');
}
