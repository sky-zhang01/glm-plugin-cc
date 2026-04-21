#!/usr/bin/env bash
# UAT harness for v0.4.4 /glm:setup interactive menu.
#
# Runs each menu option's companion-layer call against an isolated
# XDG_CONFIG_HOME sandbox. Captures JSON output + assertion verdict.
# The skill-layer (Claude reading setup.md, invoking AskUserQuestion)
# is NOT exercised here — that requires a live Claude Code session
# with v0.4.4 cached. See report.md for the dry-run decision trace.
#
# Usage: bash run-uat.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${CACHE_DIR:=${HOME}/.claude/plugins/cache/glm-plugin-cc/glm/0.4.4}"
COMPANION="$CACHE_DIR/scripts/glm-companion.mjs"
SANDBOX_BASE="${TMPDIR:-/tmp}/glm-uat-v044-sandbox"

[ -f "$COMPANION" ] || { echo "FAIL: companion not at $COMPANION"; exit 2; }

fresh_sandbox() {
  rm -rf "$SANDBOX_BASE"
  mkdir -p "$SANDBOX_BASE/glm-plugin-cc"
  chmod 700 "$SANDBOX_BASE"
}

seed_both_set() {
  # Mimic a healthy "both set" config: coding-plan preset + fake key.
  fresh_sandbox
  cat > "$SANDBOX_BASE/glm-plugin-cc/config.json" <<'EOF'
{
  "preset_id": "coding-plan",
  "base_url": "https://open.bigmodel.cn/api/coding/paas/v4",
  "default_model": "glm-5.1",
  "api_key": "sk-uat-seed-fake-key-not-real",
  "updated_at_utc": "2026-04-21T13:12:00.000Z"
}
EOF
  chmod 600 "$SANDBOX_BASE/glm-plugin-cc/config.json"
}

run_scenario() {
  local id="$1"; shift
  local label="$1"; shift
  local outfile="$HERE/scenario-$id.json"
  echo "=== Scenario $id: $label ==="
  XDG_CONFIG_HOME="$SANDBOX_BASE" node "$COMPANION" "$@" > "$outfile" 2>&1 || true
  # Scrub fake API keys + sandbox paths from output (defense in depth).
  # The companion never echoes real keys. Also normalize the sandbox
  # path so tracked evidence doesn't carry developer-machine paths
  # that would trip the leak guard.
  OUTFILE="$outfile" SANDBOX="$SANDBOX_BASE" HOMEDIR="$HOME" python3 <<'PY'
import json, os, re, sys
outfile = os.environ["OUTFILE"]
sandbox = os.environ["SANDBOX"]
home = os.environ["HOMEDIR"]
with open(outfile) as f:
    raw = f.read()
try:
    d = json.loads(raw)
    rendered = json.dumps(d, indent=2)
    rendered = re.sub(r"sk-uat-[a-z0-9-]+", "<SCRUBBED>", rendered)
    rendered = rendered.replace(sandbox, "<UAT_SANDBOX>")
    rendered = rendered.replace(home, "<HOME>")
    with open(outfile, "w") as f:
        f.write(rendered)
    print(f"  saved: {outfile}")
except Exception as e:
    print(f"  non-JSON output (raw kept): {e}")
PY
}

# ── Scenario A: Empty config → preset unset path ───────────────────
fresh_sandbox
run_scenario A "Empty config, bare setup probe" setup --json ""

# ── Scenario B: Both set, bare probe (idempotent check) ────────────
seed_both_set
run_scenario B "Both set, bare probe returns ready=true" setup --json ""

# ── Scenario C: Rotate API key ─────────────────────────────────────
seed_both_set
run_scenario C "Rotate API key" setup --json "" --api-key "sk-uat-rotation-new-key"

# ── Scenario D: Switch preset to pay-as-you-go ─────────────────────
seed_both_set
run_scenario D "Switch preset coding-plan -> pay-as-you-go" setup --json "" --preset pay-as-you-go

# ── Scenario E: Ping test ─────────────────────────────────────────
seed_both_set
run_scenario E "Ping test (expects auth error with fake seeded key)" setup --json "" --ping

# ── Scenario F1: Enable review gate ────────────────────────────────
seed_both_set
run_scenario F1 "Enable stop-time review gate" setup --json "" --enable-review-gate

# ── Scenario F2: Disable review gate ───────────────────────────────
seed_both_set
run_scenario F2 "Disable stop-time review gate" setup --json "" --disable-review-gate

# Clean sandbox
rm -rf "$SANDBOX_BASE"

echo ""
echo "=== UAT evidence saved to $HERE ==="
ls -1 "$HERE"/scenario-*.json
