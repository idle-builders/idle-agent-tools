# idle tasks

A shared record of work for coding agents. Agents do not talk to each other; they read and write this.

- **Two things are stored:** **tasks** — goals that nest into trees, need each other, carry scope, and record outer outcomes — and **memories** (`decision`, `assumption`, standing `taste`, and `retro` observations).
- **Four operations**, the same over the `idle` CLI and over MCP: `task` and `memory` create or update, `show` and `list` read. Everything else is a state: `proposed → open → claimed → submitted → verified → done`, plus `blocked` and `archived`.
- **Anyone can drop a task.** A title is enough. It is searched for near-duplicates first.
- **Claims are leases**, refused when the scope overlaps another live claim in the same tree.
- **The system verifies, not an agent.** Submitting a task runs your project's configured shell commands where the work is, and sends a failing task back to `open` with the output.
- **Storage lives in your home folder:** PGlite by default, or any Postgres you bring — or in **Linear**, where humans see and edit them as issues.

Bring your own workflow — or use [idle-skills](https://github.com/ambrovia/idle-agent-tools), a multi-agent development workflow built on it.

## Use

```bash
npx idle-agent-tasks help
npx idle-agent-tasks task --title "Newsletter signup on the landing page"
npx idle-agent-tasks list
```

As an MCP server (stdio), in any harness:

```json
{ "mcpServers": { "idle": { "command": "npx", "args": ["-y", "idle-agent-tasks", "mcp"] } } }
```

## Configure

`~/.idle/config.json` — all optional:

```json
{
  "checks": { "my-repo": ["npm run verify"] },
  "review": true,
  "database": "postgres://…"
}
```

`checks` are run by the system when a task in that project is submitted. `review` makes a verified task wait for someone who did not do the work. `database` switches from the local PGlite folder to a shared Postgres. The project label is the repository's name, so every clone and worktree lands on the same tasks.

### Linear

Where a repository's tasks live is its own setting. Commit `.idle.json` at its root, and keep your Linear API key in `~/.idle/config.json` (or `IDLE_LINEAR_API_KEY`):

```json
{ "backend": "linear", "linear": { "team": "ENG", "project": "Shop" } }
```

```json
{ "linear": { "apiKey": "lin_api_…" } }
```

The project defaults to the repository's name and is created on first use. Same operations, same refusals, and checks still run on this machine.

- A task is an issue, its children sub-issues, its goal and sections the description. A memory is an issue labelled `memory`.
- States map onto the team's workflow by type; blocked is Todo plus a `blocked` label.
- What Linear has no field for rides in an attachment idle keeps on each issue.
- Edits made in Linear count, and an issue created there is a task.

Linear has no transactions: one machine is serialised by its lock, two machines writing the same tree at once are not.

## Skills

- **`idle`** tells an agent everything above, and how the [idle-skills](../idle-skills/) workflow's pieces map onto the record.
- **`retro`** records how a finished root went — successes, friction, divergence from what the maintainer said, cost — as `retro` memories. Run it when a root is done, archived, or untouched for a week.
- **`self-improve`** looks across finished work for the corrections the maintainer keeps making and proposes the smallest fix, for their approval. On demand, or weekly: [`.codex/automations/`](.codex/automations/) for Codex, [`sidecars/`](sidecars/) for Antigravity, `/schedule` in Claude Code.

## Evidence when a workflow skill loads

A fresh agent should not spend its first ten tool calls working out where it is. Where the host
supports it ([`hooks/inject.mjs`](hooks/inject.mjs)), loading one of the idle-skills workflow skills
puts the state of the task tree being worked into the context of the agent that loaded it — and, for
`/build` and `/review`, the project's check results and the diff. The hook is `PostToolUse` on the
`Skill` tool, so a spawned builder or reviewer gets its own. Codex has no skill lifecycle event.

| skill | receives |
|---|---|
| `orchestrate` | a note that the work is tracked here, pointing at the `idle` skill |
| `build` | the note, state, and check results marked as a pre-edit baseline |
| `review` | the note, state, check results, and the diff since the work started |

The workflow skills know no tracker; this note, and the same one at session start ([`hooks/session-start.mjs`](hooks/session-start.mjs); in `AGENTS.md` on opencode), is how the lead and the agents it spawns learn the project has one.

The checks are this project's `checks` from `~/.idle/config.json` — the same commands that run on
submit — and **the hook runs them itself**, like the diff, in the worktree recorded on the task being
worked (or the root above it), falling back to the session's folder. A hook is not covered by the host's tool-permission prompts,
so point `checks` only at commands the repository owns.

| Env var | Default | Effect |
|---|---|---|
| `PIPELINE_SKILL_INJECT` | unset | `off` disables injection entirely — no check run, no diff, no state |
| `PIPELINE_CHECK_TIMEOUT_MS` | `45000` | check-command timeout; on timeout the last cached result is injected, marked `STALE` |
| `PIPELINE_INJECT_MAX_LINES` | `300` | per-section truncation (60 on Codex, which truncates injected context at roughly 1k tokens) |

Check results are stamped with the commit (and dirty flag) they ran on, so an agent can tell a
pre-edit baseline from a completion gate. Every failure degrades to silence — a skill load never breaks
on this hook.

Apache-2.0
