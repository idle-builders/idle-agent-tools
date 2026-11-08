#!/usr/bin/env bash
set -euo pipefail

# Install the weekly /self-improve automation into a target project, and remove
# the persona roles earlier versions installed.
# Usage: scripts/install-codex.sh [project-root]

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../idle-skills" && pwd)"
TARGET_ROOT="${1:-$(pwd)}"
TARGET_ROOT="$(cd "$TARGET_ROOT" && pwd)"

CODEX_DIR="$TARGET_ROOT/.codex"
AUTOMATIONS_DIR="$CODEX_DIR/automations"
CONFIG_FILE="$CODEX_DIR/config.toml"
mkdir -p "$AUTOMATIONS_DIR"

cp "$PLUGIN_ROOT/.codex/automations/weekly-self-improve.toml" "$AUTOMATIONS_DIR/weekly-self-improve.toml"

rm -f "$CODEX_DIR/agents/idle-planner.toml" "$CODEX_DIR/agents/idle-reviewer.toml" "$CODEX_DIR/agents/idle-builder.toml"
if [ -f "$CONFIG_FILE" ]; then
  python3 - "$CONFIG_FILE" "# BEGIN agent-skills-pipeline codex agents" "# END agent-skills-pipeline codex agents" <<'PY'
from pathlib import Path
import sys

path, start, end = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
text = path.read_text()
if start in text and end in text:
    before, rest = text.split(start, 1)
    _, after = rest.split(end, 1)
    path.write_text(before.rstrip() + ("\n" + after.lstrip() if after.strip() else "\n"))
PY
fi

printf 'Installed the weekly self-improve automation into %s\n' "$CODEX_DIR"
