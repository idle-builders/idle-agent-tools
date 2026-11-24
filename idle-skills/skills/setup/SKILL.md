---
name: setup
description: "Wire a repository into the workflow: the verify command, the engineering tier, the design system, and where the maintainer's taste and conventions live. Use on installation or when the project's setup changes."
argument-hint: "[optional: 'config', 'taste', or 'all']"
applies-to: [frontend, backend, application, framework, infra]
user-invocable: true
---

# Setup

Propose each step, show what you would write, and write only what the maintainer approves.

1. **`pipeline.config.yml`** at the repository root, from `pipeline.config.example.yml`: `verify`, the one
   command that must pass; `vcs`; `engineering.tier`, chosen by who uses the product; `designSystem`, or
   `null` without a UI. Take commands from what the repository already runs, never invent them.
2. **Their taste and conventions**, in their words, where every agent will see them:
   - a standing preference — how they like things done, everywhere — goes where every brief carries it:
     the task tracker's standing preferences when one is in use, otherwise `AGENTS.md`;
   - a convention of the repository goes in `AGENTS.md`, and `CLAUDE.md` imports it with `@AGENTS.md`
     so every harness reads the same file.

   Ask; do not derive taste from the code or from best practice. Empty is a good start. Where
   `.pipeline/rules/` files exist, offer to move what is still true into one of the two and delete the
   rest.

## Target

$ARGUMENTS
