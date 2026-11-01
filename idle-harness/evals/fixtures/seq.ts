// The sequence lab of seq-gen: a reference for what its questions ask — ORFs, GC, digests, PCR — and the seed they
// grow from, a library of generated sequences and two enzyme tables, planted once into projects/seq-gen/ and committed:
//
//   node -e "import('./idle-harness/evals/fixtures/seq.ts').then((m) => m.plant())"
//
// Every right answer of the stream is computed here, never by a model.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A small seeded random number generator (mulberry32).
export function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N' };
const IUPAC: Record<string, string> = { A: 'A', C: 'C', G: 'G', T: 'T', R: '[AG]', Y: '[CT]', S: '[CG]', W: '[AT]', K: '[GT]', M: '[AC]', B: '[CGT]', D: '[AGT]', H: '[ACT]', V: '[ACG]', N: '[ACGT]' };
const CODE = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG'; // codons in TCAG order
const STOPS = new Set(['TAA', 'TAG', 'TGA']);

export const reverse = (dna: string) => [...dna].reverse().map((b) => COMPLEMENT[b]).join('');
export const translate = (dna: string) => (dna.match(/.{3}/g) ?? []).map((c) => CODE[[...c].reduce((i, b) => i * 4 + 'TCAG'.indexOf(b), 0)]).join('');

// An ORF on one strand: from its ATG to after its stop, 0-based along that strand.
export type Orf = { strand: 1 | -1; start: number; end: number; protein: string };

export function orfs(dna: string): Orf[] {
  const found: Orf[] = [];
  for (const [strand, s] of [[1, dna], [-1, reverse(dna)]] as const) {
    for (let frame = 0; frame < 3; frame++) {
      let start = -1;
      for (let i = frame; i + 3 <= s.length; i += 3) {
        const codon = s.slice(i, i + 3);
        if (start < 0 && codon === 'ATG') start = i;
        else if (start >= 0 && STOPS.has(codon)) {
          found.push({ strand, start, end: i + 3, protein: translate(s.slice(start, i)) });
          start = -1;
        }
      }
    }
  }
  return found;
}

// The longest ORF, when one is longer than every other.
export function longest(dna: string): Orf | undefined {
  const [first, second] = orfs(dna).sort((a, b) => b.protein.length - a.protein.length);
  return first && (!second || first.protein.length > second.protein.length) ? first : undefined;
}

export const gc = (dna: string) => (100 * (dna.match(/[GC]/g)?.length ?? 0)) / dna.length;

// An enzyme cuts the top strand after `cut` bases of its site. Every site here reads the same on both strands.
export type Enzyme = { name: string; site: string; cut: number };

export const sites = (dna: string, site: string) => [...dna.matchAll(new RegExp(`(?=${[...site].map((b) => IUPAC[b]).join('')})`, 'g'))].map((m) => m.index);

export function cuts(dna: string, enzymes: Enzyme[]): number[] {
  const at = enzymes.flatMap((e) => sites(dna, e.site).map((i) => i + e.cut)).filter((p) => p > 0 && p < dna.length);
  return [...new Set(at)].sort((a, b) => a - b);
}

export const digest = (dna: string, enzymes: Enzyme[]) => [0, ...cuts(dna, enzymes), dna.length].slice(1).map((p, i, all) => p - (i ? all[i - 1] : 0));

export const tm = (primer: string) => [...primer].reduce((t, b) => t + (b === 'G' || b === 'C' ? 4 : 2), 0);

const count = (dna: string, part: string) => sites(dna, part).length;
export const once = (dna: string, part: string) => count(dna, part) + count(reverse(dna), part) === 1;

// Where a primer anneals: its longest 3' end of 15 bases or more found on the template, if found just once.
function anneal(dna: string, primer: string) {
  for (let k = primer.length; k >= 15; k--) {
    const end = primer.slice(-k);
    const top = sites(dna, end);
    const bottom = sites(reverse(dna), end);
    if (top.length + bottom.length > 1) return undefined;
    if (top.length) return { strand: 1, at: top[0], k, tail: primer.length - k };
    if (bottom.length) return { strand: -1, at: dna.length - bottom[0] - k, k, tail: primer.length - k };
  }
  return undefined;
}

// The length of the PCR product of two primers, tails included, or null when they make none.
export function amplicon(dna: string, one: string, other: string): number | null {
  const [a, b] = [anneal(dna, one), anneal(dna, other)];
  if (!a || !b || a.strand === b.strand) return null;
  const [f, r] = a.strand === 1 ? [a, b] : [b, a];
  return f.at <= r.at ? r.at + r.k - f.at + f.tail + r.tail : null;
}

export type Rules = { length: [number, number]; tm: [number, number] };

// The shortest primers that amplify exactly bases `from` to `to` (1-based) and keep the rules, when there are any.
export function design(dna: string, from: number, to: number, rules: Rules): { forward: string; reverse: string } | undefined {
  const fits = (p: string) => p.length >= rules.length[0] && tm(p) >= rules.tm[0] && tm(p) <= rules.tm[1] && once(dna, p);
  const lengths = Array.from({ length: rules.length[1] - rules.length[0] + 1 }, (_, i) => rules.length[0] + i);
  const forward = lengths.map((n) => dna.slice(from - 1, from - 1 + n)).find(fits);
  const back = lengths.map((n) => reverse(dna.slice(Math.max(0, to - n), to))).find(fits);
  return forward && back && to - from + 1 >= 2 * rules.length[1] ? { forward, reverse: back } : undefined;
}

export const fasta = (text: string) => text.split('\n').filter((line) => !line.startsWith('>')).join('').trim().toUpperCase();

// An enzyme table as the lab has it: `enzyme site cut`, or after the shift `enzyme site` with ^ where it cuts.
export const table = (text: string): Enzyme[] => text.trim().split('\n').slice(1).map((line) => {
  const [name, site, cut] = line.split('\t');
  return cut === undefined ? { name, site: site.replace('^', ''), cut: site.indexOf('^') } : { name, site, cut: Number(cut) };
});

export const ENZYMES: Enzyme[] = [
  ['EcoRI', 'GAATTC', 1], ['BamHI', 'GGATCC', 1], ['HindIII', 'AAGCTT', 1], ['PstI', 'CTGCAG', 5], ['SalI', 'GTCGAC', 1],
  ['XbaI', 'TCTAGA', 1], ['XhoI', 'CTCGAG', 1], ['KpnI', 'GGTACC', 5], ['SacI', 'GAGCTC', 5], ['SmaI', 'CCCGGG', 3],
  ['SphI', 'GCATGC', 5], ['NcoI', 'CCATGG', 1], ['NdeI', 'CATATG', 2], ['NheI', 'GCTAGC', 1], ['EcoRV', 'GATATC', 3],
  ['ClaI', 'ATCGAT', 2], ['BglII', 'AGATCT', 1], ['MluI', 'ACGCGT', 1], ['ApaI', 'GGGCCC', 5], ['AluI', 'AGCT', 2],
  ['HaeIII', 'GGCC', 2], ['TaqI', 'TCGA', 1], ['MspI', 'CCGG', 1], ['RsaI', 'GTAC', 2], ['HhaI', 'GCGC', 3], ['MboI', 'GATC', 0],
].map(([name, site, cut]) => ({ name, site, cut }) as Enzyme);

// The new supplier's: other enzymes, sites with ambiguity codes, written with ^.
export const SHIFTED: Enzyme[] = [
  'AvaII G^GWCC', 'BsaJI C^CNNGG', 'HincII GTY^RAC', 'BanI G^GYRCC', 'StyI C^CWWGG', 'AccI GT^MKAC', 'Sau96I G^GNCC',
  'ScrFI CC^NGG', 'Hpy188I TCN^GA', 'BsiHKAI GWGCW^C', 'MseI T^TAA', 'CviQI G^TAC', 'HinP1I G^CGC', 'BfaI C^TAG',
  'AgeI A^CCGGT', 'SpeI A^CTAGT', 'AvrII C^CTAGG', 'BsrGI T^GTACA', 'NsiI ATGCA^T', 'SacII CCGC^GG', 'AflII C^TTAAG',
  'PvuII CAG^CTG', 'NotI GC^GGCCGC',
].map((line) => { const [name, site] = line.split(' '); return { name, site: site.replace('^', ''), cut: site.indexOf('^') }; });

// Enzymes a cloning primer can carry: a plain site of six bases or more.
export const cloning = (enzymes: Enzyme[]) => enzymes.filter((e) => e.site.length >= 6 && /^[ACGT]+$/.test(e.site));

// A sequence of the library: background at its own GC, a long ORF and a few shorter ones on either strand, and sites
// of the cloning enzymes, until one ORF is clearly the longest.
function grow(r: () => number, length: number, enzymes: Enzyme[]): string {
  const base = (gc: number) => (r() < gc ? (r() < 0.5 ? 'G' : 'C') : r() < 0.5 ? 'A' : 'T');
  let gc = 0.5;
  const codon = () => { for (;;) { const c = base(gc) + base(gc) + base(gc); if (!STOPS.has(c)) return c; } };
  const orf = (aa: number) => `ATG${Array.from({ length: aa - 1 }, codon).join('')}${['TAA', 'TAG', 'TGA'][Math.floor(r() * 3)]}`;
  const sites = cloning(enzymes);
  for (;;) {
    gc = 0.35 + 0.3 * r();
    const dna = Array.from({ length }, () => base(gc));
    const taken: [number, number][] = [];
    const put = (part: string) => {
      for (let tries = 0; tries < 50; tries++) {
        const at = Math.floor(r() * (length - part.length));
        if (taken.some(([a, b]) => at < b && a < at + part.length)) continue;
        taken.push([at, at + part.length]);
        dna.splice(at, part.length, ...(r() < 0.5 ? part : reverse(part)));
        return;
      }
    };
    put(orf(Math.floor((length / 3) * (0.3 + 0.25 * r()))));
    for (let n = 1 + Math.floor(r() * 3); n > 0; n--) put(orf(40 + Math.floor(r() * 80)));
    for (let n = 4 + Math.floor(r() * 5); n > 0; n--) {
      const at = Math.floor(r() * (length - 8));
      if (!taken.some(([a, b]) => at < b && a < at + 8)) dna.splice(at, 8, ...sites[Math.floor(r() * sites.length)].site.padEnd(8, 'A').slice(0, 8));
    }
    const all = dna.join('');
    const [first, second] = orfs(all).sort((a, b) => b.protein.length - a.protein.length);
    if (!second || first.protein.length >= second.protein.length + 10) return all;
  }
}

const wrap = (dna: string, width: number) => dna.match(new RegExp(`.{1,${width}}`, 'g'))!.join('\n');
const tsv = (enzymes: Enzyme[], hat: boolean) => `${hat ? 'enzyme\tsite' : 'enzyme\tsite\tcut'}\n${enzymes.map((e) => (hat ? `${e.name}\t${e.site.slice(0, e.cut)}^${e.site.slice(e.cut)}` : `${e.name}\t${e.site}\t${e.cut}`)).join('\n')}\n`;

// The seed, written into projects/seq-gen/: what the lab starts with, and in later/ what arrives with the held-out
// questions and with the shift, at the paths it lands at.
export function plant(dir = fileURLToPath(new URL('../projects/seq-gen/', import.meta.url))) {
  const put = (path: string, content: string) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), content); };
  const r = random(2601);
  const set = (prefix: string, n: number, lengths: [number, number], enzymes: Enzyme[], shifted: boolean) => {
    for (let i = 1; i <= n; i++) {
      const name = `${prefix}${String(i).padStart(2, '0')}`;
      const dna = grow(r, lengths[0] + 10 * Math.floor((r() * (lengths[1] - lengths[0])) / 10), enzymes);
      const path = `${shifted ? 'later/shift/' : prefix === 'h' ? 'later/held/' : ''}library/${name}.fa`;
      put(path, shifted ? `>${name} strain T isolate, ${dna.length} bp\n${wrap(dna.toLowerCase(), 60)}\n` : `>${name} ${dna.length} bp\n${wrap(dna, 70)}\n`);
    }
  };
  set('s', 12, [600, 2400], ENZYMES, false);
  set('h', 4, [600, 2400], ENZYMES, false);
  set('t', 8, [800, 3000], SHIFTED, true);
  put('enzymes.tsv', tsv(ENZYMES, false));
  put('later/shift/enzymes.tsv', tsv(SHIFTED, true));
}
