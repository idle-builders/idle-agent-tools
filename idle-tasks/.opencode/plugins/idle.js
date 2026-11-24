/**
 * idle-tasks — opencode plugin.
 *
 * Ports the skill-load injection hook: when a workflow skill loads, the state of
 * the task tree, fresh check results and the diff are appended to the skill
 * tool's result (logic lives in hooks/inject.mjs; see that guard).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SKILL_TOOL = /^skill$/i;
// opencode reports no skill name on the tool input, so it is read back out of
// the rendered skill result — the only handle available. Fails closed.
const SKILL_NAME = /<skill_content name="([\w-]+)"/;
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
// Repo and npm layouts keep the hook under hooks/; a project install has only
// .opencode/, so install-opencode.sh drops it in .opencode/pipeline/ — beside
// plugins/ rather than inside it, since opencode loads plugins/ as modules.
const INJECT_HOOK = [
  join(PLUGIN_DIR, "..", "..", "hooks", "inject.mjs"),
  join(PLUGIN_DIR, "..", "pipeline", "inject.mjs"),
].find((path) => existsSync(path));

export const IdleTasks = async () => {
  return {
    "tool.execute.after": async (input, output) => {
      try {
        if (!INJECT_HOOK || !input || !SKILL_TOOL.test(input.tool || "") || typeof output?.output !== "string") return;
        const name = (output.output.slice(0, 500).match(SKILL_NAME) || [])[1];
        if (!name) return;
        const injected = spawnSync(process.execPath, [INJECT_HOOK, "opencode", name], {
          cwd: process.cwd(), encoding: "utf8", timeout: 60_000,
        });
        if (injected.status === 0 && injected.stdout.trim()) {
          output.output += `\n\n---\n${injected.stdout.trim()}`;
        }
      } catch {
        // A skill load must never break.
      }
    },
  };
};
