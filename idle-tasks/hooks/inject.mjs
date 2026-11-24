#!/usr/bin/env node
// Skill-load injection — put the state of the task tree being worked, mechanical
// check results and the diff into an agent's context when it loads /build,
// /review or another workflow skill, so it begins with evidence instead of
// spending round trips fetching it.
//
// One entry point: skill load (PostToolUse, matcher `Skill`) on hosts that
// dispatch skills as a tool call. It fires in whichever agent loads the skill,
// so a spawned builder or reviewer gets its own. Codex has no skill event.
//
// Both hosts read hooks only from hooks/hooks.json — a manifest `hooks` path
// and an inline manifest object were both tried on Claude and neither fires —
// so the two hosts share one envelope.
//
// Codex gates hooks on a hash of hooks.json AND of the script it runs, and an
// untrusted hook stalls `codex exec` rather than being skipped. Any edit to
// either costs the maintainer one re-approval, and a session that hangs after an
// upgrade means untrusted, not broken. Editing the installed copy to debug it
// breaks trust and produces exactly the symptom you were chasing.
//
// Usage: inject.mjs <claude|cursor|gemini|copilot|codex|opencode> [skill-name]
// Envelope formats read the event payload on stdin; opencode takes the skill
// name as an argument. Guard discipline: a skill load must never break — every
// failure degrades to silence, and the process always exits 0 (a non-zero exit
// makes codex discard the output entirely).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HOOK_DIR, '..');
// The record of work is read through this plugin's own idle CLI when it has its
// dependencies; otherwise the published package.
const LOCAL_IDLE = join(PLUGIN_ROOT, 'bin', 'idle.mjs');
const IDLE = process.env.IDLE_BIN ? [process.execPath, process.env.IDLE_BIN]
  : existsSync(join(PLUGIN_ROOT, 'node_modules', '@electric-sql', 'pglite')) ? [process.execPath, LOCAL_IDLE]
    : ['npx', '-y', 'idle-agent-tasks@0.4.0'];
const SKILL_TOOL = /^skill$/i;
const MAX_LINES = positiveInt(process.env.PIPELINE_INJECT_MAX_LINES, 300);
// Codex truncates injected context hard at ~1k tokens and spills past 2.5k, so
// it gets pointers where other hosts can take contents.
const CODEX_MAX_LINES = positiveInt(process.env.PIPELINE_INJECT_MAX_LINES, 60);
const CHECK_TIMEOUT_MS = positiveInt(process.env.PIPELINE_CHECK_TIMEOUT_MS, 45_000);

const DIGEST_SKILLS = new Set([
  'design', 'create-pr', 'review', 'build',
]);

const EXTRA = {
  review: { checks: true, diff: true },
  build: { checks: true, checksNote: 'baseline, ran before this session\'s edits' },
};

// The workflow skills know no tracker; this is how they learn the project has one.
const LEAD = 'orchestrate';
const LEAD_NOTE = 'This project tracks its work in idle-tasks, the record of work. Load the `idle-tasks:idle` skill '
  + 'and keep the goal, the maintainer\'s words, the plan, decisions and assumptions in the record, as its '
  + '"With the workflow skills" section says. Brief each builder and reviewer from `idle show <id> --brief`.';
const WORKER_NOTE = 'This task is tracked in idle-tasks, the record of work. Load the `idle-tasks:idle` skill and take '
  + 'the task, hand it back, and record decisions or your verdict there, as its "With the workflow skills" section says.';

let maxLines = MAX_LINES;

function positiveInt(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function pick(payload, keys) {
  for (const key of keys) if (payload?.[key] !== undefined) return payload[key];
  return undefined;
}

// -> parsed payload, {} when the host sent nothing, or null when it sent something
// unreadable. Absent input is a fact about the host; broken input is not ours to guess at.
function readPayload() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return {};
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// -> { kind: 'skill', name } | null
function resolveTarget(format) {
  const hint = process.argv[3] ?? '';
  if (format === 'opencode') {
    const name = normalizeName(hint);
    return name ? { kind: 'skill', name } : null;
  }
  const payload = readPayload();
  if (payload === null) return null;

  const tool = String(pick(payload, ['tool_name', 'toolName', 'tool']) ?? '');
  if (!SKILL_TOOL.test(tool)) return null;
  const input = pick(payload, ['tool_input', 'toolInput', 'parameters', 'input']) ?? {};
  const name = normalizeName(String(pick(input, ['skill', 'name', 'command']) ?? ''));
  return name ? { kind: 'skill', name } : null;
}

// Hosts qualify plugin-provided names — "idle-skills:review", "idle-skills:build".
// The routing tables key on the bare name.
function normalizeName(raw) {
  return raw.replace(/^\//, '').split(/\s/)[0].toLowerCase().replace(/^[a-z0-9_-]+:/, '');
}

function idle(root, ...args) {
  const [command, ...prefix] = IDLE;
  const result = spawnSync(command, [...prefix, ...args], { cwd: root, encoding: 'utf8', timeout: 20_000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

// The project's own checks — the ones the record runs when a task is submitted.
function checkCommand(root) {
  try {
    const checks = JSON.parse(idle(root, 'doctor') ?? '{}').checks;
    return Array.isArray(checks) && checks.length ? checks.join(' && ') : null;
  } catch {
    return null;
  }
}

// The root task being worked: the most recently touched one that is not finished.
function findActiveRoot(root) {
  try {
    const roots = JSON.parse(idle(root, 'list') ?? '[]');
    return roots.find((task) => !['done', 'archived'].includes(task.status)) ?? null;
  } catch {
    return null;
  }
}

function cap(text, label) {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join('\n')}\n… [truncated — full: ${label}]`;
}

// Stamps check results against the tree they ran on, so an agent can tell
// whether a green predates its own edits.
function treeState(root) {
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5_000 });
  if (head.status !== 0) return null;
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  const suffix = dirty.status === 0 && (dirty.stdout ?? '').trim() !== '' ? '+dirty' : '';
  return `${head.stdout.trim()}${suffix}`;
}

function runChecks(root, command) {
  // Outside the repository: nothing a run writes may land in the work tree.
  const cacheDir = join(tmpdir(), 'idle-tasks-checks');
  const cachePath = join(cacheDir, `${createHash('sha1').update(root).digest('hex').slice(0, 12)}.log`);
  const result = spawnSync(command, {
    shell: true, cwd: root, encoding: 'utf8', timeout: CHECK_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status === null) {
    try {
      return { text: readFileSync(cachePath, 'utf8').trim(), stale: true, exit: null };
    } catch {
      return null;
    }
  }
  const text = `${(result.stdout ?? '') + (result.stderr ?? '')}`.trim() || '(no output)';
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, `${text}\n`);
  } catch { /* cache is best-effort */ }
  return { text, stale: false, exit: result.status };
}

function diffSince(root, since) {
  if (!/^[\w.][\w.-]{0,63}$/.test(since)) return null;
  const result = spawnSync('git', ['diff', since, '--'], {
    cwd: root, encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  const diff = (result.stdout ?? '').trim();
  if (diff === '') return { text: '(no changes)', lines: 0 };
  const lines = diff.split('\n').length;
  if (lines <= maxLines) return { text: diff, lines };
  const stat = spawnSync('git', ['diff', '--stat', since, '--'], { cwd: root, encoding: 'utf8', timeout: 15_000 });
  return {
    text: `${(stat.stdout ?? '').trim()}\n… [diff too large to inject — run: git diff ${since}]`,
    lines,
  };
}

function findLore(root) {
  const result = spawnSync('git', ['grep', '-n', '@lore:'], {
    cwd: root, encoding: 'utf8', timeout: 5_000, maxBuffer: 512 * 1024,
  });
  if (result.status !== 0) return null;
  const lines = (result.stdout ?? '').trim().split('\n').filter(Boolean);
  return lines.length ? lines.slice(0, 25).join('\n') : null;
}

// Where the work happens and what it started from: an active child's, else the root's —
// the same task the record runs its checks for.
function findWork(root, activeId) {
  try {
    const shown = JSON.parse(idle(root, 'show', activeId) ?? '{}');
    const treeOut = idle(root, 'list', '--root', activeId) ?? '';
    const treeIds = [...treeOut.matchAll(/^\s*(\S+)\s+\[(claimed|submitted|verified)\b/gm)]
      .map((m) => m[1])
      .filter((id) => id !== activeId);
    const childIds = (shown.children ?? [])
      .filter((c) => ['claimed', 'submitted', 'verified'].includes(c.status))
      .map((c) => c.id);
    const rootMeta = shown.task?.metadata ?? {};
    let meta = rootMeta;
    for (const id of new Set([...childIds, ...treeIds])) {
      const childMeta = JSON.parse(idle(root, 'show', id) ?? '{}').task?.metadata;
      if (childMeta?.since) { meta = childMeta; break; }
    }
    const worktree = meta.worktree ?? rootMeta.worktree;
    return {
      since: meta.since ?? null,
      dir: typeof worktree === 'string' && existsSync(worktree) ? worktree : root,
    };
  } catch {
    return { since: null, dir: root };
  }
}

function buildInjection(format) {
  if (process.env.PIPELINE_SKILL_INJECT === 'off') return null;
  const target = resolveTarget(format);
  if (!target) return null;

  // No leading bracket: codex discards stdout that looks like JSON but is not.
  const header = (id) => `pipeline injection — ${target.kind}: ${target.name}${id ? `, task: ${id}` : ''}`;
  if (target.name === LEAD) return [header(null), '## record of work', LEAD_NOTE].join('\n\n');
  if (!DIGEST_SKILLS.has(target.name)) return null;
  const extra = EXTRA[target.name] ?? {};

  const root = process.cwd();
  const active = findActiveRoot(root);
  if (!active) return null;
  const sections = [header(active.id), '## record of work', WORKER_NOTE];

  const work = findWork(root, active.id);
  const lore = findLore(work.dir);
  if (lore) sections.push('## lore', cap(lore, 'git grep -n "@lore:"'));

  const state = idle(root, 'show', active.id, '--state');
  if (state) sections.push('## state', cap(state, `idle show ${active.id} --state`));

  if (extra.checks) {
    const command = checkCommand(root);
    if (command) {
      const outcome = runChecks(work.dir, command);
      if (outcome) {
        const staleness = outcome.stale ? ', STALE cache, live run timed out' : '';
        const exit = outcome.exit === null ? '?' : outcome.exit;
        const tree = treeState(work.dir);
        const marks = [`exit ${exit}`, tree ? `tree ${tree}` : null, work.dir === root ? null : `in ${work.dir}`, extra.checksNote ?? null]
          .filter(Boolean).join(', ');
        sections.push(`## checks — ${command} (${marks}${staleness})`, cap(outcome.text, 'rerun the check command'));
      }
    }
  }

  if (extra.diff) {
    const { since } = work;
    if (since) {
      const diff = diffSince(work.dir, String(since));
      if (diff) sections.push(`## diff since ${since} (${diff.lines} lines)`, cap(diff.text, `git diff ${since}`));
    }
  }

  return sections.join('\n\n');
}

function formatMessage(format, event, message) {
  if (format === 'cursor') return { additional_context: message };
  if (format === 'gemini') return { hookSpecificOutput: { additionalContext: message } };
  if (format === 'copilot') return { additionalContext: message };
  return { hookSpecificOutput: { hookEventName: event, additionalContext: message } };
}

function main() {
  const format = process.argv[2] ?? 'claude';
  if (format === 'codex') maxLines = CODEX_MAX_LINES;
  const message = buildInjection(format);
  if (!message) return;
  // Codex and opencode take plain text. Never lead with `{` or `[` on codex: a
  // JSON-looking payload that fails its schema is discarded, output and all.
  if (format === 'opencode' || format === 'codex') {
    process.stdout.write(`${message}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(formatMessage(format, 'PostToolUse', message))}\n`);
}

try {
  main();
} catch {
  // A guard must never break a skill load.
}
