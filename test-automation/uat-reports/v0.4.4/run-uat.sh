#!/usr/bin/env bash
# UAT harness for v0.4.4 /glm:setup interactive menu.
#
# Runs each menu option's companion-layer call against an isolated
# XDG_CONFIG_HOME sandbox. Captures JSON output, runs field-level
# assertions, and exits non-zero on any mismatch. The skill-layer
# (Claude reading setup.md, invoking AskUserQuestion) is NOT
# exercised here — that requires a live Claude Code session with
# v0.4.4 cached. See report.md for the skill-layer verification gate.
#
# Usage: bash run-uat.sh
# Exit 0 only when all scenarios pass the structural assertion.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${CACHE_DIR:=${HOME}/.claude/plugins/cache/glm-plugin-cc/glm/0.4.4}"
COMPANION="$CACHE_DIR/scripts/glm-companion.mjs"
SANDBOX_BASE="${TMPDIR:-/tmp}/glm-uat-v044-sandbox"

[ -f "$COMPANION" ] || { echo "FAIL: companion not at $COMPANION"; exit 2; }

FAIL_COUNT=0
PASS_COUNT=0

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

# Run a scenario: companion exit status is captured (not swallowed),
# output is written to a temp file. The assertion step reads that
# file, runs the supplied assertion expression, and emits PASS / FAIL.
run_and_assert() {
  local id="$1"; shift
  local label="$1"; shift
  local assert_py="$1"; shift
  local outfile="$HERE/scenario-$id.json"
  local exit_code=0

  echo "=== Scenario $id: $label ==="

  # Capture exit status — do NOT use || true. The ping scenario uses
  # a fake key and expects the companion to still write a JSON report
  # (auth probe result inside), so exit 0 is expected across the board.
  # If exit is non-zero, that is itself a regression.
  if ! XDG_CONFIG_HOME="$SANDBOX_BASE" node "$COMPANION" "$@" > "$outfile" 2>&1; then
    exit_code=$?
    echo "  FAIL: companion exited $exit_code"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return 0
  fi

  # Scrub and assert.
  OUTFILE="$outfile" SANDBOX="$SANDBOX_BASE" HOMEDIR="$HOME" \
    ASSERT_PY="$assert_py" SCENARIO_ID="$id" \
  python3 <<'PY'
import json, os, re, sys

outfile = os.environ["OUTFILE"]
sandbox = os.environ["SANDBOX"]
home = os.environ["HOMEDIR"]
assert_expr = os.environ["ASSERT_PY"]
sid = os.environ["SCENARIO_ID"]

with open(outfile) as f:
    raw = f.read()

try:
    d = json.loads(raw)
except Exception as e:
    print(f"  FAIL: non-JSON output ({e})")
    sys.exit(1)

report = d.get("report", {})
cfg = report.get("config", {})

# Evaluate assertion expression. `report` and `cfg` are in scope.
# Must eval to truthy.
try:
    ok = eval(assert_expr, {"report": report, "cfg": cfg, "d": d})
except Exception as e:
    print(f"  FAIL: assertion crashed: {e}")
    sys.exit(1)

if not ok:
    snap = {"preset_id": cfg.get("preset_id"),
            "has_api_key": cfg.get("has_api_key"),
            "ready": report.get("ready"),
            "reviewGateEnabled": report.get("reviewGateEnabled"),
            "actionsTaken": report.get("actionsTaken"),
            "auth.detail": report.get("auth", {}).get("detail")}
    print(f"  FAIL: assertion {assert_expr!r} false")
    print(f"         state: {snap}")
    sys.exit(1)

# Scrub before persisting.
rendered = json.dumps(d, indent=2)
rendered = re.sub(r"sk-uat-[a-z0-9-]+", "<SCRUBBED>", rendered)
rendered = rendered.replace(sandbox, "<UAT_SANDBOX>")
rendered = rendered.replace(home, "<HOME>")
with open(outfile, "w") as f:
    f.write(rendered)
print(f"  PASS: saved {outfile}")
PY

  if [ $? -eq 0 ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

# ── Scenario A: Empty config, bare probe ──────────────────────────
fresh_sandbox
run_and_assert A "Empty config, bare setup probe" \
  "cfg.get('preset_id') is None and cfg.get('has_api_key') is False and report.get('ready') is False" \
  setup --json ""

# ── Scenario B: Both set, bare probe (idempotent) ─────────────────
seed_both_set
run_and_assert B "Both set, bare probe returns ready=true" \
  "cfg.get('preset_id') == 'coding-plan' and cfg.get('has_api_key') is True and report.get('ready') is True" \
  setup --json ""

# ── Scenario C: Rotate API key ────────────────────────────────────
seed_both_set
run_and_assert C "Rotate API key" \
  "cfg.get('has_api_key') is True and any('api_key' in str(a) for a in (report.get('actionsTaken') or []))" \
  setup --json "" --api-key "sk-uat-rotation-new-key"

# ── Scenario D: Switch preset to pay-as-you-go ────────────────────
seed_both_set
run_and_assert D "Switch preset coding-plan -> pay-as-you-go" \
  "cfg.get('preset_id') == 'pay-as-you-go' and '/api/paas/v4' in (cfg.get('base_url') or '')" \
  setup --json "" --preset pay-as-you-go

# ── Scenario E: Ping test ─────────────────────────────────────────
# Fake seeded key → ping reaches server and surfaces an auth error.
# What we assert: the companion attempted the ping (auth.detail is not
# the "ping skipped" placeholder from non-ping runs).
seed_both_set
run_and_assert E "Ping test (expects auth probe attempt on fake key)" \
  "'ping skipped' not in (report.get('auth', {}).get('detail') or '')" \
  setup --json "" --ping

# ── Scenario F1: Enable review gate ───────────────────────────────
seed_both_set
run_and_assert F1 "Enable stop-time review gate" \
  "report.get('reviewGateEnabled') is True" \
  setup --json "" --enable-review-gate

# ── Scenario F2: Disable review gate ──────────────────────────────
seed_both_set
run_and_assert F2 "Disable stop-time review gate" \
  "report.get('reviewGateEnabled') is False" \
  setup --json "" --disable-review-gate

# Clean sandbox.
rm -rf "$SANDBOX_BASE"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  UAT summary: $PASS_COUNT passed, $FAIL_COUNT failed"
echo "════════════════════════════════════════════════════════════"

if [ $FAIL_COUNT -gt 0 ]; then
  exit 1
fi
