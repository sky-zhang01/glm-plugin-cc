#!/usr/bin/env bash
# Block any committed file that leaks a local absolute path, private IP,
# MAC address, or internal hostname. Enforces Sky's global sensitive-info
# policy at CI time instead of relying only on the runtime redaction
# helper (scripts/lib/fs.mjs redactHomePath).
#
# Usage: bash scripts/ci/check-no-local-paths.sh
# Exit 0 on clean, exit 1 on any match.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Patterns we refuse in tracked content. Each pattern is paired with a
# short label for the error message. We scan every tracked file; binary
# files are skipped by ripgrep/grep defaults, and this script's own file
# is skipped because it carries the patterns as regex literals by design.
declare -a PATTERNS=(
  '/Users/[a-zA-Z0-9_.-]+/'              # macOS home paths
  '/home/[a-zA-Z0-9_.-]+/'               # Linux home paths
  '\b10\.[0-9]+\.[0-9]+\.[0-9]+\b'       # private 10.x IPs
  '\b192\.168\.[0-9]+\.[0-9]+\b'         # private 192.168.x IPs
  '\b172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+\b'  # private 172.16-31.x IPs
  '([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}'   # MAC addresses
  '[a-zA-Z0-9-]+\.tokyo\.skyzhang\.net'  # private gitea hostname
)

declare -a LABELS=(
  "macOS home path"
  "Linux home path"
  "private IP 10.x"
  "private IP 192.168.x"
  "private IP 172.16-31.x"
  "MAC address"
  "private Sky hostname"
)

# Files / paths we intentionally exclude:
# - This script itself (contains the patterns by design).
# - Lock files, node_modules, dist, coverage, tool-results — standard
#   test / CI artifact dirs that a developer might leave behind.
# - CHANGELOG is allowed to mention "10.81.37.5" etc. in the free-form
#   commentary about network debugging history; enforce NOTHING on it.
#   Same for release_card.md.
EXCLUDE_GLOBS=(
  ':(exclude)scripts/ci/check-no-local-paths.sh'
  ':(exclude)node_modules/**'
  ':(exclude)dist/**'
  ':(exclude)coverage/**'
  ':(exclude)*.lock'
  ':(exclude)package-lock.json'
  ':(exclude)CHANGELOG.md'
  ':(exclude)release_card.md'
  ':(exclude)docs/ci.md'
)

VIOLATIONS=0
TMP_OUT="$(mktemp)"
trap 'rm -f "$TMP_OUT"' EXIT

# Enumerate tracked files once to avoid repeated git-ls-files calls.
git ls-files -- "${EXCLUDE_GLOBS[@]}" > "$TMP_OUT"

for i in "${!PATTERNS[@]}"; do
  pattern="${PATTERNS[$i]}"
  label="${LABELS[$i]}"
  # -E extended regex, -H always show filename, -n show line number, -I
  # skip binary files. xargs -0 would need null-separated paths; we
  # accept the trade-off of filename-with-space breakage (we don't
  # ship any such files and CI will loudly fail if we ever do).
  # shellcheck disable=SC2046
  if hits=$(grep -E -H -n -I "$pattern" $(cat "$TMP_OUT") 2>/dev/null); then
    if [[ -n "$hits" ]]; then
      echo "✗ $label violations:"
      echo "$hits" | sed 's/^/    /'
      echo
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
done

if [[ $VIOLATIONS -gt 0 ]]; then
  echo "FAIL — $VIOLATIONS pattern families matched."
  echo "Tracked files must not carry absolute local paths, private IPs,"
  echo "MAC addresses, or internal Sky hostnames. Move sensitive values"
  echo "to env vars / config, or redact before committing."
  exit 1
fi

echo "OK — no local paths / private IPs / MAC / hostnames in tracked files."
