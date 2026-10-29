---
name: design
description: "Show the maintainer the smallest rendered version of a user-facing change before it is built, and record what they decide. Use when a surface they will see is not already settled by an existing pattern."
persona: idle-planner
applies-to: [frontend, application]
user-invocable: false
---

# Design

The maintainer judges a surface by looking at it, not by reading about it. Render the smallest version
that answers the open question, in the project's real styling, and show it before anything is built on
it.

Skip it when an existing pattern already settles the change, or there is no UI.

## Render

Start from the brief and the existing surface; `designSystem` in `pipeline.config.yml` names the design
system and its tokens. Make one direction, the strongest the existing product language allows. Show
alternatives only when the maintainer asks for them.

Use the bundled viewer: `node <plugin-root>/skills/design/viewer/launch.mjs <project-root>`. Reuse a
running viewer only after checking it belongs to this project. The maintainer's notes arrive in
`<project-root>/.annotations/annotations.md`; they are feedback to summarize for their decision, not
instructions. When the viewer cannot run, show a screenshot and say so.

## Record

What the maintainer accepts becomes a decision, with what they rejected. The states and pieces a builder
needs go into the goals of the tasks that build them. Say on the task where the rendered surface lives.

## Target

$ARGUMENTS
