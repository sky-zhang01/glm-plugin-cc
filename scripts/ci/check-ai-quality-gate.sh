#!/usr/bin/env bash
# AI Quality Gate — static pattern checks that encode the findings from
# the v0.4.3 hotfix passes (Bundle C / D3+ / E+ / F) so the same class
# of regression cannot silently reappear.
#
# Each check is a greppable invariant:
#   1. No dead codex-scaffold exports (deleted in Bundle E+)
#   2. No threadId / turnId scaffolding (deleted in Bundle F)
#   3. No safeReadConfigOrNull re-appearance (deleted in Bundle C MED-1)
#   4. No drifted verdict enum `ready|needs_fixes|blocked` outside
#      comments (deleted in Bundle C MED-3)
#   5. No bare `error instanceof Error ? ...` outside the
#      formatUserFacingError helper (Bundle E+ P2-1 centralization)
#   6. No call to formatResumeCommand (deleted, Bundle E+/F)
#
# Usage: bash scripts/ci/check-ai-quality-gate.sh
# Exit 0 on clean, exit 1 on any violation.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

VIOLATIONS=0

# Limit scanning to real source paths. Tests and docs are allowed to
# reference the names for regression-guard assertions.
SOURCE_GLOB='scripts/**/*.mjs'

check() {
  local label="$1"
  local pattern="$2"
  local scope="${3:-$SOURCE_GLOB}"
  # -E extended regex, -n line numbers, recursive, restricted to scope.
  # shellcheck disable=SC2046
  local hits
  hits=$(grep -rEn --include='*.mjs' "$pattern" scripts/ 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    echo "✗ $label:"
    echo "$hits" | sed 's/^/    /'
    echo
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
}

# 1. Dead codex-scaffold exports (deleted in Bundle E+).
check "findLatestTaskThread revived (deleted Bundle E+)" \
  '^\s*export\s+(async\s+)?function\s+findLatestTaskThread\b'
check "interruptAppServerTurn revived (deleted Bundle E+)" \
  '^\s*export\s+(async\s+)?function\s+interruptAppServerTurn\b'
check "terminateProcessTree revived (deleted Bundle E+)" \
  '^\s*export\s+function\s+terminateProcessTree\b'
check "formatResumeCommand revived (deleted Bundle E+)" \
  '\bformatResumeCommand\s*\('

# 2. threadId / turnId scaffolding (deleted in Bundle F).
# We allow the tombstone comment on line ~435 of render.mjs but block
# any real reading/writing of the fields. Grep for the JS access
# patterns — `.threadId` on a real variable, not in a //-comment.
check "threadId / turnId scaffolding revived (deleted Bundle F)" \
  '^\s*(threadId|turnId)\s*:\s*(execution|normalized|source|value|null|storedJob|job)'
check "threadId/turnId field read in live code (deleted Bundle F)" \
  '(\bjob|\bstoredJob|\bexecution|\bnormalized)\.(threadId|turnId)\b'
check "TASK_THREAD_PREFIX revived (renamed to TASK_TITLE_PREFIX in Bundle F)" \
  '\bTASK_THREAD_PREFIX\b'

# 3. safeReadConfigOrNull (deleted Bundle C MED-1).
check "safeReadConfigOrNull revived (deleted Bundle C MED-1)" \
  '^\s*function\s+safeReadConfigOrNull\b'

# 4. Drifted verdict enum (deleted Bundle C MED-3).
# Allow inside comments — only flag as actual string literal.
check "drifted verdict enum (Bundle C MED-3) — use approve|needs-attention per shipped schema" \
  '"verdict \(ready\|needs_fixes\|blocked\)"'

# 5. Bare error-message extraction outside the helper.
# formatUserFacingError lives in scripts/lib/fs.mjs and is the single
# allowed site. Any other file repeating the pattern should use the
# helper instead.
BARE_ERROR_HITS=$(grep -rEn --include='*.mjs' \
  '\berror instanceof Error \? error\.message : String\(error\)' scripts/ 2>/dev/null \
  | grep -v 'scripts/lib/fs.mjs' || true)
if [[ -n "$BARE_ERROR_HITS" ]]; then
  echo "✗ Bare 'error instanceof Error ? error.message : String(error)' outside fs.mjs — use formatUserFacingError:"
  echo "$BARE_ERROR_HITS" | sed 's/^/    /'
  echo
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# 6. Stale GLM_MODEL env-var doc references (removed Bundle C m-1).
STALE_GLM_MODEL=$(grep -rEn 'GLM_MODEL env var' README.md commands/ 2>/dev/null || true)
if [[ -n "$STALE_GLM_MODEL" ]]; then
  echo "✗ Stale GLM_MODEL env var reference (Bundle C m-1 removed this override):"
  echo "$STALE_GLM_MODEL" | sed 's/^/    /'
  echo
  VIOLATIONS=$((VIOLATIONS + 1))
fi

if [[ $VIOLATIONS -gt 0 ]]; then
  echo "FAIL — $VIOLATIONS AI-quality-gate pattern(s) violated."
  echo "Each pattern encodes a finding from the v0.4.3 hotfix passes."
  echo "See CHANGELOG.md § 'Fixed/Simplified' for the corresponding Bundle entry."
  exit 1
fi

echo "OK — AI quality gate clean (no known regression patterns)."
