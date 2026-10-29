// data-desk — E20 as a stream: forty questions about one shop export with the quirks real exports have, improvement
// after every tenth. The seed is the tool a harness specialised on the export might have built.

import { readFileSync } from 'node:fs';
import { generate, MORE, QUESTIONS } from '../fixtures/orders.ts';
import { write } from '../stream.ts';

const fixture = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// The verifier: the answer in answers/<id>.json against the right one, the way the requester reads it.
const CHECK = `import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const id = process.argv[2];
const { kind, truth } = JSON.parse(readFileSync(join(process.env.TESTS ?? '/tests', 'answers.json'), 'utf8'))[id];
const out = process.env.REWARD ?? '/logs/verifier/reward.json';
let given;
try { given = JSON.parse(readFileSync(join('answers', id + '.json'), 'utf8')).answer; } catch {}
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[€%\\s,]/g, '')) : NaN);
const right = kind === 'money' ? Math.abs(num(given) - truth) <= 0.01
  : kind === 'percent' ? Math.abs(num(given) - truth) <= 0.1
  : kind === 'count' || kind === 'number' ? num(given) === truth
  : kind === 'name' ? String(given).trim().toLowerCase() === String(truth).toLowerCase()
  : kind === 'list' ? Array.isArray(given) && given.map(String).join() === truth.join()
  : typeof given === 'object' && given !== null && Object.keys(truth).every((k) => Math.abs(num(given[k]) - truth[k]) <= 0.01) && Object.keys(given).length === Object.keys(truth).length;
writeFileSync(out, JSON.stringify(given === undefined
  ? { reward: 0, feedback: 'There is no answer in answers/' + id + '.json.' }
  : right ? { reward: 1 } : { reward: 0, feedback: 'The requester checked your answer in answers/' + id + '.json and it is not right. Look into it again.' }));
`;

export default function build(dir: string) {
  const data = generate();
  const questions = [...QUESTIONS, ...MORE];
  write(dir, {
    title: 'a data desk over one messy export',
    metadata: { kind: 'data analysis', improve_every: 10, reopens: 1, source: 'idle-harness E20' },
    project: { 'answers/README.md': fixture('projects/orders/answers/README.md'), ...data.files },
    seed: { 'tools/orders.ts': fixture('fixtures/orders-tool.ts') },
    tests: {
      'check.mjs': CHECK,
      'answers.json': JSON.stringify(Object.fromEntries(questions.map((q) => [q.id, { kind: q.kind, truth: q.answer(data.lines) }]))),
    },
    steps: questions.map((q) => ({
      name: q.id,
      instruction: `Question ${q.id}: ${q.text} Answer from the data in data/ and write it to answers/${q.id}.json as answers/README.md says.`,
      tests: { 'test.sh': `node "\${TESTS:-/tests}/check.mjs" ${q.id}\n` },
    })),
  });
}
