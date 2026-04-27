#!/usr/bin/env bash
# Validate .claude-plugin/marketplace.json + plugin.json parse as JSON
# and carry the fields Claude Code's plugin system requires. Prevents
# a repeat of the v0.4.0 → v0.4.1 breakage where
# `marketplace.json.plugins[0].source = "."` silently failed to install.
#
# Usage: bash scripts/ci/check-plugin-manifest.sh
# Exit 0 on OK, exit 1 on any validation error.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

MARKETPLACE=".claude-plugin/marketplace.json"
PLUGIN=".claude-plugin/plugin.json"
ERRORS=0

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "✗ Missing required file: $1"
    ERRORS=$((ERRORS + 1))
    return 1
  fi
  return 0
}

parse_json() {
  # We use node because the repo already requires node for tests; jq
  # is not always installed on self-hosted runners.
  node -e "JSON.parse(require('fs').readFileSync('$1','utf8'))" 2>&1
}

validate_marketplace() {
  local file="$1"
  if ! out=$(parse_json "$file"); then
    echo "✗ $file is not valid JSON:"
    echo "    $out"
    ERRORS=$((ERRORS + 1))
    return 1
  fi
  # Required fields per Claude Code plugin marketplace v2.1+:
  # - name: string
  # - plugins: array of { name, source, description }
  # - plugins[].source must end with "/" for a local-dir reference
  #   (regression guard for the v0.4.0 schema bug).
  node <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('.claude-plugin/marketplace.json', 'utf8'));
const errs = [];
if (typeof data.name !== 'string' || !data.name) errs.push('marketplace.name missing or not a string');
if (!Array.isArray(data.plugins) || data.plugins.length === 0) errs.push('marketplace.plugins missing or empty');
for (const [i, p] of (data.plugins ?? []).entries()) {
  if (!p || typeof p !== 'object') { errs.push(`plugins[${i}] not an object`); continue; }
  if (typeof p.name !== 'string' || !p.name) errs.push(`plugins[${i}].name missing`);
  if (typeof p.source !== 'string' || !p.source) errs.push(`plugins[${i}].source missing`);
  if (p.source === '.') errs.push(`plugins[${i}].source = "." — Claude Code rejects this; use "./"`);
}
if (errs.length) {
  console.error(errs.map(e => `    ${e}`).join('\n'));
  process.exit(1);
}
NODE
}

validate_plugin() {
  local file="$1"
  if ! out=$(parse_json "$file"); then
    echo "✗ $file is not valid JSON:"
    echo "    $out"
    ERRORS=$((ERRORS + 1))
    return 1
  fi
  node <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('.claude-plugin/plugin.json', 'utf8'));
const errs = [];
if (typeof data.name !== 'string' || !data.name) errs.push('plugin.name missing');
if (typeof data.version !== 'string' || !/^\d+\.\d+\.\d+/.test(data.version)) {
  errs.push(`plugin.version must be semver-ish, got: ${data.version}`);
}
if (typeof data.description !== 'string' || !data.description) {
  errs.push('plugin.description missing');
}
if (errs.length) {
  console.error(errs.map(e => `    ${e}`).join('\n'));
  process.exit(1);
}
NODE
}

require_file "$MARKETPLACE" || true
require_file "$PLUGIN" || true

if [[ -f "$MARKETPLACE" ]]; then
  if ! validate_marketplace "$MARKETPLACE"; then
    ERRORS=$((ERRORS + 1))
  fi
fi

if [[ -f "$PLUGIN" ]]; then
  if ! validate_plugin "$PLUGIN"; then
    ERRORS=$((ERRORS + 1))
  fi
fi

# Cross-check: marketplace version (if listed) must match plugin.json version.
if [[ -f "$MARKETPLACE" && -f "$PLUGIN" ]]; then
  if ! node <<'NODE'
const fs = require('fs');
const m = JSON.parse(fs.readFileSync('.claude-plugin/marketplace.json', 'utf8'));
const p = JSON.parse(fs.readFileSync('.claude-plugin/plugin.json', 'utf8'));
const entry = (m.plugins ?? []).find(x => x.name === p.name);
if (entry && typeof entry.version === 'string' && entry.version !== p.version) {
  console.error(`    marketplace.plugins[${p.name}].version=${entry.version} != plugin.json.version=${p.version}`);
  process.exit(1);
}
NODE
  then
    echo "✗ marketplace / plugin version mismatch"
    ERRORS=$((ERRORS + 1))
  fi
fi

if [[ $ERRORS -gt 0 ]]; then
  echo "FAIL — $ERRORS plugin manifest violation(s)."
  exit 1
fi

echo "OK — plugin manifest valid."
