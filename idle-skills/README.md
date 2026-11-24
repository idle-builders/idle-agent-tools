# idle-skills

**Multi-agent software development with your intent kept intact.** From agentic development to agents *as the developer team*.

Freeform "vibe coding" with an agent fails at scale: no separation between deciding *what* to build and building it, the author grades their own homework, scope creeps, review gets skipped when "it's simple," agents that work to a checklist miss what the checklist was for, and nothing compounds.

Work starts with an interview: the lead asks, you decide, and the answers become a goal and a plan in your own words. The lead breaks the work into more detailed goals; fresh agents build them, each first building what will show deterministically that it works; fresh reviewers judge whether each *goal* is reached, not whether a list was ticked.

```
interview ──▶ plan ──▶ build ──▶ review ──▶ PR
you + lead     lead    builder   reviewer   lead
                         ▲          │
                         └─ sent back, with why ┘
```

The skills run on their own: the plan and the briefs the lead writes carry everything. With a task tracker they keep the same pieces there instead — [idle-tasks](../idle-tasks/) is one; what it adds is described there.

- **The goal is the contract.** A task says what is true when it is done, and why. Acceptance criteria are signs of that and checks are a floor; satisfying both while missing the goal is not done. Detail comes from nesting, not from longer lists.
- **The plan is yours.** It is written with you, not handed to you, and nothing in a run may quietly grow it. Work found along the way becomes a task of its own.
- **No gates — you contradict.** The lead says what is done and on what evidence; you reopen what is not. The higher in the tree, the more it is yours. This is not a hands-off factory.
- **One lead, no sub-planners.** One agent holds the whole picture and plans every level, so no two tasks decide the same question.
- **Your words travel intact.** The lead quotes what you said rather than paraphrasing it, binds standing intent where every task sees it, plays back any rewrite before acting on it, and shows you something small before building something big.

## What's in here

| Path | Role |
|---|---|
| [`skills/`](skills/) | The 7 workflow skills (`SKILL.md`, [Agent Skills](https://agents.md/) standard) |
| [`hooks/`](hooks/) | Session-start, edit-streak and thrash guards (Claude, Cursor, Gemini, Copilot, Codex, opencode) |
| [`.claude-plugin/`](.claude-plugin/), [`.codex-plugin/`](.codex-plugin/), [`.cursor-plugin/`](.cursor-plugin/), [`plugin.json`](plugin.json), [`apm.yml`](apm.yml) | Plugin manifests for Claude Code, Codex, Cursor, Antigravity and APM |
| [`.opencode/plugins/pipeline.js`](.opencode/plugins/pipeline.js) | opencode post-edit plugin |
| [`pipeline.config.example.yml`](pipeline.config.example.yml) | The repository's settings: verify command, tier, design system, VCS |

## Install

Install from the marketplace at the repository root — see the [top-level README](../README.md#install).

## Configure

Copy [`pipeline.config.example.yml`](pipeline.config.example.yml) to `pipeline.config.yml`; skills read their settings from it by key.

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

### Taste and conventions

Not in `pipeline.config.yml`. Repository conventions go in `AGENTS.md`, imported from `CLAUDE.md` with `@AGENTS.md`, so every harness reads the same file. What the maintainer prefers everywhere goes there too, or in the task tracker's standing preferences when one is in use. `/setup` asks for both in the maintainer's words.

## The skills

`orchestrate` · `design` · `build` · `review` · `create-pr` · `lore` · `setup`

Tell `/orchestrate` what you want and it runs it end to end. `/create-pr` opens a PR when you want one. Use `/lore` anytime to capture or surface tribal knowledge.

## License

[Apache-2.0](../LICENSE).
