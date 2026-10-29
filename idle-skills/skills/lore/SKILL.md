---
name: lore
description: "Capture, scan, or index one-line @lore notes on non-obvious constraints, workarounds and hazards, beside the code they affect. Use when missing context would cause a future mistake; never as history or a changelog."
argument-hint: "[file paths, 'scan' to find candidates, or 'index' to list all lore]"
persona: any
applies-to: [frontend, backend, application, framework, infra]
user-invocable: true
---

# Lore

Add `@lore` only when a future reader would likely make a real mistake without it, and the code nearby
does not already say it.

```
@lore: <subject> — <constraint>; <consequence or rule>[; <link>]
```

- One line, always. Too long: split it or link out.
- Fragments, not sentences: facts, conditions, numbers, names.
- What holds now. Never history: no "replaced", "previously", "no longer", "now".

Good: `@lore: PGlite — two processes on one dir fork data silently; lock required; stale after 10 min or dead pid`
Bad: `@lore: PGlite forks the data silently when two processes open one directory, so the lock is what…`

**Scan** — list candidates as location, proposed line, and evidence; edit only with the maintainer's
approval.

**Index** — list current lore by location, and flag entries that are stale, contradictory, longer than
one line, or narrate history. Report; do not edit.

## Target

$ARGUMENTS
