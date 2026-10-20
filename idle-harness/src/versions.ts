// Versions of a harness folder. Git keeps them; the base drives it, and the agent commits nothing.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The user's own git setup has no say in here: not their config, identity, signing, hooks or ignores,
// and not a repository named in the environment.
const settings = ['user.name=idle-harness', 'user.email=idle-harness@localhost', 'commit.gpgsign=false', 'core.hooksPath=/dev/null', 'core.excludesFile=/dev/null', 'init.defaultBranch=main'];

function git(dir: string, ...args: string[]): string {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const run = spawnSync('git', [...settings.flatMap((setting) => ['-c', setting]), ...args], { cwd: dir, encoding: 'utf8', env });
  if (run.status !== 0) throw new Error(`git ${args[0]}: ${(run.stderr || run.error?.message || '').trim()}`);
  return run.stdout.trim();
}

// A harness folder becomes a repository the first time it is used. Its first version is the empty folder.
export function init(dir: string) {
  if (existsSync(join(dir, '.git'))) return;
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  mkdirSync(join(dir, '.git', 'info'), { recursive: true });
  appendFileSync(join(dir, '.git', 'info', 'exclude'), '.sessions/\n'); // the base's records are not the harness
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'empty');
}

// Saves a version when the folder changed, and says which version the folder is at.
export function save(dir: string, why: string): string {
  if (git(dir, 'status', '--porcelain', '--untracked-files=all')) {
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', why);
  }
  return git(dir, 'rev-parse', '--short', 'HEAD');
}

export const list = (dir: string) => git(dir, 'log', '-n', '30', '--format=%h  %cd  %s', '--date=format:%Y-%m-%d %H:%M');

function known(version: string): string {
  if (!/^[0-9a-f]{4,40}$/.test(version ?? '')) throw new Error('name a version as the list shows it');
  return version;
}

export const show = (dir: string, version: string) => git(dir, 'show', '--stat', '--patch', '--format=%h  %cd  %s', known(version));

// What a change says about itself, kept as a note on its version: what friction it answers, what it changes, what it
// expects to get better, whether it is general or about this harness's domain, and the records it rests on. An
// assessment, written later by improvement, says whether the change was kept and what the signals did.
export type Declaration = { change: string; friction: string; expect: string; scope: 'general' | 'domain'; evidence: string[]; by: string; at: string };
export type Assessment = { verdict: 'kept' | 'undone' | 'flagged'; signals: string; evidence: string[]; by: string; at: string };
type Note = ({ kind: 'declaration' } & Declaration) | ({ kind: 'assessment' } & Assessment);

// Saves what the folder holds now and notes the declaration on that version.
export function declare(dir: string, declaration: Declaration, why: string): string {
  const version = save(dir, why);
  git(dir, 'notes', 'append', '-m', JSON.stringify({ kind: 'declaration', ...declaration }), version);
  return version;
}

export function assess(dir: string, version: string, assessment: Assessment) {
  git(dir, 'notes', 'append', '-m', JSON.stringify({ kind: 'assessment', ...assessment }), git(dir, 'rev-parse', '--short', known(version)));
}

// Every version, oldest first, with what was noted on it.
export function history(dir: string): { version: string; at: string; why: string; declarations: Declaration[]; assessments: Assessment[] }[] {
  return git(dir, 'log', '--reverse', '--format=%h%x00%cI%x00%s%x00%N%x1e').split('\x1e').map((row) => row.trim()).filter(Boolean).map((row) => {
    const [version, at, why, notes = ''] = row.split('\x00');
    const all: Note[] = notes.split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    const pick = <K extends Note['kind']>(kind: K) => all.filter((note) => note.kind === kind).map(({ kind: _, ...rest }) => rest) as any[];
    return { version, at, why, declarations: pick('declaration'), assessments: pick('assessment') };
  });
}

// Going back is itself a version, so nothing is ever lost.
export function restore(dir: string, version: string): string {
  save(dir, `before going back to ${known(version)}`);
  try {
    git(dir, 'restore', `--source=${version}`, '--staged', '--worktree', '--', '.');
  } catch (error: any) {
    if (!/did not match/.test(error.message)) throw error; // an empty folder going back to an empty version
  }
  return save(dir, `back to ${version}`);
}
