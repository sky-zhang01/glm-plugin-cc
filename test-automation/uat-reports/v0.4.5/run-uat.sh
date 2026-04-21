#!/usr/bin/env bash
# UAT harness for v0.4.5 /glm:review + /glm:adversarial-review
# background support, plus regression of v0.4.4 /glm:setup menu.
#
# Runs each scenario's companion-layer call against an isolated
# XDG_CONFIG_HOME sandbox. Captures JSON output, runs field-level
# assertions, and exits non-zero on any mismatch. The skill-layer
# (Claude reading commands/*.md, invoking AskUserQuestion and/or
# Bash run_in_background) is NOT exercised here — that requires a
# live Claude Code session with v0.4.5 cached. See report.md for
# the skill-layer verification gate.
#
# Usage: bash run-uat.sh
# Exit 0 only when all scenarios pass the structural assertion.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${CACHE_DIR:=${HOME}/.claude/plugins/cache/glm-plugin-cc/glm/0.4.5}"
COMPANION="$CACHE_DIR/scripts/glm-companion.mjs"
SANDBOX_BASE="${TMPDIR:-/tmp}/glm-uat-v045-sandbox"

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

# ── Scenario G: new in v0.4.5 — --wait / --background flag consumption ──
# Runs `review --json --background --wait --base main FOCUSTEXT`. The
# companion will try to call GLM and fail on the fake seeded API key
# (401 Auth failed) — that is expected. The critical assertion is on
# the parsed meta block the companion emits BEFORE the HTTP call:
# `meta.focusText` must equal "FOCUSTEXT" exactly and NOT contain the
# strings "--wait" or "--background". If the flags leaked into
# positionals, focusText would include them.
echo "=== Scenario G: --wait / --background flag consumption (v0.4.5) ==="
seed_both_set
G_OUT="$HERE/scenario-G.json"
# Companion may exit non-zero on HTTP auth fail; capture output regardless.
XDG_CONFIG_HOME="$SANDBOX_BASE" node "$COMPANION" review --json --background --wait \
    --base main FOCUSTEXT > "$G_OUT" 2>&1 || true
OUTFILE="$G_OUT" SANDBOX="$SANDBOX_BASE" HOMEDIR="$HOME" python3 <<'PY'
import json, os, re, sys
outfile = os.environ["OUTFILE"]
sandbox = os.environ["SANDBOX"]
home = os.environ["HOMEDIR"]
with open(outfile) as f:
    raw = f.read()
try:
    d = json.loads(raw)
except Exception as e:
    print(f"  FAIL: non-JSON output ({e})")
    print(raw[:500])
    sys.exit(1)
meta = d.get("meta", {})
focus = meta.get("focusText", "")
base_ref = meta.get("baseRef", "")
target_mode = meta.get("targetMode", "")
ok = (
    focus == "FOCUSTEXT"
    and "--wait" not in focus
    and "--background" not in focus
    and base_ref == "main"
    and target_mode == "branch"
)
if not ok:
    print(f"  FAIL: flag leak detected")
    print(f"    focusText={focus!r} (expected 'FOCUSTEXT')")
    print(f"    baseRef={base_ref!r} (expected 'main')")
    print(f"    targetMode={target_mode!r} (expected 'branch')")
    sys.exit(1)
# Scrub before persisting evidence.
rendered = json.dumps(d, indent=2)
rendered = re.sub(r"sk-uat-[a-z0-9-]+", "<SCRUBBED>", rendered)
rendered = rendered.replace(sandbox, "<UAT_SANDBOX>")
rendered = rendered.replace(home, "<HOME>")
with open(outfile, "w") as f:
    f.write(rendered)
print(f"  PASS: focusText='FOCUSTEXT', --wait/--background consumed (not in positionals)")
PY
if [ $? -eq 0 ]; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ── Scenario H: new in v0.4.5 — help/usage includes [--wait|--background] ──
echo "=== Scenario H: Usage string includes --wait/--background (v0.4.5) ==="
H_OUT="$HERE/scenario-H.log"
# Invoke with invalid subcommand to trigger printUsage.
node "$COMPANION" __no_such_command__ > "$H_OUT" 2>&1 || true
if grep -qE 'review \[--wait\|--background\]' "$H_OUT" \
    && grep -qE 'adversarial-review \[--wait\|--background\]' "$H_OUT"; then
  echo "  PASS: usage includes --wait|--background for both review subcommands"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "  FAIL: usage string missing --wait/--background"
  cat "$H_OUT" | head -15
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ── Scenario I: multi-word focus text + --scope flag mix (v0.4.5 hardening) ──
# Covers the gap in Scenario G: G used a single-word FOCUSTEXT. If the shell
# quoting or parseArgs positional handling breaks on multi-word focus combined
# with --scope, G would not catch it. This scenario asserts meta.focusText
# preserves the full quoted string and meta.targetMode picks up --scope.
echo "=== Scenario I: multi-word focus + --scope + --wait (v0.4.5) ==="
seed_both_set
I_OUT="$HERE/scenario-I.json"
XDG_CONFIG_HOME="$SANDBOX_BASE" node "$COMPANION" review --json --wait \
    --base main --scope branch "multi word focus text" > "$I_OUT" 2>&1 || true
OUTFILE="$I_OUT" SANDBOX="$SANDBOX_BASE" HOMEDIR="$HOME" python3 <<'PY'
import json, os, re, sys
outfile = os.environ["OUTFILE"]
sandbox = os.environ["SANDBOX"]
home = os.environ["HOMEDIR"]
with open(outfile) as f:
    raw = f.read()
try:
    d = json.loads(raw)
except Exception as e:
    print(f"  FAIL: non-JSON output ({e})")
    print(raw[:500])
    sys.exit(1)
meta = d.get("meta", {})
focus = meta.get("focusText", "")
base_ref = meta.get("baseRef", "")
target_mode = meta.get("targetMode", "")
ok = (
    focus == "multi word focus text"
    and "--wait" not in focus
    and "--scope" not in focus
    and "branch" not in focus  # --scope value should be consumed, not in positionals
    and base_ref == "main"
    and target_mode == "branch"
)
if not ok:
    print(f"  FAIL: multi-word focus + --scope handling broken")
    print(f"    focusText={focus!r} (expected 'multi word focus text')")
    print(f"    baseRef={base_ref!r} (expected 'main')")
    print(f"    targetMode={target_mode!r} (expected 'branch')")
    sys.exit(1)
rendered = json.dumps(d, indent=2)
rendered = re.sub(r"sk-uat-[a-z0-9-]+", "<SCRUBBED>", rendered)
rendered = rendered.replace(sandbox, "<UAT_SANDBOX>")
rendered = rendered.replace(home, "<HOME>")
with open(outfile, "w") as f:
    f.write(rendered)
print(f"  PASS: multi-word focus + --scope branch + --wait parsed correctly")
PY
if [ $? -eq 0 ]; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ── Scenario J: no-op contract source-level lock-in (v0.4.5 hardening) ──
# Guards against future regression where someone silently adds
# `if (options.wait) { ... }` or `if (options.background) { ... }` inside
# runReview. The v0.4.5 contract is that these flags are declared in
# booleanOptions ONLY to prevent positionals contamination; they must not
# drive any execution branch. If this invariant breaks, the UAT should fail
# before the code ships.
echo "=== Scenario J: no-op contract grep lock-in (v0.4.5) ==="
COMPANION_SRC="$CACHE_DIR/scripts/glm-companion.mjs"
if grep -nE 'options\.(wait|background)|options\[["'"'"']wait["'"'"']\]|options\[["'"'"']background["'"'"']\]' "$COMPANION_SRC" > /tmp/glm-uat-noop-leak.log; then
  echo "  FAIL: options.wait / options.background referenced in companion source — no-op contract broken"
  cat /tmp/glm-uat-noop-leak.log
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: options.wait / options.background not read anywhere in companion"
  PASS_COUNT=$((PASS_COUNT + 1))
fi
rm -f /tmp/glm-uat-noop-leak.log

# Clean sandbox.
rm -rf "$SANDBOX_BASE"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  UAT summary: $PASS_COUNT passed, $FAIL_COUNT failed"
echo "════════════════════════════════════════════════════════════"

if [ $FAIL_COUNT -gt 0 ]; then
  exit 1
fi
