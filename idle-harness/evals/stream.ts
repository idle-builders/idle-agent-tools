// A stream of the bench: steps in one project, each a task for a new working session, approved or rejected by a
// verifier outside the sandbox the way a human would, with improvement after every so many. On disk it is laid out
// as a Harbor multi-step task (docs/harness/bench.md), built by a source in streams/ into streams/.built/.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BARE, calls, check, IMPROVE } from './scenario.ts';
import type { Scenario, Step, Verdict } from './scenario.ts';

export const STREAMS = fileURLToPath(new URL('streams/', import.meta.url));
export const BUILT = join(STREAMS, '.built');

// The part of TOML a stream uses: tables, arrays of tables, and strings, numbers, booleans and arrays as values.
// A table under an array of tables belongs to its last element, as in Harbor's [steps.verifier].
export function toml(text: string): Record<string, any> {
  const root: Record<string, any> = {};
  const dig = (path: string[]) => path.reduce((node, key) => {
    const next = node[key] ??= {};
    return Array.isArray(next) ? next.at(-1) : next;
  }, root);
  let table = root;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const many = line.match(/^\[\[\s*([\w.-]+)\s*\]\]/);
    if (many) {
      const path = many[1].split('.');
      const parent = dig(path.slice(0, -1));
      (parent[path.at(-1)!] ??= []).push(table = {});
      continue;
    }
    const one = line.match(/^\[\s*([\w.-]+)\s*\]/);
    if (one) { table = dig(one[1].split('.')); continue; }
    const pair = line.match(/^([\w-]+)\s*=\s*(.+)$/);
    if (!pair) throw new Error(`task.toml: cannot read "${line}"`);
    table[pair[1]] = value(pair[2]);
  }
  return root;
}

function value(text: string): unknown {
  const quoted = text.match(/^"((?:[^"\\]|\\.)*)"/) ?? text.match(/^'([^']*)'/);
  if (quoted) return text.startsWith('"') ? JSON.parse(`"${quoted[1]}"`) : quoted[1];
  const bare = text.replace(/\s+#.*$/, '').trim();
  if (bare === 'true' || bare === 'false') return bare === 'true';
  if (bare.startsWith('[')) return JSON.parse(bare.replace(/'([^']*)'/g, (_, s) => JSON.stringify(s)));
  if (!Number.isNaN(Number(bare.replace(/_/g, '')))) return Number(bare.replace(/_/g, ''));
  throw new Error(`task.toml: cannot read the value ${text}`);
}

// Runs a step's verifier on the project, outside the sandbox: the stream's shared tests/, the step's own over them.
export function verify(dir: string, step: string, project: string): Verdict {
  const tests = mkdtempSync(join(tmpdir(), 'eval-verify-'));
  try {
    for (const from of [join(dir, 'tests'), join(dir, 'steps', step, 'tests')]) if (existsSync(from)) cpSync(from, tests, { recursive: true });
    const reward = join(tests, 'reward.json');
    const ran = spawnSync('bash', [join(tests, 'test.sh')], { cwd: project, env: { ...process.env, PROJECT: project, TESTS: tests, REWARD: reward }, encoding: 'utf8', timeout: 300_000 });
    if (!existsSync(reward)) return { reward: 0, feedback: `the check could not run${ran.stderr ? `: ${ran.stderr.slice(-300)}` : ''}` };
    const said = readFileSync(reward, 'utf8').trim();
    const read = /^[\d.]+$/.test(said) ? { reward: Number(said) } : JSON.parse(said);
    return { reward: Number(read.reward) || 0, ...(read.rating ? { rating: Number(read.rating) } : {}), ...(read.feedback ? { feedback: String(read.feedback) } : {}) };
  } finally {
    rmSync(tests, { recursive: true, force: true });
  }
}

// A stream as written by a source: files are path → content.
export type Built = {
  title: string;
  metadata: Record<string, string | number>; // kind, improve_every, reopens, source, licence
  project: Record<string, string>;
  seed?: Record<string, string>;
  tests: Record<string, string>;
  steps: { name: string; instruction: string; tests?: Record<string, string>; min_reward?: number }[];
};

export function write(dir: string, stream: Built) {
  rmSync(dir, { recursive: true, force: true });
  const put = (root: string, files: Record<string, string>) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
  };
  const meta = Object.entries(stream.metadata).map(([key, v]) => `${key} = ${JSON.stringify(v)}`).join('\n');
  const steps = stream.steps.map((s) => `[[steps]]\nname = ${JSON.stringify(s.name)}${s.min_reward === undefined ? '' : `\nmin_reward = ${s.min_reward}`}`).join('\n\n');
  put(dir, { 'task.toml': `[metadata]\ntitle = ${JSON.stringify(stream.title)}\n${meta}\n\n${steps}\n` });
  put(join(dir, 'environment', 'project'), stream.project);
  if (stream.seed) put(join(dir, 'environment', 'seed'), stream.seed);
  put(join(dir, 'tests'), stream.tests);
  for (const step of stream.steps) put(join(dir, 'steps', step.name), { 'instruction.md': `${step.instruction}\n`, ...Object.fromEntries(Object.entries(step.tests ?? {}).map(([p, c]) => [`tests/${p}`, c])) });
}

// The streams there are: a source streams/<name>.ts, or a stream written by hand in streams/<name>/.
export const names = () => readdirSync(STREAMS).flatMap((entry) =>
  entry.endsWith('.ts') ? [entry.slice(0, -3)] : !entry.startsWith('.') && existsSync(join(STREAMS, entry, 'task.toml')) ? [entry] : []);

// A stream's folder, built from its source when it is not there yet.
export async function folder(name: string): Promise<string> {
  const hand = join(STREAMS, name);
  if (existsSync(join(hand, 'task.toml'))) return hand;
  const built = join(BUILT, name);
  if (!existsSync(join(built, 'task.toml'))) {
    process.stderr.write(`building stream ${name}\n`);
    await (await import(join(STREAMS, `${name}.ts`))).default(built);
  }
  return built;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

// A stream as an eval: its first `limit` steps, each reviewed until approved or out of reopenings.
export function stream(dir: string, limit?: number): Scenario {
  const id = basename(dir);
  const task = toml(readFileSync(join(dir, 'task.toml'), 'utf8'));
  const meta = task.metadata ?? {};
  const every = Number(meta.improve_every ?? 0);
  const reopens = Number(meta.reopens ?? 1);
  const all: { name: string; min_reward?: number }[] = (task.steps ?? []).slice(0, limit);
  const least = (i: number) => Number(all[i].min_reward ?? 1);
  const rating = (v: Verdict) => Math.max(1, Math.min(5, Math.round(v.rating ?? 1 + 4 * v.reward)));
  const steps: Step[] = [];
  all.forEach((step, i) => {
    const workdir = join(dir, 'steps', step.name, 'workdir');
    if (existsSync(workdir)) steps.push((run) => cpSync(workdir, run.cwd, { recursive: true }));
    steps.push({ message: readFileSync(join(dir, 'steps', step.name, 'instruction.md'), 'utf8').trim(), task: `${id}-${step.name}` });
    steps.push({
      review(run, n) {
        const said = run.verdicts.get(n) ?? [];
        if (said.length > reopens || said.some((v) => v.reward >= least(i))) return null;
        const verdict = verify(dir, step.name, run.where.get(n) ?? run.cwd);
        run.verdicts.set(n, [...said, verdict]);
        if (verdict.reward >= least(i)) return `/approve ${rating(verdict)}`;
        return said.length < reopens ? `/reject ${verdict.feedback ?? 'it is not right yet.'}` : null;
      },
    });
    if (every && (i + 1) % every === 0 && i + 1 < all.length) steps.push(IMPROVE);
  });
  return {
    id,
    title: String(meta.title ?? id),
    intents: ['I1', 'I3'],
    project: join(dir, 'environment', 'project'),
    minutes: Number(meta.minutes ?? 30),
    seed(run) {
      const seed = join(dir, 'environment', 'seed');
      if (existsSync(seed)) cpSync(seed, run.harness, { recursive: true });
    },
    steps,
    check(run) {
      const working = [...run.sessions.keys()].filter((n) => !run.improvements.has(n)).sort((a, b) => a - b);
      const block = every || 10;
      const blocks = Array.from({ length: Math.ceil(working.length / block) }, (_, b) => working.slice(b * block, (b + 1) * block));
      const verdicts = (n: number) => run.verdicts.get(n) ?? [];
      const approved = (n: number) => verdicts(n).find((v) => v.reward >= least(working.indexOf(n)));
      const cost = (n: number) => run.records(n).reduce((total, entry) => total + (entry.cost ?? 0), 0);
      const own = (ns: number[]) => ns.reduce((total, n) => total + run.records(n).flatMap((entry) => entry.response?.tool_calls ?? []).filter((call: any) => !BARE.has(call.function?.name)).length, 0);
      const open = working.filter((n) => !approved(n));
      const improving = [...run.improvements].reduce((total, n) => total + cost(n), 0);
      const money = (x: number) => (Number.isNaN(x) ? '—' : `$${x.toFixed(4)}`);
      return [
        check('every step approved in the end', open.length === 0, open.length ? `open: ${open.map((n) => all[working.indexOf(n)].name).join(', ')}` : undefined),
        check('approved the first time, block by block', null, blocks.map((b) => `${b.filter((n) => verdicts(n).length === 1 && approved(n)).length} of ${b.length}`).join(' → ')),
        check('cost and model calls per approved step, block by block', null, blocks.map((b) => { const ok = b.filter(approved); return `${money(mean(ok.map(cost)))}, ${mean(ok.map((n) => calls(run.records(n)))).toFixed(1)} calls`; }).join(' → ')),
        check('rating, block by block', null, blocks.map((b) => mean(b.filter(approved).map((n) => rating(approved(n)!))).toFixed(1)).join(' → ')),
        check('what the whole stream cost', null, `${money(working.reduce((total, n) => total + cost(n), 0))} on steps, ${money(improving)} on improvement`),
        check("calls to the harness's own tools, block by block", null, blocks.map(own).join(' → ')),
      ];
    },
  };
}
