// seq-gen — seq-lab's families with no LAB-Bench in them. The questions grow from a seed in projects/seq-gen/, a
// library of generated sequences and an enzyme table; each family is a template whose parameters set how hard it is,
// and every right answer is computed by the reference in fixtures/seq.ts. Four rounds of the ten families, then one
// held-out question of each on sequences the stream has not shown. The variants in seq-gen-*.ts ask the same
// questions in other orders, or shift halfway to new sequences and a new supplier's enzyme table.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { amplicon, cloning, cuts, design, digest, fasta, gc, longest, orfs, random, reverse, table } from '../fixtures/seq.ts';
import type { Enzyme, Rules } from '../fixtures/seq.ts';
import { write } from '../stream.ts';

const SEED = fileURLToPath(new URL('../projects/seq-gen/', import.meta.url));
const ROUNDS = 4;

type Lab = { seqs: { file: string; dna: string }[]; enzymes: Enzyme[] };
type Ask = { text: string; want: Record<string, unknown> } | undefined;
type Range = [number, number];

const family = <T extends { length: Range }>(name: string, tune: T, ask: (r: () => number, lab: Lab, t: T) => Ask) => ({ name, tune, ask });
const between = (r: () => number, [lo, hi]: Range) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: () => number, list: T[]) => list[Math.floor(r() * list.length)];
function shuffled<T>(r: () => number, list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const sequence = (r: () => number, lab: Lab, [lo, hi]: Range) => pick(r, lab.seqs.filter((s) => s.dna.length >= lo && s.dna.length <= hi));
const listed = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

// All of a sequence, or with the chance given a stretch of it.
function part(r: () => number, s: Lab['seqs'][number], chance: number) {
  if (r() >= chance) return { dna: s.dna, where: s.file };
  const n = Math.floor(s.dna.length * (0.4 + 0.4 * r()));
  const from = 1 + Math.floor(r() * (s.dna.length - n));
  return { dna: s.dna.slice(from - 1, from - 1 + n), where: `bases ${from} to ${from + n - 1} of ${s.file}` };
}

// A stretch to amplify, and the primers the reference finds for it.
function region(r: () => number, dna: string, product: Range, rules: Rules) {
  const n = Math.min(between(r, product), dna.length);
  const from = 1 + Math.floor(r() * (dna.length - n + 1));
  const primers = design(dna, from, from + n - 1, rules);
  return primers && { from, to: from + n - 1, ...primers };
}

const digesting = (r: () => number, lab: Lab, dna: string, t: { enzymes: Range; cuts: Range }) => {
  const enzymes = shuffled(r, lab.enzymes).slice(0, between(r, t.enzymes));
  const n = cuts(dna, enzymes).length;
  return n >= t.cuts[0] && n <= t.cuts[1] ? enzymes : undefined;
};

const rules = (t: { rules: Rules }) => `each anneals with all of its ${t.rules.length[0]}–${t.rules.length[1]} bases, just once on the template, with a Tm of ${t.rules.tm[0]}–${t.rules.tm[1]} °C`;
const clamp = (r: () => number) => Array.from({ length: between(r, [2, 4]) }, () => pick(r, [...'ACGT'])).join('');

// The families, as in seq-lab, each with the parameters that make it harder or easier; length is how long the
// sequences it draws on are.
const FAMILIES = [
  family('ORF-seq-AAid', { length: [600, 2400] as Range, region: 0.5 }, (r, lab, t) => {
    const { dna, where } = part(r, sequence(r, lab, t.length), t.region);
    const orf = longest(dna);
    if (!orf) return;
    const n = between(r, [1, orf.protein.length]);
    return { text: `What is the amino acid at position ${n} of the protein of the longest ORF in ${where}?`, want: { kind: 'aa', truth: orf.protein[n - 1] } };
  }),
  family('ORF-seq-AAseq', { length: [600, 2400] as Range, region: 0.5 }, (r, lab, t) => {
    const { dna, where } = part(r, sequence(r, lab, t.length), t.region);
    const orf = longest(dna);
    return orf && { text: `What is the protein of the longest ORF in ${where}?`, want: { kind: 'protein', truth: orf.protein } };
  }),
  family('ORF-seq-numlen', { length: [600, 2400] as Range, region: 0.5, above: [60, 120] as Range }, (r, lab, t) => {
    const { dna, where } = part(r, sequence(r, lab, t.length), t.region);
    const above = between(r, t.above);
    return { text: `How many ORFs in ${where} encode a protein longer than ${above} amino acids?`, want: { kind: 'count', truth: orfs(dna).filter((o) => o.protein.length > above).length } };
  }),
  family('Prop-seq-gcpercent', { length: [600, 2400] as Range, region: 0.5 }, (r, lab, t) => {
    const { dna, where } = part(r, sequence(r, lab, t.length), t.region);
    return { text: `What is the GC content of ${where}, in percent to one decimal?`, want: { kind: 'percent', truth: gc(dna) } };
  }),
  family('RE-seq-numfrags', { length: [600, 2400] as Range, enzymes: [1, 3] as Range, cuts: [1, 8] as Range }, (r, lab, t) => {
    const s = sequence(r, lab, t.length);
    const enzymes = digesting(r, lab, s.dna, t);
    return enzymes && { text: `How many fragments does a digest of ${s.file} with ${listed(enzymes.map((e) => e.name))} give?`, want: { kind: 'count', truth: digest(s.dna, enzymes).length } };
  }),
  family('RE-seq-lenfrags', { length: [600, 2400] as Range, enzymes: [1, 2] as Range, cuts: [2, 6] as Range }, (r, lab, t) => {
    const s = sequence(r, lab, t.length);
    const enzymes = digesting(r, lab, s.dna, t);
    return enzymes && { text: `What fragment lengths does a digest of ${s.file} with ${listed(enzymes.map((e) => e.name))} give, in order from base 1?`, want: { kind: 'lengths', truth: digest(s.dna, enzymes) } };
  }),
  family('PCR-primers-len', { length: [600, 3000] as Range, product: [150, 900] as Range, rules: { length: [18, 25], tm: [52, 66] } as Rules, tails: 0.5 }, (r, lab, t) => {
    const s = sequence(r, lab, t.length);
    const got = region(r, s.dna, t.product, t.rules);
    if (!got) return;
    const tail = () => (r() < t.tails ? clamp(r) + pick(r, cloning(lab.enzymes)).site : '');
    const pair = [tail() + got.forward, tail() + got.reverse];
    if (r() < 0.5) pair.reverse();
    const length = amplicon(s.dna, pair[0], pair[1]);
    return length === null ? undefined : { text: `What is the length of the PCR product of the primers ${pair[0]} and ${pair[1]} on ${s.file}?`, want: { kind: 'length', truth: length } };
  }),
  family('PCR-len-primers', { length: [600, 3000] as Range, product: [150, 900] as Range, rules: { length: [18, 25], tm: [52, 66] } as Rules, pairs: 6 }, (r, lab, t) => {
    const s = sequence(r, lab, t.length);
    const got = region(r, s.dna, t.product, t.rules);
    if (!got) return;
    const length = got.to - got.from + 1;
    const pairs = [[got.forward, got.reverse], [got.forward, reverse(got.reverse)]];
    for (let tries = 0; pairs.length < t.pairs && tries < 200; tries++) {
      const other = region(r, s.dna, t.product, t.rules);
      if (other && Math.abs(other.to - other.from + 1 - length) >= 20) pairs.push([other.forward, other.reverse]);
    }
    const shown = shuffled(r, pairs);
    if (shown.length < t.pairs || shown.filter(([a, b]) => amplicon(s.dna, a, b) === length).length !== 1) return;
    const truth = `P${shown.findIndex(([a, b]) => amplicon(s.dna, a, b) === length) + 1}`;
    return { text: `Which of these primer pairs gives a ${length} bp product from ${s.file}?\n\n${shown.map(([a, b], i) => `P${i + 1}: ${a}, ${b}`).join('\n')}`, want: { kind: 'pair', truth } };
  }),
  family('PCR-seq-primers', { length: [600, 3000] as Range, product: [150, 900] as Range, rules: { length: [18, 25], tm: [56, 64] } as Rules }, (r, lab, t) => {
    const s = sequence(r, lab, t.length);
    const got = region(r, s.dna, t.product, t.rules);
    return got && {
      text: `Design primers that amplify exactly bases ${got.from} to ${got.to} of ${s.file}: ${rules(t)}.`,
      want: { kind: 'design', template: s.dna, from: got.from, to: got.to, rules: t.rules, example: { forward: got.forward, reverse: got.reverse } },
    };
  }),
  family('PCR-seq-enzprimers', { length: [600, 3000] as Range, product: [300, 900] as Range, rules: { length: [18, 25], tm: [56, 64] } as Rules, candidates: 4 }, (r, lab, t) => {
    const s = sequence(r, lab, t.length);
    const got = region(r, s.dna, t.product, t.rules);
    if (!got) return;
    const insert = s.dna.slice(got.from - 1, got.to);
    const [cutting, not] = [cloning(lab.enzymes).filter((e) => insert.includes(e.site)), cloning(lab.enzymes).filter((e) => !insert.includes(e.site))].map((list) => shuffled(r, list));
    if (cutting.length < t.candidates - 2 || not.length < 2) return;
    const enzymes = shuffled(r, [...not.slice(0, 2), ...cutting.slice(0, t.candidates - 2)]);
    return {
      text: `I want to clone bases ${got.from} to ${got.to} of ${s.file} by restriction and ligation, with two of ${listed(enzymes.map((e) => e.name))}. Neither may cut the insert, and each primer carries the site of a different one: up to six bases, then the site, then the part that anneals at an end of the insert. Design the primers; for the annealing parts, ${rules(t)}.`,
      want: { kind: 'clone', template: s.dna, from: got.from, to: got.to, rules: t.rules, enzymes: enzymes.map(({ name, site }) => ({ name, site })), example: { forward: `GC${not[0].site}${got.forward}`, reverse: `GC${not[1].site}${got.reverse}` } },
    };
  }),
];

// The verifier: the answer in answers/<id>.json against the right one, or for primers against the rules. It says
// what failed, never the answer.
const CHECK = `import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const id = process.argv[2];
const want = JSON.parse(readFileSync(join(process.env.TESTS ?? '/tests', 'answers.json'), 'utf8'))[id];
const file = 'answers/' + id + '.json';
let given;
try { given = JSON.parse(readFileSync(file, 'utf8')); } catch {}
const primers = want.kind === 'design' || want.kind === 'clone';
const answer = primers ? given : given?.answer;
const DNA = { A: 'T', C: 'G', G: 'C', T: 'A' };
const reverse = (s) => [...s].reverse().map((b) => DNA[b]).join('');
const count = (s, part) => { let n = 0; for (let i = s.indexOf(part); i >= 0; i = s.indexOf(part, i + 1)) n++; return n; };
const tm = (p) => [...p].reduce((sum, b) => sum + (b === 'G' || b === 'C' ? 4 : 2), 0);
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/[%\\s]/g, '')) : NaN);
const text = (v) => (typeof v === 'string' ? v.replace(/\\s/g, '').toUpperCase() : undefined);

function judge() {
  if (answer === undefined || answer === null) return 'There is no answer in ' + file + '.';
  const form = 'The answer in ' + file + ' is not in the form answers/README.md asks for.';
  const wrong = 'The lab checked your answer in ' + file + ' and it is not right. Look into it again.';
  const { kind, truth } = want;
  if (kind === 'aa' || kind === 'pair' || kind === 'protein') {
    const a = text(answer)?.replace(/\\*$/, '');
    return !a || !(kind === 'aa' ? /^[A-Z]$/ : kind === 'pair' ? /^P\\d+$/ : /^[A-Z]+$/).test(a) ? form : a === truth ? null : wrong;
  }
  if (kind === 'count' || kind === 'length') { const a = num(answer); return !Number.isInteger(a) ? form : a === truth ? null : wrong; }
  if (kind === 'percent') { const a = num(answer); return !Number.isFinite(a) ? form : Math.abs(a - truth) <= 0.0501 ? null : wrong; }
  if (kind === 'lengths') { const a = Array.isArray(answer) ? answer.map(num) : []; return !a.length || !a.every(Number.isInteger) ? form : a.join() === truth.join() ? null : wrong; }
  const [f, r] = [text(answer.forward), text(answer.reverse)];
  if (!f || !r || !/^[ACGT]+$/.test(f + r)) return form;
  const t = want.template;
  const [lo, hi] = want.rules.length;
  const [low, high] = want.rules.tm;
  const region = kind === 'clone' ? 'insert' : 'region';
  const starts = (n) => t.slice(want.from - 1, want.from - 1 + n);
  const ends = (n) => reverse(t.slice(Math.max(0, want.to - n), want.to));
  const fault = (which, part, end) => part !== end(part.length) ? 'The ' + which + ' primer does not anneal at the ' + (which === 'forward' ? 'start' : 'end') + ' of the ' + region + '.'
    : part.length < lo || part.length > hi ? 'The annealing part of the ' + which + ' primer is not ' + lo + '–' + hi + ' bases.'
    : tm(part) < low || tm(part) > high ? 'The Tm of the ' + which + ' primer is not ' + low + '–' + high + ' °C.'
    : count(t, part) + count(reverse(t), part) !== 1 ? 'The ' + which + ' primer anneals more than once on the template.' : null;
  if (kind === 'design') return fault('forward', f, starts) ?? fault('reverse', r, ends);
  const read = (which, p, end) => {
    const ways = want.enzymes.flatMap((e) => [0, 1, 2, 3, 4, 5, 6].filter((k) => p.startsWith(e.site, k)).map((k) => ({ enzyme: e, fault: fault(which, p.slice(k + e.site.length), end) })));
    return ways.find((w) => !w.fault) ?? ways[0] ?? { fault: 'The ' + which + ' primer does not carry the site of one of the enzymes after at most six bases.' };
  };
  const [a, b] = [read('forward', f, starts), read('reverse', r, ends)];
  if (a.fault || b.fault) return a.fault ?? b.fault;
  if (a.enzyme.name === b.enzyme.name) return 'Both primers carry the site of ' + a.enzyme.name + '.';
  const cutter = [a.enzyme, b.enzyme].find((e) => t.slice(want.from - 1, want.to).includes(e.site));
  return cutter ? cutter.name + ' cuts the insert.' : null;
}

const said = judge();
writeFileSync(process.env.REWARD ?? '/logs/verifier/reward.json', JSON.stringify(said ? { reward: 0, feedback: said } : { reward: 1 }));
`;

// The files under a folder of the seed, path → content.
const files = (dir: string): Record<string, string> => Object.fromEntries(readdirSync(join(SEED, dir), { recursive: true, encoding: 'utf8' })
  .filter((path) => statSync(join(SEED, dir, path)).isFile() && !path.startsWith('later')).map((path) => [path, readFileSync(join(SEED, dir, path), 'utf8')]));

function lab(dir: string, enzymes: string): Lab {
  const seqs = Object.entries(files(dir)).filter(([path]) => path.startsWith('library/')).sort().map(([file, text]) => ({ file, dna: fasta(text) }));
  return { seqs, enzymes: table(readFileSync(join(SEED, enzymes), 'utf8')) };
}

// order: round by round as seq-lab, family by family, or shuffled. shift: halfway, new sequences and a new enzyme
// table. held: a held-out question of each family after the stream. tune: a family's parameters, over its own.
export type Options = { seed?: number; order?: 'rounds' | 'families' | 'shuffled'; shift?: boolean; held?: boolean; tune?: Record<string, object> };

export function build(dir: string, { seed = 1, order = 'rounds', shift = false, held = true, tune = {} }: Options = {}) {
  const start = lab('.', 'enzymes.tsv');
  const later = shift ? lab('later/shift', 'later/shift/enzymes.tsv') : start;
  const unseen = { seqs: lab('later/held', 'enzymes.tsv').seqs, enzymes: later.enzymes };
  const question = (f: number, round: number, on: Lab) => {
    const { name, tune: own, ask } = FAMILIES[f];
    const r = random(seed * 1009 + f * 31 + round);
    for (let tries = 0; tries < 2000; tries++) {
      const got = ask(r, on, { ...own, ...tune[name] } as any);
      if (got) return { family: name, ...got };
    }
    throw new Error(`seq-gen: ${name} found no question with these parameters`);
  };
  const slots = FAMILIES.flatMap((_, f) => Array.from({ length: ROUNDS }, (_, round) => ({ f, round })));
  const ordered = order === 'families' ? slots : order === 'shuffled' ? shuffled(random(seed), slots) : [...slots].sort((a, b) => a.round - b.round || a.f - b.f);
  const half = slots.length / 2;
  const asked = [
    ...ordered.map(({ f, round }, i) => ({ ...question(f, round, i < half ? start : later), workdir: shift && i === half ? files('later/shift') : undefined })),
    ...(held ? FAMILIES.map((_, f) => ({ ...question(f, ROUNDS, unseen), workdir: f === 0 ? files('later/held') : undefined })) : []),
  ];
  const answers: Record<string, unknown> = {};
  const steps = asked.map(({ family, text, want, workdir }, i) => {
    const name = `q${String(i + 1).padStart(2, '0')}`;
    answers[name] = want;
    return {
      name,
      family,
      instruction: `Question ${name}: ${text}\n\nWrite your answer to answers/${name}.json as answers/README.md says.`,
      tests: { 'test.sh': `node "\${TESTS:-/tests}/check.mjs" ${name}\n` },
      ...(workdir ? { workdir } : {}),
    };
  });
  write(dir, {
    title: 'a sequence lab grown from a seed: ORFs, primers, digests',
    metadata: { kind: 'molecular biology', improve_every: 10, reopens: 1, source: 'generated, idle-harness seq-gen', seed, order, shift: shift ? 'halfway' : 'none', held: held ? FAMILIES.length : 0 },
    project: files('.'),
    tests: { 'check.mjs': CHECK, 'answers.json': JSON.stringify(answers) },
    steps,
  });
}

export default (dir: string) => build(dir);
