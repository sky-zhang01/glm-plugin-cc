#!/usr/bin/env bash
# Local one-shot CI: runs every check the server workflows run,
# in the same order, so `npm run ci:local` fully replicates CI on the
# developer machine before `git push`.
#
# Usage: bash scripts/ci/check-all.sh
# Exit 0 only when every step passed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

run_step() {
  local label="$1"
  shift
  echo ""
  echo "────────────────────────────────────────────────────────────"
  echo "  $label"
  echo "────────────────────────────────────────────────────────────"
  "$@"
}

run_step "syntax check (npm run check)" \
  npm run check

run_step "unit + integration tests (npm test)" \
  npm test

run_step "path-leak guard" \
  bash scripts/ci/check-no-local-paths.sh

run_step "plugin manifest validation" \
  bash scripts/ci/check-plugin-manifest.sh

run_step "AI quality gate (static regression patterns)" \
  bash scripts/ci/check-ai-quality-gate.sh

run_step "public surface gate" \
  node scripts/ci/check-public-surface.mjs

# Skip CHANGELOG / Co-Authored-By when no remote base ref exists (e.g.
# fresh clone with no origin/main) — they still run in real CI.
if git show-ref --verify --quiet refs/remotes/origin/main; then
  run_step "CHANGELOG update gate" \
    bash scripts/ci/check-changelog-updated.sh
  run_step "Co-Authored-By trailer check" \
    bash scripts/ci/check-coauthored-by.sh
else
  echo ""
  echo "⚠ origin/main not found — skipping CHANGELOG + Co-Authored-By checks."
  echo "  These still run in real CI once the PR is opened."
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  All local CI checks passed."
echo "════════════════════════════════════════════════════════════"
