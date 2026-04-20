#!/usr/bin/env bash
# Verify AI-authored commits carry a Co-Authored-By trailer so the CI
# can (a) route them through the AI Quality Gate and (b) keep an
# audit-friendly trail of "which commit was written by which AI".
#
# A commit is considered AI-authored if its commit message or body
# mentions Claude / Codex / an AI Tool invocation. This is a heuristic —
# the script errs on the side of "require trailer" and the developer
# can add it explicitly.
#
# Usage: bash scripts/ci/check-coauthored-by.sh [base-ref]
#
# Exit 0 if all AI commits carry trailers. Exit 1 otherwise.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

BASE_REF="${1:-}"
if [[ -z "$BASE_REF" ]]; then
  if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
    BASE_REF="origin/${GITHUB_BASE_REF}"
  elif git show-ref --verify --quiet refs/remotes/origin/main; then
    BASE_REF="origin/main"
  else
    BASE_REF="HEAD~1"
  fi
fi

if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "⚠ base ref '$BASE_REF' not found; falling back to HEAD~1."
  BASE_REF="HEAD~1"
fi

COMMITS=$(git log --format="%H" "$BASE_REF..HEAD")

MISSING=0
for sha in $COMMITS; do
  body=$(git log -1 --format="%B" "$sha")
  # Heuristic: looks AI-drafted if the message mentions tool / agent
  # names we only use in AI-assisted passes. The literal "Bundle X"
  # marker still triggers because older internal commits used it.
  if echo "$body" | grep -qEi '(Bundle [A-Z][0-9]?\+?|Claude Code|claude\.md|Codex|\(round-[0-9]+|pr-review-toolkit)'; then
    if ! echo "$body" | grep -qE '^Co-Authored-By:'; then
      short=$(git log -1 --format="%h %s" "$sha")
      echo "✗ commit looks AI-authored but lacks Co-Authored-By trailer:"
      echo "    $short"
      MISSING=$((MISSING + 1))
    fi
  fi
done

if [[ $MISSING -gt 0 ]]; then
  echo ""
  echo "FAIL — $MISSING AI-style commit(s) missing 'Co-Authored-By:' trailer."
  echo ""
  echo "Add the trailer in each commit message (amend or replay):"
  echo "    Co-Authored-By: Claude <noreply@anthropic.com>"
  echo "    # or, if Codex:"
  echo "    Co-Authored-By: Codex <noreply@openai.com>"
  echo ""
  echo "This enables the AI Quality Gate workflow + keeps an audit trail."
  exit 1
fi

echo "OK — all AI-authored commits carry Co-Authored-By trailer (or no AI commits present)."
