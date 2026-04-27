#!/usr/bin/env bash
# Install the repo-tracked git hooks into .git/hooks/ as symlinks.
# Safe to re-run: overwrites existing same-name hooks, leaves others
# alone.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

GIT_DIR="$(git rev-parse --git-common-dir 2>/dev/null || echo .git)"
HOOKS_TARGET_DIR="$GIT_DIR/hooks"
SOURCE_DIR="$REPO_ROOT/scripts/hooks"

mkdir -p "$HOOKS_TARGET_DIR"

for src in "$SOURCE_DIR"/*; do
  [[ -f "$src" ]] || continue
  name=$(basename "$src")
  dst="$HOOKS_TARGET_DIR/$name"
  chmod +x "$src"
  ln -sf "$src" "$dst"
  echo "  linked $name → $src"
done

echo ""
echo "Hooks installed in $HOOKS_TARGET_DIR."
echo "Run 'git push' — the pre-push hook will now run local CI first."
