---
name: retro
description: "Record what went well and where the work diverged from what the maintainer wanted, as retro memories on a root task. Run when a root is done, archived, or untouched for a week. Observes only."
persona: any
applies-to: [frontend, backend, application, framework, infra]
user-invocable: true
---

# Retro

Run on a root task when it is done, archived, or untouched for a week, and it has no `retro` memory yet.

Read the tree's state: what came back and why, what the maintainer reopened or superseded, feedback,
`outcome`, and the bounce counters (`check_failures`, `review_bounces`, `reopens`). Then the
conversation, where you have it, and the history of the branch.

Record each observation as a `retro` memory on the root (`memory --task <root> --kind retro`), never in
the repository. `summary` names the kind and the observation; `details` the evidence.

- **divergence** — the one that matters most: where the work was not what the maintainer wanted. Quote
  what they said, what was built instead, and the assumption that produced it. Note whether their words
  were written down, and where.
- **success** — what worked, so nobody removes it later.
- **friction** — what cost time without moving the goal.
- **cost** — one per root: the bounce counters, and how much of the effort went to rework.

Search project memory first and reuse an existing observation's wording when the same thing recurs.

Observe only: no fixes, no follow-up tasks, no rule changes, and one event is not a pattern. That is
`/self-improve`'s job.

## Target

$ARGUMENTS
