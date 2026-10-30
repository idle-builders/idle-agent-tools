// seq-lab — a molecular biology bench on raw sequences: open reading frames, PCR primers and amplicons, restriction
// digests, GC content. The questions are LAB-Bench's SeqQA (FutureHouse, CC BY-SA 4.0), only the families answerable
// from the sequence in the question, four of each, asked round by round, so that what a session builds for a family
// in the first round can serve it in the next three. Fetched when the stream is built, never committed: LAB-Bench
// asks that its items stay out of public text.

import { write } from '../stream.ts';

const FAMILIES = [
  'ORF-seq-AAid-v1-public', 'ORF-seq-AAseq-v1-public', 'ORF-seq-numlen-v1-public', 'Prop-seq-gcpercent-v1-public',
  'RE-seq-numfrags-v1-public', 'RE-seq-lenfrags-v1-public', 'PCR-primers-len-v1-public', 'PCR-len-primers-v1-public',
  'PCR-seq-primers-v1-public', 'PCR-seq-enzprimers-v1-public',
];
const ROUNDS = 4;

type Row = { id: string; question: string; ideal: string; distractors: string[] | string; subtask: string };

async function rows(): Promise<Row[]> {
  const all: Row[] = [];
  for (let offset = 0; offset < 600; offset += 100) {
    const answer = await fetch(`https://datasets-server.huggingface.co/rows?dataset=futurehouse/lab-bench&config=SeqQA&split=train&offset=${offset}&length=100`);
    if (!answer.ok) throw new Error(`LAB-Bench SeqQA: ${answer.status} ${await answer.text()}`);
    all.push(...(await answer.json()).rows.map((r: any) => r.row));
  }
  return all;
}

// The distractors come as a list, or in the dataset's files as a Python list literal.
const listed = (given: string[] | string) => (Array.isArray(given) ? given
  : [...given.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? m[2]));

// The same order every time (mulberry32).
function shuffled<T>(list: T[], seed: number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const j = Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const CHECK = `import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const id = process.argv[2];
const truth = JSON.parse(readFileSync(join(process.env.TESTS ?? '/tests', 'answers.json'), 'utf8'))[id];
const out = process.env.REWARD ?? '/logs/verifier/reward.json';
let given;
try { given = String(JSON.parse(readFileSync(join('answers', id + '.json'), 'utf8')).answer).trim().toUpperCase(); } catch {}
writeFileSync(out, JSON.stringify(!given ? { reward: 0, feedback: 'There is no answer in answers/' + id + '.json.' }
  : given === truth ? { reward: 1 } : { reward: 0, feedback: 'The lab checked your answer in answers/' + id + '.json and it is not right. Look into it again.' }));
`;

export default async function build(dir: string) {
  const all = await rows();
  const family = (name: string) => all.filter((r) => r.subtask === name).sort((a, b) => a.id.localeCompare(b.id)).slice(0, ROUNDS);
  const picked = Array.from({ length: ROUNDS }, (_, round) => FAMILIES.map((name) => family(name)[round])).flat();
  const answers: Record<string, string> = {};
  const steps = picked.map((row, i) => {
    const name = `q${String(i + 1).padStart(2, '0')}`;
    const options = shuffled([row.ideal, ...listed(row.distractors)], i + 1);
    answers[name] = String.fromCharCode(65 + options.indexOf(row.ideal));
    return {
      name,
      instruction: `Question ${name}: ${row.question}\n\n${options.map((o, k) => `${String.fromCharCode(65 + k)}. ${o}`).join('\n')}\n\nWrite the letter of your answer to answers/${name}.json as answers/README.md says.`,
      tests: { 'test.sh': `node "\${TESTS:-/tests}/check.mjs" ${name}\n` },
    };
  });
  write(dir, {
    title: 'a sequence lab: ORFs, primers, digests',
    metadata: { kind: 'molecular biology', improve_every: 10, reopens: 1, source: 'LAB-Bench SeqQA (futurehouse/lab-bench)', licence: 'CC BY-SA 4.0' },
    project: { 'answers/README.md': 'Write the answer to question qNN to `answers/qNN.json` as `{ "answer": "B" }`: the letter of the option you choose.\n' },
    tests: { 'check.mjs': CHECK, 'answers.json': JSON.stringify(answers) },
    steps,
  });
}
