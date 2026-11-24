#!/usr/bin/env node
// Session start — tell the session this project's work is tracked in the record.
// The workflow skills know no tracker; this is how a lead learns there is one,
// however its skill was started.
//
// Usage: session-start.mjs <claude|cursor|gemini|copilot|codex>
// @lore: Codex 0.142.5 — SessionStart hook stdout marked failed, any JSON shape; keep codex output empty

const MESSAGE = 'idle-tasks is active: this project tracks its work in the record of work. '
  + 'When you lead or do work with the workflow skills (/orchestrate, /build, /review, /design), '
  + 'load the `idle-tasks:idle` skill and keep their pieces in the record, as its "With the workflow skills" '
  + 'section says. Brief each builder and reviewer from `idle show <id> --brief`.';

const shapes = {
  claude: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: MESSAGE } },
  cursor: { additional_context: MESSAGE },
  gemini: { hookSpecificOutput: { additionalContext: MESSAGE } },
  copilot: { additionalContext: MESSAGE },
};

const shape = shapes[process.argv[2] ?? 'claude'];
if (shape) process.stdout.write(`${JSON.stringify(shape)}\n`);
