// or-models — operations research: word problems a planner would bring, each to be turned into an optimisation model
// and solved for its optimal objective. Fifteen from MAMO's ComplexLP, then fifteen from IndustryOR, easy before hard,
// both as cleaned by the LLM4OR survey (github.com/LLM4OR/LLM4OR, which states no licence). Problems do not build on
// each other; a solver set-up and formulation patterns carry. Fetched when the stream is built, never committed.

import { write } from '../stream.ts';

const BASE = 'https://raw.githubusercontent.com/LLM4OR/LLM4OR/master/static/clean_benchmarks';

async function jsonl(path: string): Promise<any[]> {
  const answer = await fetch(`${BASE}/${path}`);
  if (!answer.ok) throw new Error(`${path}: ${answer.status}`);
  return (await answer.text()).split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
}

const CHECK = `import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const id = process.argv[2];
const truth = JSON.parse(readFileSync(join(process.env.TESTS ?? '/tests', 'answers.json'), 'utf8'))[id];
const out = process.env.REWARD ?? '/logs/verifier/reward.json';
let given;
try { given = Number(String(JSON.parse(readFileSync(join('answers', id + '.json'), 'utf8')).answer).replace(/[$€,\\s]/g, '')); } catch {}
const right = Number.isFinite(given) && Math.abs(given - truth) <= Math.max(0.06, 1e-6 * Math.abs(truth));
writeFileSync(out, JSON.stringify(given === undefined || Number.isNaN(given) ? { reward: 0, feedback: 'There is no number in answers/' + id + '.json.' }
  : right ? { reward: 1 } : { reward: 0, feedback: 'The planner checked the optimum in answers/' + id + '.json and it is not right. Look into it again.' }));
`;

export default async function build(dir: string) {
  const mamo = (await jsonl('Mamo/Mamo_complex_lp_clean.jsonl')).slice(0, 15).map((r) => ({ text: r.Question, answer: Number(r.Answer) }));
  const rank = { Easy: 0, Medium: 1, Hard: 2 } as Record<string, number>;
  const industry = (await jsonl('IndustryOR.jsonl')).map((r, i) => ({ ...r, i })).sort((a, b) => rank[a.difficulty] - rank[b.difficulty] || a.i - b.i)
    .slice(0, 15).map((r) => ({ text: r.en_question, answer: Number(r.en_answer) }));
  const problems = [...mamo, ...industry];
  const name = (i: number) => `p${String(i + 1).padStart(2, '0')}`;
  write(dir, {
    title: 'an operations research desk: word problems to optimal plans',
    metadata: { kind: 'operations research', improve_every: 10, reopens: 1, source: 'MAMO ComplexLP and IndustryOR, cleaned by LLM4OR', licence: 'not stated' },
    project: { 'answers/README.md': 'Write the optimal objective value of problem pNN to `answers/pNN.json` as `{ "answer": 1234.5 }`: a number, rounded as the problem asks if it does.\n' },
    tests: { 'check.mjs': CHECK, 'answers.json': JSON.stringify(Object.fromEntries(problems.map((p, i) => [name(i), p.answer]))) },
    steps: problems.map((p, i) => ({
      name: name(i),
      instruction: `Problem ${name(i)}: ${p.text.trim()}\n\nFind the optimal objective value and write it to answers/${name(i)}.json as answers/README.md says.`,
      tests: { 'test.sh': `node "\${TESTS:-/tests}/check.mjs" ${name(i)}\n` },
    })),
  });
}
