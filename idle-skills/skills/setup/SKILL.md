---
name: setup
description: "Wire a repository into the workflow: the verify command, checks and independent review in the record of work, where the maintainer's taste and conventions live, and the weekly self-improve run. Use on installation or when the project's setup changes."
argument-hint: "[optional: 'checks', 'taste', 'schedule', or 'all']"
persona: any
applies-to: [frontend, backend, application, framework, infra]
user-invocable: true
---

# Setup

Propose each step, show what you would write, and write only what the maintainer approves.

1. **`pipeline.config.yml`** at the repository root, from `pipeline.config.example.yml`: `verify`, the one
   command that must pass; `vcs`; `engineering.tier`, chosen by who uses the product; `designSystem`, or
   `null` without a UI. Take commands from what the repository already runs, never invent them.
2. **The record of work** (`~/.idle/config.json`, when idle-tasks is present): this project's `checks`,
   keyed by the label `idle doctor` prints, so the system verifies every submitted task itself; and
   `"review": true`, so a verified task waits for a reviewer who did not do the work. A shared database
   only when the maintainer brings one.
3. **Their taste and conventions**, in their words, where every agent will see them:
   - a standing preference — how they like things done, everywhere — is project memory
     (`memory --kind taste`, no `--task`); every brief carries it;
   - a convention of the repository goes in `AGENTS.md`, and `CLAUDE.md` imports it with `@AGENTS.md`
     so every harness reads the same file.

   Ask; do not derive taste from the code or from best practice. Empty is a good start. Where
   `.pipeline/rules/` files exist, offer to move what is still true into one of the two and delete the
   rest.
4. **The weekly `/self-improve` run** in this harness — Claude Code `/schedule`, Codex
   `.codex/automations/`, Antigravity the `sidecars/` definition — using its `## Weekly routine`.

## Target

$ARGUMENTS
