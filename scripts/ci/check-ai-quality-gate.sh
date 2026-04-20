#!/usr/bin/env bash
# AI Quality Gate — static pattern checks that encode the findings from
# the v0.4.3 review passes so the same class of regression cannot
# silently reappear in a future AI-drafted change.
#
# Each check is a greppable invariant:
#   1. No dead codex-scaffold exports (thread / broker / subprocess
#      functions that only made sense for the codex-plugin-cc runtime)
#   2. No threadId / turnId scaffolding (GLM is stateless HTTP)
#   3. No safeReadConfigOrNull re-appearance (fail-open wrapper
#      deleted after the corrupt-merge fix)
#   4. No drifted verdict enum `ready|needs_fixes|blocked` outside
#      comments (the shipped schema uses `approve|needs-attention`)
#   5. No bare `error instanceof Error ? ...` outside the
#      formatUserFacingError helper (single-site redaction contract)
#   6. No call to formatResumeCommand (deleted; GLM has no thread
#      concept to resume)
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

# 1. Dead codex-scaffold exports.
check "findLatestTaskThread revived — GLM is stateless, this function always returned null" \
  '^\s*export\s+(async\s+)?function\s+findLatestTaskThread\b'
check "interruptAppServerTurn revived — GLM has no app-server, this was a no-op shape" \
  '^\s*export\s+(async\s+)?function\s+interruptAppServerTurn\b'
check "terminateProcessTree revived — GLM runs synchronously in-process, no subprocess tree" \
  '^\s*export\s+function\s+terminateProcessTree\b'
check "formatResumeCommand revived — GLM has no thread to resume" \
  '\bformatResumeCommand\s*\('

# 2. threadId / turnId scaffolding.
# Allow any tombstone comment on the render.mjs column drop but block
# real reading/writing of the fields in live code.
check "threadId / turnId scaffolding revived — GLM response shapes don't carry threads" \
  '^\s*(threadId|turnId)\s*:\s*(execution|normalized|source|value|null|storedJob|job)'
check "threadId/turnId field read in live code — GLM jobs have no thread identity" \
  '(\bjob|\bstoredJob|\bexecution|\bnormalized)\.(threadId|turnId)\b'
check "TASK_THREAD_PREFIX revived — renamed to TASK_TITLE_PREFIX (it builds a job title, not a thread name)" \
  '\bTASK_THREAD_PREFIX\b'

# 3. safeReadConfigOrNull — the fail-open wrapper that dropped user
#    config fields on any corruption during writeConfigFile merge.
check "safeReadConfigOrNull revived — corrupt config must surface clearly, not silently merge-over" \
  '^\s*function\s+safeReadConfigOrNull\b'

# 4. Drifted verdict enum — the shipped review schema uses
#    `approve | needs-attention`, not `ready|needs_fixes|blocked`.
check "drifted verdict enum — use approve|needs-attention per shipped schema" \
  '"verdict \(ready\|needs_fixes\|blocked\)"'

# 5. Bare error-message extraction outside the single helper site.
#    formatUserFacingError in scripts/lib/fs.mjs pulls .message from
#    Error instances, falls back to String(), and redacts $HOME. Every
#    call site should delegate to it for consistent, redacted output.
BARE_ERROR_HITS=$(grep -rEn --include='*.mjs' \
  '\berror instanceof Error \? error\.message : String\(error\)' scripts/ 2>/dev/null \
  | grep -v 'scripts/lib/fs.mjs' || true)
if [[ -n "$BARE_ERROR_HITS" ]]; then
  echo "✗ Bare 'error instanceof Error ? error.message : String(error)' outside fs.mjs — use formatUserFacingError:"
  echo "$BARE_ERROR_HITS" | sed 's/^/    /'
  echo
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# 6. Stale `GLM_MODEL` env-var doc references — the override was
#    dropped in v0.3.0; `default_model` in the config file is the
#    source of truth.
STALE_GLM_MODEL=$(grep -rEn 'GLM_MODEL env var' README.md commands/ 2>/dev/null || true)
if [[ -n "$STALE_GLM_MODEL" ]]; then
  echo "✗ Stale GLM_MODEL env var reference (the override was removed in v0.3.0; use default_model):"
  echo "$STALE_GLM_MODEL" | sed 's/^/    /'
  echo
  VIOLATIONS=$((VIOLATIONS + 1))
fi

if [[ $VIOLATIONS -gt 0 ]]; then
  echo "FAIL — $VIOLATIONS AI-quality-gate pattern(s) violated."
  echo "Each pattern encodes a finding from the v0.4.3 review passes."
  echo "See CHANGELOG.md § Fixed for the corresponding entry."
  exit 1
fi

echo "OK — AI quality gate clean (no known regression patterns)."
