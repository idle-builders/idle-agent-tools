---
name: self-improve
description: "Find what the maintainer keeps correcting across finished work, and propose the smallest change that would have prevented it — a taste memory, a line in AGENTS.md, lore, or a skill edit — for their approval. Run on demand or weekly. Never applies changes."
argument-hint: "[optional: focus area]"
persona: any
applies-to: [frontend, backend, application, framework, infra]
user-invocable: true
---

# Self-improve

Run on demand or on the weekly schedule, never inside an active build.

## Read

Per project, in the record of work: `retro` memories, `divergence` first; the interviews on root tasks;
superseded decisions and assumptions; `taste` memories; and `outcome` — PR review comments, user feedback,
what happened after merge. Then merged PRs and their review comments.

Look for the same correction recurring across separate roots: the maintainer redirecting the work the
same way, builders making the same unguided choice, the same false premise. Two independent occurrences
qualify a standing taste; three qualify a change to process or a skill.

## Propose

For each pattern:

- the occurrences, with the maintainer's words quoted;
- the mechanism, and the competing explanation;
- what works and must be kept;
- one smallest change: a `taste` memory, a line in `AGENTS.md` or `CLAUDE.md`, a `@lore` line, or a skill
  edit — preferring whichever the agents that made the mistake would actually have read;
- how to tell whether it worked.

Never propose from one occurrence, and never apply anything without the maintainer's approval.

## Weekly routine

1. Run `/retro` on every root that is done, archived, or untouched for a week and has no `retro` memory.
2. For each project with new retros, outcomes or superseded memories since the last pass, run the reading
   above.
3. For a pattern at threshold, drop a `proposed` root task in that project carrying the evidence and the
   exact change. Never edit memory, rules or skills unattended.

## Target

$ARGUMENTS
