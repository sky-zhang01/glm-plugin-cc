#!/usr/bin/env bash
# One-shot / idempotent configuration of gitea branch protection for
# `main` on SkyLab/glm-plugin-cc. Safe to re-run: GETs current state,
# then POSTs (create) or PATCHes (update) to match the intended spec.
#
# Usage: bash scripts/setup/configure-gitea-protection.sh
#
# Env overrides:
#   GITEA_HOST       default https://gitea.tokyo.skyzhang.net
#   GITEA_OWNER      default SkyLab
#   GITEA_REPO       default glm-plugin-cc
#   GITEA_BRANCH     default main
#   GITEA_TOKEN_FILE default ${HOME}/.claude/secrets/gitea-claude-code.pat
#
# This script uses the sky PAT (not the claude-code PAT) — branch
# protection changes are authoritative config, and the approver
# identity must match the single formal reviewer.
set -euo pipefail

GITEA_HOST="${GITEA_HOST:-https://gitea.tokyo.skyzhang.net}"
GITEA_OWNER="${GITEA_OWNER:-SkyLab}"
GITEA_REPO="${GITEA_REPO:-glm-plugin-cc}"
GITEA_BRANCH="${GITEA_BRANCH:-main}"
GITEA_TOKEN_FILE="${GITEA_TOKEN_FILE:-${HOME}/.claude/secrets/gitea-sky.pat}"

if [[ ! -r "$GITEA_TOKEN_FILE" ]]; then
  # Fall back to the claude-code PAT if sky PAT file doesn't exist —
  # with a warning, so the human operator knows the approver context.
  ALT="${HOME}/.claude/secrets/gitea-claude-code.pat"
  if [[ -r "$ALT" ]]; then
    echo "⚠ sky PAT not found at $GITEA_TOKEN_FILE; falling back to $ALT."
    GITEA_TOKEN_FILE="$ALT"
  else
    echo "✗ No gitea PAT found. Set GITEA_TOKEN_FILE or create $GITEA_TOKEN_FILE."
    exit 1
  fi
fi

TOKEN=$(cat "$GITEA_TOKEN_FILE")
API_BASE="${GITEA_HOST}/api/v1/repos/${GITEA_OWNER}/${GITEA_REPO}"

echo "Target : ${GITEA_OWNER}/${GITEA_REPO}@${GITEA_BRANCH}"
echo "Host   : ${GITEA_HOST}"
echo ""

# Intended spec.
read -r -d '' PROTECTION_BODY <<JSON || true
{
  "branch_name": "${GITEA_BRANCH}",
  "enable_push": false,
  "enable_push_whitelist": false,
  "enable_merge_whitelist": false,
  "required_approvals": 1,
  "enable_approvals_whitelist": true,
  "approvals_whitelist_usernames": ["sky"],
  "dismiss_stale_approvals": true,
  "block_on_rejected_reviews": true,
  "block_on_outdated_branch": true,
  "enable_status_check": true,
  "status_check_contexts": [
    "pr-check",
    "static-invariants"
  ],
  "require_signed_commits": false
}
JSON

existing=$(curl -s -o /tmp/gitea-protection.json -w "%{http_code}" \
  -H "Authorization: token ${TOKEN}" \
  -H "Accept: application/json" \
  "${API_BASE}/branch_protections/${GITEA_BRANCH}")

if [[ "$existing" == "200" ]]; then
  echo "Protection already exists; updating via PATCH…"
  code=$(curl -s -o /tmp/gitea-protection-response.json -w "%{http_code}" \
    -X PATCH \
    -H "Authorization: token ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$PROTECTION_BODY" \
    "${API_BASE}/branch_protections/${GITEA_BRANCH}")
elif [[ "$existing" == "404" ]]; then
  echo "No protection yet; creating via POST…"
  code=$(curl -s -o /tmp/gitea-protection-response.json -w "%{http_code}" \
    -X POST \
    -H "Authorization: token ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$PROTECTION_BODY" \
    "${API_BASE}/branch_protections")
else
  echo "✗ unexpected GET status: $existing"
  cat /tmp/gitea-protection.json
  exit 1
fi

if [[ "$code" != "200" && "$code" != "201" ]]; then
  echo "✗ write failed with HTTP ${code}:"
  cat /tmp/gitea-protection-response.json
  exit 1
fi

echo ""
echo "OK — protection applied (HTTP ${code})."
echo ""
echo "Summary:"
echo "  - direct push to ${GITEA_BRANCH}: BLOCKED"
echo "  - required approvals            : 1 (sky)"
echo "  - dismiss stale approvals       : yes"
echo "  - status checks                 : pr-check, static-invariants"
echo "  - block on outdated branch      : yes"
echo ""
echo "Re-run any time to re-apply — this script is idempotent."
