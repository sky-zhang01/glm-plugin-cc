#!/usr/bin/env bash
# Require CHANGELOG.md in the diff whenever substantive source files
# change. Forces documentation discipline at CI time so no fix lands
# without a corresponding narrative entry.
#
# Triggers on changes to:
#   - scripts/**        (core logic)
#   - commands/**       (Claude Code command definitions)
#   - schemas/**        (shipped JSON schemas)
#   - prompts/**        (review prompt templates)
#   - .claude-plugin/** (plugin / marketplace manifests)
#
# Usage: bash scripts/ci/check-changelog-updated.sh [base-ref]
#   base-ref defaults to origin/main, or HEAD~1 when no origin is set.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

BASE_REF="${1:-}"
if [[ -z "$BASE_REF" ]]; then
  # CI provides GITHUB_BASE_REF (PR target) or we fall back to origin/main.
  if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
    BASE_REF="origin/${GITHUB_BASE_REF}"
  elif git show-ref --verify --quiet refs/remotes/origin/main; then
    BASE_REF="origin/main"
  else
    BASE_REF="HEAD~1"
  fi
fi

# Make sure the ref is actually there. If not (shallow clone), fall
# back to HEAD~1 and warn rather than failing with a cryptic git error.
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "⚠ base ref '$BASE_REF' not found; falling back to HEAD~1."
  BASE_REF="HEAD~1"
fi

CHANGED=$(git diff --name-only "$BASE_REF"...HEAD)

needs_changelog=0
while IFS= read -r file; do
  case "$file" in
    scripts/*|commands/*|schemas/*|prompts/*|.claude-plugin/*)
      needs_changelog=1
      ;;
  esac
done <<< "$CHANGED"

if [[ $needs_changelog -eq 0 ]]; then
  echo "OK — no changes in scripts/commands/schemas/prompts/.claude-plugin."
  echo "     CHANGELOG update not required for this PR."
  exit 0
fi

if grep -qE '^CHANGELOG\.md$' <<< "$CHANGED"; then
  echo "OK — CHANGELOG.md included in this PR's diff."
  exit 0
fi

echo "FAIL — this PR touches substantive source / command / schema /"
echo "       prompt / manifest files but does not update CHANGELOG.md."
echo ""
echo "Changed files (source categories):"
while IFS= read -r file; do
  case "$file" in
    scripts/*|commands/*|schemas/*|prompts/*|.claude-plugin/*)
      echo "    - $file"
      ;;
  esac
done <<< "$CHANGED"
echo ""
echo "Add a CHANGELOG.md entry describing the change, then amend or"
echo "push a new commit. See CONTRIBUTING.md for the expected format."
exit 1
