---
name: create-pr
description: "Open or update a pull request for finished, reviewed work, and wait for CI. Use only when the maintainer wants a PR. Does not merge."
persona: idle-builder
applies-to: [frontend, backend, application, framework, infra]
argument-hint: "[task id or branch description]"
user-invocable: true
---

# Create PR

Only when the maintainer wants a PR, and only for work that is done and reviewed. Stop rather than
repair product work here.

1. Commit what belongs to the work and nothing else. Task ids stay in the record — never in the branch,
   commits or PR.
2. Bring the branch up to date with the base without rewriting shared history. A conflict that changes
   behavior goes back to the builder.
3. Run `{{verify}}` on the committed tree and wait for it. With `{{vcs}}` set to `none`, stop here.
4. Push and open or update the PR. Its description, in plain language: what changed and why; how it was
   seen working; the decisions and assumptions behind it, with what was rejected; the size of the change
   against what the plan expected; known limitations.
5. Wait for CI. Hand a failure to whoever owns it — the builder for code, the maintainer for anything the
   plan got wrong — and come back here after. When a check fails twice for the same reason, stop and
   block the task with the failing check.

Stop at a green PR. A human merges. Tag or release only when asked.

## Target

$ARGUMENTS
