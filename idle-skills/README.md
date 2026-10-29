# idle-skills

**Multi-agent software development on a shared record of work.** From agentic development to agents *as the developer team*.

Freeform "vibe coding" with an agent fails at scale: no separation between deciding *what* to build and building it, the author grades their own homework, scope creeps, review gets skipped when "it's simple," agents that work to a checklist miss what the checklist was for, and nothing compounds.

idle-skills is a workflow over [idle-tasks](../idle-tasks/), the record of work. A dropped task starts with an interview: the planner asks, you decide, and the answers become a goal and a plan of 50–100 lines in your own words. The planner breaks the work into more detailed goals; builders work them; the system runs your project's checks; fresh reviewers judge whether each *goal* is reached, not whether a list was ticked.

```
drop a task ──▶ interview ──▶ plan the tree ──▶ build ──▶ checks ──▶ review ──▶ PR
   anyone      you + planner     planner        builder    system    reviewer   builder
                                                   ▲                     │
                                                   └── came back, with why ┘
```

- **The goal is the contract.** A task says what is true when it is done, and why. Acceptance criteria are signs of that and checks are a floor; satisfying both while missing the goal is not done. Detail comes from nesting, not from longer lists.
- **The plan is yours.** It is written with you, not handed to you, and nothing in a run may quietly grow it. Work found along the way becomes a task of its own.
- **No gates — you contradict.** The planner says what is done and on what evidence; you reopen what is not. The higher in the tree, the more it is yours. This is not a hands-off factory.
- **One planner, no sub-planners.** One agent holds the whole picture and plans every level, so no two tasks decide the same question.
- **Your words travel intact.** The lead quotes what you said rather than paraphrasing it, binds standing intent where every task sees it, plays back any rewrite before acting on it, and shows you something small before building something big.

## What's in here

| Path | Role |
|---|---|
| [`skills/`](skills/) | The 7 workflow skills (`SKILL.md`, [Agent Skills](https://agents.md/) standard) |
| [`personas/`](personas/) | Persona source of truth; [`../scripts/generate-agents.mjs`](../scripts/generate-agents.mjs) renders every host format below |
| [`agents/`](agents/) | Claude-format `idle-planner` / `idle-reviewer` / `idle-builder` (generated) |
| [`agents-cursor/`](agents-cursor/), [`agents-antigravity/`](agents-antigravity/), [`.opencode/agents/`](.opencode/agents/), [`.codex/agents/`](.codex/agents/) | The same personas for Cursor, Antigravity, opencode and Codex (generated) |
| [`hooks/`](hooks/) | Session-start + edit-streak + thrash guards, and spawn-time evidence injection (Claude, Cursor, Gemini, Copilot, Codex, opencode) |
| [`.codex/automations/`](.codex/automations/), [`sidecars/`](sidecars/) | Weekly `/self-improve` routine definitions for Codex and Antigravity (and `/schedule` prompt in [`skills/self-improve/SKILL.md`](skills/self-improve/SKILL.md)) |
| [`.claude-plugin/`](.claude-plugin/), [`.codex-plugin/`](.codex-plugin/), [`.cursor-plugin/`](.cursor-plugin/), [`plugin.json`](plugin.json), [`apm.yml`](apm.yml) | Plugin manifests for Claude Code, Codex, Cursor, Antigravity and APM |
| [`.opencode/plugins/pipeline.js`](.opencode/plugins/pipeline.js) | opencode post-edit plugin |
| [`pipeline.config.example.yml`](pipeline.config.example.yml) | The repository's settings: verify command, tier, design system, VCS |

## Install

Install both plugins from the marketplace at the repository root — see the [top-level README](../README.md#install). `idle-skills` works over `idle-tasks` when installed, and degrades cleanly to standalone session and repository operation when used without it.

## Configure

Copy [`pipeline.config.example.yml`](pipeline.config.example.yml) to `pipeline.config.yml`; skills resolve `{{key}}` from it:

The record of work needs nothing in the repository. Its settings are per machine, in `~/.idle/config.json` — `/setup` offers to write them:

```json
{ "checks": { "my-repo": ["go test ./..."] }, "review": true }
```

`checks` are what the system runs when a task in that project is submitted; `review` makes a verified task wait for a reviewer who did not do the work. Add `"database": "postgres://…"` to share the record across machines.

```yaml
verify: "go test ./..."   # the single command that must pass before a PR
engineering:
  tier: mvp               # prototype | mvp | production | critical — the customer and rigor the code targets
designSystem: null        # null → the design round never runs
vcs: github
```

The **engineering tier** is load-bearing and is chosen by customer, not by aspiration:

| Tier | Customer | Expected result |
|---|---|---|
| `prototype` | Builders or an internal demo audience | The core flow can be demonstrated, often with manual steps. Key features may still be missing. |
| `mvp` | Early, tolerant users | The core works most of the time. Auxiliary features, polish, and less-common edge cases may be missing. |
| `production` | Ordinary public or paying users | Standard ordinary software: it works normally and reliably, with proportionate tests, error handling, and security. It does not imply enterprise controls. |
| `critical` | Large-company, regulated, contractual, or high-consequence customers | Adds the rigor actually demanded by that context, such as compliance evidence, audit trails, rollback procedures, stronger operational controls, and exhaustive failure handling. |

Do not choose `critical` merely because software is deployed or stores real user data. Feature flags, audit systems, elaborate observability, formal rollback machinery, exhaustive fallbacks, and speculative abstractions require a concrete customer, regulatory, contractual, or blast-radius need. At every tier, build only what the goal and known risks require. `engineering.tier` is set once for the repository and describes the product, not the task.

### Injected evidence when an agent starts

A fresh agent should not spend its first ten tool calls working out where it is. Where the host
supports it ([`hooks/inject.mjs`](hooks/inject.mjs)), a spawned agent's context already contains the
state of the task tree being worked — and, by role, fresh mechanical check results and the diff.

`SubagentStart` is the primary event: it exists on both Claude Code and Codex, and it injects into
the *subagent's* context rather than the parent's. Claude Code additionally fires `PostToolUse` for
the `Skill` tool, so skill-load injection works there as a supplement; Codex has no skill lifecycle
event at all.

| spawned as | receives |
|---|---|
| `idle-planner` | the tree's state |
| `idle-builder` | state + check results, marked as a pre-edit baseline |
| `idle-reviewer` | state + check results + the diff since the work started |

**This runs `checks.preSpawn` (or `verify`) as a shell command.** A hook executes directly, so it is
not covered by the host's tool-permission prompts: whatever that line contains runs when an agent
starts. Point it only at commands the repository owns, and review changes to it as you would a CI
workflow.

| Env var | Default | Effect |
|---|---|---|
| `PIPELINE_SKILL_INJECT` | unset | `off` disables injection entirely — no check run, no diff, no state |
| `PIPELINE_CHECK_TIMEOUT_MS` | `45000` | check-command timeout; on timeout the last cached result is injected, marked `STALE` |
| `PIPELINE_INJECT_MAX_LINES` | `300` | per-section truncation (60 on Codex, which truncates injected context at roughly 1k tokens) |

Check results are stamped with the commit (and dirty flag) they ran on, so an agent can tell a
pre-edit baseline from a completion gate. Every failure degrades to silence — a spawn never breaks
on this hook.

### Taste and conventions

Not in `pipeline.config.yml`. What the maintainer prefers everywhere is project memory in the record of work (`idle memory --kind taste`), which every brief carries. Repository conventions go in `AGENTS.md`, imported from `CLAUDE.md` with `@AGENTS.md`, so every harness reads the same file. `/setup` asks for both in the maintainer's words, and `/self-improve` proposes additions when the same correction keeps recurring.

## The skills

`orchestrate` · `design` · `create-pr` · `retro` · `self-improve` · `lore` · `setup`

The record's own skill, `idle`, comes with [idle-tasks](../idle-tasks/).

Drop a task — `idle task --title "…"`, or just tell the agent — and run it end to end with `/orchestrate <id>`. `/create-pr` opens a PR when you want one; `/retro` records how a finished root went. After several tasks (or on a weekly schedule), `/self-improve` looks for the corrections you keep making and proposes fixes. Use `/lore` anytime to capture or surface tribal knowledge.

## License

[Apache-2.0](../LICENSE).
