// A harness folder at one version: its own turn, its own tools, its settings. All of it is loaded again
// when the folder is at a new version. A working session lays a folder of its own over the harness, its layer: what is
// there counts for that session only, and a turn, tool or skill in it replaces the harness's of the same name.

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { KEPT } from './tools.ts';
import type { Skill, Tool } from './tools.ts';
import type { Turn } from './turn.ts';

// A folder at a version: the harness, or a session's layer over it. Lists of them run from the layer to the harness.
export type Folder = { dir: string; version: string };

// Node keeps the first copy of every file it imports. A harness's files carry the folder's version instead,
// so a new version loads all of them again, not just the file named first.
let loading = { root: '', version: '' };
registerHooks({
  resolve(specifier, context, next) {
    const found = next(specifier, context);
    const ours = loading.root && found.url.startsWith(loading.root) && !found.url.includes('?') && !found.url.includes('/node_modules/');
    return ours ? { ...found, url: `${found.url}?v=${loading.version}` } : found;
  },
});

async function load(dir: string, version: string, file: string) {
  loading = { root: pathToFileURL(`${realpathSync(dir)}/`).href, version };
  return import(pathToFileURL(join(dir, file)).href);
}

// The nearest turn.ts, or null for the plain turn. Throws when it cannot be used.
export async function turn(folders: Folder[]): Promise<Turn | null> {
  const found = folders.find((folder) => existsSync(join(folder.dir, 'turn.ts')));
  if (!found) return null;
  const { turn } = await load(found.dir, found.version, 'turn.ts');
  if (typeof turn !== 'function') throw new Error('turn.ts exports no function named turn');
  return turn;
}

// The tools of every folder, one per file in tools/, the nearest winning on a name. A file that cannot be used is
// left out, with the reason.
export async function tools(folders: Folder[]): Promise<{ tools: Tool[]; problems: string[] }> {
  const found = new Map<string, Tool>();
  const problems: string[] = [];
  for (const { dir, version } of [...folders].reverse()) {
    let files: string[] = [];
    try { files = existsSync(join(dir, 'tools')) ? readdirSync(join(dir, 'tools'), { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort() : []; } catch (error: any) { problems.push(`${join(dir, 'tools')}: ${error.message}`); }
    const where = folders.length > 1 && dir === folders[0].dir ? "your layer's " : '';
    // A script in tools/ looks like a tool and is not one: it is offered to no session unless a tool runs it.
    for (const file of files.filter((f) => !f.endsWith('.ts'))) problems.push(`${where}tools/${file}: only .ts files are tools; to offer it, write a tools/<name>.ts that runs it`);
    for (const file of files.filter((f) => f.endsWith('.ts'))) {
      const name = file.slice(0, -'.ts'.length);
      try {
        if (!/^[\w-]{1,64}$/.test(name)) throw new Error('a tool name is letters, digits, _ and -, at most 64');
        if (KEPT.has(name)) throw new Error(`${name} is the base's and stays so`);
        const { description, parameters, run } = await load(dir, version, join('tools', file));
        if (typeof description !== 'string' || typeof parameters !== 'object' || typeof run !== 'function') throw new Error('it must export description, parameters and run');
        found.set(name, { spec: { type: 'function', function: { name, description, parameters } }, run });
      } catch (error: any) {
        problems.push(`${where}tools/${file}: ${error?.message ?? error}`);
      }
    }
  }
  return { tools: [...found.values()], problems };
}

// The skills a harness can load: its own in skills/<name>/SKILL.md, and those in the folders its config.json names
// ("skills": ["~/.claude/skills", …]), which is how skills from plugins are reused. Its own win on a name. A skill's
// description, from its frontmatter, says when it applies; the rest loads only when a task needs it.
export function skills(dir: string, layer?: string): Skill[] {
  const found = new Map<string, Skill>();
  const folders = [...(layer ? [join(layer, 'skills')] : []), join(dir, 'skills'), ...(settings(dir).skills ?? []).map((folder) => resolve(dir, folder.replace(/^~(?=\/|$)/, homedir())))];
  for (const folder of folders) {
    let names: string[] = [];
    try { names = readdirSync(folder); } catch { continue; }
    for (const name of names.sort()) {
      const path = join(folder, name, 'SKILL.md');
      if (found.has(name) || !existsSync(path)) continue;
      const head = readFileSync(path, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
      const description = head.match(/^description:\s*(.+)$/m)?.[1].trim().replace(/^(['"])(.*)\1$/, '$2') ?? '';
      found.set(name, { name, description, path });
    }
  }
  return [...found.values()];
}

// What the harness remembers across sessions: memory/MEMORY.md, which every new session starts with, and what a
// session put in its layer's, when it picks up again.
export function memory(...dirs: string[]): string {
  return dirs.map((dir) => { try { return readFileSync(join(dir, 'memory', 'MEMORY.md'), 'utf8'); } catch { return ''; } }).filter(Boolean).join('\n\n').slice(0, 10_000);
}

// Whether working sessions keep their changes in a layer, as by default, or change the harness itself ("layers": false).
export const layered = (dir: string) => settings(dir).layers !== false;

// What the harness has set for itself. A config.json that cannot be read counts as none.
export function settings(dir: string): { model?: string; contextLimit?: number; improveEvery?: number; skills?: string[]; layers?: boolean } {
  try { return JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')); } catch { return {}; }
}
