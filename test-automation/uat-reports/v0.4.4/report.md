# UAT Report — glm-plugin-cc v0.4.4

**Target**: `/glm:setup` interactive menu branch (new in v0.4.4)
**Branch**: `fix/setup-interactive-menu`
**Commit under test**: `776694310e83ef11c8a00df2c144c07f6c75c9b8`
**Local cache**: `<HOME>/.claude/plugins/cache/glm-plugin-cc/glm/0.4.4/`
**Date**: 2026-04-21

---

## Scope + limits

UAT is split into two layers:

| Layer | What is tested | Method | Can the authoring session test this? |
|---|---|---|---|
| **Companion plumbing** | For each menu option, the underlying `node glm-companion.mjs setup --flag…` call accepts the flag and mutates state as expected | Harness script, XDG_CONFIG_HOME sandbox, JSON output asserted | YES — done here |
| **Skill interactive flow** | Bare `/glm:setup` triggers `AskUserQuestion`; user selection routes to the correct companion call; menu is terminal (no re-entry) | Live Claude Code session with v0.4.4 cached | NO — authoring session loaded v0.4.3 at start |

The skill-layer verification is a **post-release sanity check** by the maintainer after restarting their Claude Code session. It exercises Claude's interpretation of `commands/setup.md` and the `AskUserQuestion` round-trip, not companion code.

---

## Part 1 — Companion plumbing (executed)

Harness: `run-uat.sh` (this directory). Each scenario seeds an isolated sandbox at `${TMPDIR}/glm-uat-v044-sandbox/` (never touches the real `<HOME>/.config/glm-plugin-cc/config.json`), runs the corresponding companion call, captures JSON output, asserts expected state.

| ID | Menu option mapped | Companion call | Result |
|---|---|---|---|
| A | "Preset unset" top-level probe | `setup --json ""` on empty config | **PASS** — `preset_id: null`, `has_api_key: false`, `ready: false` |
| B | "Both set, bare probe" (Keep current menu entry point) | `setup --json ""` on seeded healthy config | **PASS** — `ready: true`, both set, no mutation |
| C | "Rotate API key" | `setup --json "" --api-key sk-uat-rotation-new-key` | **PASS** — `actionsTaken: ['stored api_key …']`, `has_api_key: true` |
| D | "Switch preset → Pay-as-you-go" | `setup --json "" --preset pay-as-you-go` | **PASS** — `preset_id: pay-as-you-go`, `base_url: …/api/paas/v4` |
| E | "Ping test" | `setup --json "" --ping` | **PASS** — ping was attempted (auth probe reached server, returned expected error on fake seeded key) |
| F1 | "Toggle review gate → Enable" | `setup --json "" --enable-review-gate` | **PASS** — `reviewGateEnabled: true` |
| F2 | "Toggle review gate → Disable" | `setup --json "" --disable-review-gate` | **PASS** — `reviewGateEnabled: false` |

**Plumbing verdict: 7 / 7 PASS**

Raw JSON evidence saved as `scenario-{A,B,C,D,E,F1,F2}.json` (API keys scrubbed; only the seeded fake key ever existed, companion does not echo real keys).

---

## Part 2 — Skill interactive flow (dry-run decision trace)

For each of the 6 user-visible menu branches in `commands/setup.md`, trace what Claude would do when interpreting the v0.4.4 skill prompt. This is not a substitute for live testing — it's a structural review confirming the decision tree is well-formed and terminal.

### Trace B1: User types bare `/glm:setup` on healthy config
1. Claude runs `node glm-companion.mjs setup --json ""` → companion returns JSON with `preset_id: coding-plan`, `has_api_key: true`.
2. Claude reads commands/setup.md → matches "Both set AND `$ARGUMENTS` is empty" branch.
3. Claude surfaces `AskUserQuestion` with 6 options: Keep current, Rotate API key, Switch preset, Ping test, Toggle review gate, Cancel.
4. User picks **"Keep current configuration (done)"** → branch instruction: `→ stop. No further action.`
5. Claude stops.

### Trace C1: User picks "Rotate API key"
1-3 same as Trace B1.
4. User picks **"Rotate API key"**.
5. Claude emits one-line prompt exactly: *"Paste your new GLM API key on a single line in your next message. I'll overwrite the existing key in `~/.config/glm-plugin-cc/config.json` (0600) and never echo it back."*
6. User pastes token on next message.
7. Claude extracts token verbatim, runs `node glm-companion.mjs setup --api-key "<token>" --json`.
8. Shows companion stdout verbatim.
9. Terminal clause: "Each option is terminal — after showing companion stdout from the chosen action, stop; the branch-dispatch rules above apply only to the initial probe and must not re-open the menu on the post-action state." → Claude stops (no re-probe, no re-menu).

### Trace D1: User picks "Switch preset"
1-3 same.
4. User picks **"Switch preset"**.
5. Claude emits nested `AskUserQuestion` with 4 options: Coding Plan, Pay-as-you-go, Custom, Cancel.
6. User picks **"Pay-as-you-go"**.
7. Claude runs `node glm-companion.mjs setup --preset pay-as-you-go --json`.
8. Shows stdout verbatim. Terminal → stop.

### Trace D2: User picks "Switch preset → Custom endpoint"
Same as D1 up to step 5. User picks **"Custom endpoint"**.
6. Claude emits plain-chat prompt (matches top-level "Preset unset" phrasing after simplify fix): *"Paste the base URL (`https://…`, OpenAI-compatible, no `/chat/completions`)."*
7. User pastes URL. Claude runs `--preset custom --base-url <url> --json`.
8. Shows stdout. Terminal → stop.

### Trace E1: User picks "Ping test"
1-3 same.
4. User picks **"Ping test (validate connectivity)"**.
5. Claude runs `node glm-companion.mjs setup --ping --json`.
6. Shows stdout (ping result: OK or explicit error). Terminal → stop.

### Trace F1: User picks "Toggle review gate"
1-3 same.
4. User picks **"Toggle review gate"**.
5. Claude emits nested `AskUserQuestion` with 3 options: Enable, Disable, Cancel.
6. User picks one; Claude runs companion with the matched flag.
7. Shows stdout. Terminal → stop.

### Trace G1: User picks "Cancel"
1-3 same.
4. User picks **"Cancel"** → branch instruction: `→ stop. No further action.`
5. Claude stops.

---

## Residual — requires live session

The following can only be verified in a fresh Claude Code session after the v0.4.4 cache is active (already populated at `<HOME>/.claude/plugins/cache/glm-plugin-cc/glm/0.4.4/` + `installed_plugins.json` updated):

- Real `AskUserQuestion` round-trip renders the 6-option menu correctly (labels match `commands/setup.md` verbatim).
- Nested `AskUserQuestion` for "Switch preset" and "Toggle review gate" renders correctly.
- Menu terminal clause actually prevents re-entry (a Claude interpretation, not a companion behavior).
- One sanity-check scenario at minimum is enough — Scenario B (bare `/glm:setup` → see menu → pick "Keep current" → clean exit) covers menu render + terminal exit in one flow.

Suggested post-release sanity check by the maintainer: after restart, run `/glm:setup` bare, verify menu appears with 6 correctly-labeled options, select "Keep current configuration (done)", verify the session exits without re-probing. If that passes, all other branches are mechanically covered by companion tests (Part 1) plus the structural trace (Part 2).

---

## Verdict

**Companion plumbing**: 7 / 7 PASS. Every menu option's flag combination reaches the companion correctly and mutates state as expected.
**Skill structure**: decision tree is well-formed; no branch is ambiguous, every non-terminal node leads to a terminal companion call.
**Menu terminal semantics**: enforced in markdown by the "Each option is terminal" clause (added during `simplify` pass per Agent 3 Q4 finding); cannot be machine-verified without a live session.

**Recommendation**: advance to codex:adversarial-review + push. Live skill-layer sanity check by maintainer after session restart.
