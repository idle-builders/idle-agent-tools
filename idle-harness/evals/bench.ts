// What the bench shows: for each stream, its runs in evals/results/ grouped by arm, and what learning saved over the
// frozen floor, improvement included.
//
//   node idle-harness/evals/bench.ts [<stream> …]
//
// Runs compare only with runs of the same length: a pilot of ten steps is its own row. Steps are set against steps of
// their own family, since a stream's order makes some stretches cheaper whether or not anything is learned. The gate
// reads the frozen runs: a step frozen never gets approved, or always gets right the first time for next to nothing,
// shows nothing about learning.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILT, names, STREAMS, toml } from './stream.ts';

const results = fileURLToPath(new URL('results/', import.meta.url));
const wanted = process.argv.slice(2);
const streams = names().filter((name) => !wanted.length || wanted.includes(name));

type Session = { improvement: boolean; cost: number; verdicts?: { reward: number; rating?: number }[] };
type Result = { eval: string; structure: string; seeded: boolean; sessions: Session[]; at: string };

const all: Result[] = existsSync(results) ? readdirSync(results).filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join(results, file), 'utf8'))).filter((r) => streams.includes(r.eval)) : [];

// A stream's steps as its task.toml lists them, when it is built.
function shape(name: string): { every: number; steps: { name: string; family?: string }[] } {
  const file = [join(STREAMS, name, 'task.toml'), join(BUILT, name, 'task.toml')].find(existsSync);
  const task = file ? toml(readFileSync(file, 'utf8')) : {};
  return { every: Number(task.metadata?.improve_every ?? 0), steps: task.steps ?? [] };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const money = (x: number) => (Number.isNaN(x) ? '—' : `$${x.toFixed(3)}`);
const approved = (s: Session) => (s.verdicts ?? []).find((v) => v.reward >= 1);

// One run as the bench reads it: what it cost, step by step, with each improvement charged where it happened.
function read(r: Result) {
  const steps = r.sessions.filter((s) => !s.improvement);
  let total = 0;
  const running: number[] = [];
  for (const s of r.sessions) {
    total += s.cost;
    if (!s.improvement) running.push(total);
  }
  const last = steps.slice(-10);
  return {
    steps: steps.length,
    whole: total,
    improving: r.sessions.filter((s) => s.improvement).reduce((sum, s) => sum + s.cost, 0),
    approved: steps.filter(approved).length / (steps.length || 1),
    rating: mean(steps.map(approved).filter(Boolean).map((v) => Math.round(v!.rating ?? 1 + 4 * v!.reward))),
    lastBlock: mean(last.map((s) => s.cost)),
    running,
    costs: steps.map((s) => s.cost),
    first: steps.map((s) => (s.verdicts ?? [])[0]?.reward >= 1),
    ever: steps.map((s) => Boolean(approved(s))),
  };
}

const percent = (x: number) => `${x > 0 ? '+' : ''}${Math.round(100 * x)}%`;

for (const name of streams) {
  const runs = all.filter((r) => r.eval === name).map((r) => ({ arm: [r.structure, r.seeded ? 'seeded' : ''].filter(Boolean).join(', '), ...read(r) }));
  if (!runs.length) continue;
  const { every, steps } = shape(name);
  process.stdout.write(`${name}\n`);
  for (const length of [...new Set(runs.map((r) => r.steps))].sort((a, b) => b - a)) {
    const same = runs.filter((r) => r.steps === length);
    process.stdout.write(`  ${length} steps\n`);
    process.stdout.write('    arm               runs  whole stream  improvement  approved  rating  per step, last 10\n');
    const arms = [...new Set(same.map((r) => r.arm))];
    for (const arm of arms) {
      const of = same.filter((r) => r.arm === arm);
      process.stdout.write(`    ${arm.padEnd(17)} ${String(of.length).padStart(4)}  ${money(mean(of.map((r) => r.whole))).padStart(12)}  ${money(mean(of.map((r) => r.improving))).padStart(11)}  ${`${Math.round(100 * mean(of.map((r) => r.approved)))}%`.padStart(8)}  ${mean(of.map((r) => r.rating)).toFixed(1).padStart(6)}  ${money(mean(of.map((r) => r.lastBlock))).padStart(17)}\n`);
    }
    const floor = same.filter((r) => r.arm === 'frozen');
    if (!floor.length) continue;
    const curve = (of: typeof same) => Array.from({ length }, (_, i) => mean(of.map((r) => r.running[i])));
    const frozen = curve(floor);
    for (const arm of arms.filter((a) => a !== 'frozen')) {
      const learning = curve(same.filter((r) => r.arm === arm));
      const from = learning.findIndex((_, i) => learning.slice(i).every((cost, j) => cost <= frozen[i + j]));
      process.stdout.write(`    ${arm}: saves ${money(frozen.at(-1)! - learning.at(-1)!)} over frozen, improvement included; ${from < 0 ? 'its running total never stays below frozen' : `below frozen from step ${from + 1} on`}\n`);
      // Family by family, on the steps after the first improvement, where learning could have changed something.
      const after = Math.min(every, length - 1);
      const families = [...new Set(steps.slice(after, length).map((s) => s.family).filter(Boolean))] as string[];
      if (!families.length) continue;
      const per = (of: typeof same, family: string) => mean(steps.slice(0, length).flatMap((s, i) => (i >= after && s.family === family ? of.map((r) => r.costs[i]) : [])));
      process.stdout.write(`      after step ${after}, per step         frozen  ${arm.padStart(8)}  change\n`);
      for (const family of families) {
        const [was, is] = [per(floor, family), per(same.filter((r) => r.arm === arm), family)];
        process.stdout.write(`      ${family.padEnd(24)} ${money(was).padStart(8)}  ${money(is).padStart(8)}  ${percent(is / was - 1).padStart(6)}\n`);
      }
    }
  }
  // The gate, over every frozen run of the stream, a pilot's included: which steps are in the band where learning can show.
  const frozen = runs.filter((r) => r.arm === 'frozen');
  if (!frozen.length) continue;
  const seen = Math.max(...frozen.map((r) => r.costs.length));
  const step = Array.from({ length: seen }, (_, i) => {
    const of = frozen.filter((r) => i < r.costs.length);
    return { name: steps[i]?.name ?? `step ${i + 1}`, cost: mean(of.map((r) => r.costs[i])), ever: of.some((r) => r.ever[i]), first: of.every((r) => r.first[i]), runs: of.length };
  });
  const median = [...step.map((s) => s.cost)].sort((a, b) => a - b)[Math.floor(seen / 2)];
  const reach = step.filter((s) => !s.ever);
  const room = step.filter((s) => s.ever && s.first && s.cost < median / 3);
  const band = seen - reach.length - room.length;
  const passes = reach.length <= seen / 4 && band >= seen / 2;
  process.stdout.write(`  gate, over ${frozen.length} frozen runs: ${band} of ${seen} steps in the band, ${passes ? 'passes' : 'does not pass'}\n`);
  if (reach.length) process.stdout.write(`    out of reach, never approved: ${reach.map((s) => s.name).join(' ')}\n`);
  if (room.length) process.stdout.write(`    no room, right the first time for under ${money(median / 3)}: ${room.map((s) => s.name).join(' ')}\n`);
}
if (!all.length) process.stdout.write('no runs of a stream in evals/results/ yet\n');
