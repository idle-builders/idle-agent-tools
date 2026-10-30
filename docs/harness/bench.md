# The bench — streams that show whether self-improvement pays

*Draft, 29 October 2026. The design for idle-harness's own evaluation bench: long streams of related work, drawn from public benchmarks and our own, on which a learning harness is compared with one that learns nothing. See [analytics.md](analytics.md) for the measure and [evals/README.md](../../idle-harness/evals/README.md) for the runner.*

## What it is for

A harness that improves itself is worth what it saves over a stream of work, net of what improving cost, at the same quality. That shows only where tasks share something a tool or a note can carry: one dataset, one codebase, one toolchain, one world. E20 showed it: over forty questions on one export, every learning run beat the frozen one; over fifteen, none did. Public benchmarks mostly run tasks one by one, in fresh environments, in parallel, and score accuracy. The bench runs them as a stream, in order, through one harness, and scores what the harness is built for.

## Streams

A stream is a series of steps in one project. Each step is a task for a new working session. After each, the bench plays the human: a verifier outside the sandbox decides, and the bench approves with a rating or rejects with a reason, through the same `/approve` and `/reject` a human types. A rejected step goes back to its session, as often as the stream allows. Improvement runs after every so many steps, as the base starts it.

On disk a stream follows Harbor's multi-step task layout, so that a stream can later run under Harbor, in containers, and a benchmark Harbor has an adapter for can become a stream:

```
<stream>/
  task.toml                   title, kind, improve_every, reopens; one [[steps]] per step, in order
  environment/project/        the project every run starts from (Harbor: copied into the image)
  environment/seed/           with --seed, what a harness specialised on the work starts with
  tests/                      verifier helpers every step shares
  steps/<name>/instruction.md the task, as the human words it
  steps/<name>/tests/test.sh  the verifier: writes {"reward", "rating"?, "feedback"?} to $REWARD
  steps/<name>/workdir/       files put into the project before the step
```

`test.sh` runs with the project as its working directory and `PROJECT`, `TESTS` and `REWARD` set; under Harbor, `REWARD` defaults to `/logs/verifier/reward.json`. A step is approved when its reward reaches the step's `min_reward` (1 by default), rated `rating` or 1 + 4 × reward. A rejection carries the verifier's `feedback` or a plain "it is not right": what failed, never the answer. Our own settings sit under `[metadata]`, which Harbor leaves alone; the layout is Harbor's, but no stream has yet been run under Harbor.

A stream is built by a source script, `evals/streams/<name>.ts`, which writes it to `evals/streams/.built/<name>/`, out of git and out of the sandbox's reach. Sources that draw on a public benchmark fetch its data when they build. Nothing of a benchmark is committed: several ask that their items never appear in public text.

## Arms

Every stream runs under the runner's structures: `frozen` (nothing carries over: the floor), `layered` (the base), `open`, and with `--seed` where the stream has a seed (the ceiling). `--steps <n>` runs only the first n steps: a pilot, to see that a cheap model reaches approval at all before a stream is worth running in full.

## What it reports

Per run: steps approved, approved the first time, cost to approval and rating per block, calls to the harness's own tools per block, and the whole stream's cost with improvement counted apart. Across runs, `node evals/bench.ts` compares each stream's arms: the mean whole-stream cost, approval share and rating, the cost per step in the last block, the payoff (frozen's cost minus learning's, improvement included), and the step from which learning's running total stays below frozen's.

## The first streams

| Stream | Kind of work | Steps | Carries | Source |
|---|---|---|---|---|
| `data-desk` | data analysis over one messy export | 40 | a query tool, notes on the export's quirks | our E20 |
| `seq-lab` | molecular biology on raw sequences: ORFs, PCR primers and amplicons, digests, GC | 40 | a sequence toolkit | LAB-Bench SeqQA, the families answerable from the sequence alone |
| `or-models` | operations research: word problems to optimisation models | 30 | a solver set-up, formulation patterns | the cleaned IndustryOR and MAMO ComplexLP sets |

Next in line: a SWE-Chain chain (the agent's own code carries forward, hidden upstream tests), AppWorld's dev split (one world of apps, state checks) and VerilogEval (one simulator). How each was chosen is in `reports/Benchmarks for harness tuning evals.md`.

## Rules the streams keep

- The verifier and the right answers stay outside the sandbox. A harness that closes its loops reads whatever it can reach (E18).
- Feedback says what failed, never the answer: a stream that taught answers would reward memorising them.
- A step must be answerable from the project and the instruction, or from tools the session can install. A step that needs a lookup the harness cannot make measures the lookup.
- A stream earns its place in a pilot: most steps approved under `frozen`, at costs that vary from step to step. A stream nothing passes, or everything passes for the same cost, shows nothing about learning.
- Ordering, held-out steps after the stream, and a shift halfway are open. The continual-learning benchmarks use all three; the first streams run in one fixed order.
