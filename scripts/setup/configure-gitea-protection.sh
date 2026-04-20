#!/usr/bin/env bash
# One-shot / idempotent configuration of gitea branch protection for
# the private-primary repo hosting this plugin. Safe to re-run: GETs
# current state, then POSTs (create) or PATCHes (update) to match the
# intended spec.
#
# Usage:
#   GITEA_HOST=https://your-gitea-host \
#   GITEA_OWNER=your-org \
#   GITEA_REPO=glm-plugin-cc \
#   bash scripts/setup/configure-gitea-protection.sh
#
# Required env:
#   GITEA_HOST       gitea base URL (e.g. https://gitea.example.com)
#   GITEA_OWNER      org or user that owns the repo
# Optional env:
#   GITEA_REPO       default glm-plugin-cc
#   GITEA_BRANCH     default main
#   GITEA_TOKEN_FILE default ${HOME}/.claude/secrets/gitea-approver.pat,
#                    falls back to gitea-claude-code.pat
#
# Prefer a PAT owned by the single formal approver; fall back to a
# CI PAT when the approver PAT isn't available locally.
set -euo pipefail

if [[ -z "${GITEA_HOST:-}" ]]; then
  echo "✗ GITEA_HOST not set. Export your gitea base URL and re-run."
  exit 1
fi
if [[ -z "${GITEA_OWNER:-}" ]]; then
  echo "✗ GITEA_OWNER not set. Export the org / user that owns the repo."
  exit 1
fi

GITEA_REPO="${GITEA_REPO:-glm-plugin-cc}"
GITEA_BRANCH="${GITEA_BRANCH:-main}"
GITEA_TOKEN_FILE="${GITEA_TOKEN_FILE:-${HOME}/.claude/secrets/gitea-approver.pat}"
GITEA_APPROVER="${GITEA_APPROVER:-${GITEA_OWNER}}"

if [[ ! -r "$GITEA_TOKEN_FILE" ]]; then
  # Fall back to a generic gitea PAT if the approver PAT file doesn't
  # exist — with a warning, so the human operator knows the identity
  # context.
  ALT="${HOME}/.claude/secrets/gitea-claude-code.pat"
  if [[ -r "$ALT" ]]; then
    echo "⚠ approver PAT not found at $GITEA_TOKEN_FILE; falling back to $ALT."
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
  "approvals_whitelist_usernames": ["${GITEA_APPROVER}"],
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
echo "  - required approvals            : 1 (${GITEA_APPROVER})"
echo "  - dismiss stale approvals       : yes"
echo "  - status checks                 : pr-check, static-invariants"
echo "  - block on outdated branch      : yes"
echo ""
echo "Re-run any time to re-apply — this script is idempotent."
