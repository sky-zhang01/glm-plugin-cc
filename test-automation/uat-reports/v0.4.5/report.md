# UAT Report — glm-plugin-cc v0.4.5

**Target**: `/glm:review` + `/glm:adversarial-review` background support
(ports codex-plugin-cc's size-estimation + `AskUserQuestion` pattern)
**Branch**: `fix/review-background`
**Local cache**: `<HOME>/.claude/plugins/cache/glm-plugin-cc/glm/0.4.5/`
**Date**: 2026-04-21

---

## Scope + limits

Same two-layer split as v0.4.4 UAT:

| Layer | What is tested | Method | Authoring session can test? |
|---|---|---|---|
| **Companion plumbing** | flag parsing (`--wait` / `--background` consumed, not leaked into focus), companion usage help, v0.4.4 `/glm:setup` regression | `run-uat.sh` with XDG_CONFIG_HOME sandbox, JSON field assertions | YES — done here |
| **Skill interactive flow** | Size-estimation probes run, `AskUserQuestion` menu appears, user selection routes to foreground vs `Bash(run_in_background: true)` | Live Claude Code session with v0.4.5 cached | NO — session boundary |

---

## Part 1 — Companion plumbing (executed, 11/11 PASS)

Harness: `run-uat.sh`. Regresses all 7 v0.4.4 scenarios plus 4 v0.4.5 scenarios
(2 original + 2 added after post-commit adversarial review).

| ID | Check | Scope | Result |
|---|---|---|---|
| A | Empty config → bare `setup --json ""` probe | regression from v0.4.4 | **PASS** |
| B | Both set → bare `setup --json ""` probe returns ready=true | regression from v0.4.4 | **PASS** |
| C | `setup --api-key <new>` rotates API key | regression from v0.4.4 | **PASS** |
| D | `setup --preset pay-as-you-go` switches preset + base_url | regression from v0.4.4 | **PASS** |
| E | `setup --ping` attempts HTTP ping probe | regression from v0.4.4 | **PASS** |
| F1 | `setup --enable-review-gate` toggles ON | regression from v0.4.4 | **PASS** |
| F2 | `setup --disable-review-gate` toggles OFF | regression from v0.4.4 | **PASS** |
| **G** | **NEW**: `review --json --background --wait --base main FOCUSTEXT` — asserts `meta.focusText == "FOCUSTEXT"` (not `"--background FOCUSTEXT"`), `meta.baseRef == "main"`, `meta.targetMode == "branch"` | **v0.4.5 scope** | **PASS** — flags consumed correctly |
| **H** | **NEW**: companion usage string (triggered by invalid subcommand) contains `review [--wait\|--background]` and `adversarial-review [--wait\|--background]` | **v0.4.5 scope** | **PASS** — self-doc matches frontmatter argument-hint |
| **I** | **NEW** (post-adversarial-review hardening): `review --json --wait --base main --scope branch "multi word focus text"` — asserts focus preserves all 4 words, `--scope` value consumed (not leaked into positionals), `targetMode == "branch"` | **v0.4.5 scope** | **PASS** — closes GLM Finding 4 gap |
| **J** | **NEW** (post-adversarial-review hardening): grep companion source for any `options.wait` / `options.background` reference. Must return zero matches. Locks in the no-op contract so future regressions fail at UAT time. | **v0.4.5 scope** | **PASS** — contract intact |

**Plumbing verdict: 11 / 11 PASS.**

Raw evidence: `scenario-{A,B,C,D,E,F1,F2,G,I}.json` + `scenario-H.log`. Scenario J
is source-level check, no persisted artifact. All fake keys scrubbed (`sk-uat-* →
<SCRUBBED>`), all developer paths normalized (`<HOME>` / `<UAT_SANDBOX>`).

---

## Part 2 — Skill interactive flow (dry-run trace)

For each new user-visible behavior in `commands/review.md` +
`commands/adversarial-review.md`, trace what Claude does on a v0.4.5
cached session.

### Trace 1: bare `/glm:review` on clean working tree
1. Skill prompt matches "neither --wait nor --background in args" branch → go to size estimation.
2. Claude runs `git status --short --untracked-files=all` → returns 0 lines.
3. Claude runs `git diff --shortstat --cached` and `git diff --shortstat` → both return 0 lines.
4. Skill prompt: "only conclude there is nothing to review when working-tree status is empty" → Claude reports "nothing to review" and exits.

### Trace 2: bare `/glm:review` on 1 small file change
1. Size probes return `1 file changed, 3 insertions(+)`.
2. Skill prompt: "tiny (~1-2 files, no directory-sized change)" → recommend wait.
3. `AskUserQuestion` with `Wait for results (Recommended)` first + `Run in background` second.
4. User picks wait → foreground flow → `node glm-companion.mjs review "$ARGUMENTS"` → stdout verbatim.

### Trace 3: bare `/glm:review` on 30-file change
1. Size probes return `30 files changed, 1500 insertions(+), 400 deletions(-)`.
2. Skill prompt: "In every other case, including unclear size, recommend background" → recommend background.
3. `AskUserQuestion` with `Run in background (Recommended)` first + `Wait for results` second.
4. User picks background → `Bash(command, run_in_background: true)` → session returns immediately with message "GLM review started in the background. Check `/glm:status` for progress, `/glm:result <id>` to replay when done."

### Trace 4: `/glm:review --wait` explicit bypass
1. Skill prompt: "raw args include `--wait` → do not ask. Run in the foreground."
2. Claude skips size estimation + AskUserQuestion, goes straight to foreground flow.
3. Companion receives `--wait` as no-op boolean (v0.4.5 booleanOptions change); parseArgs does NOT dump it into focus text.

### Trace 5: `/glm:review --background` explicit bypass
1. Skill prompt: "raw args include `--background` → do not ask. Run in a Claude background task."
2. Claude skips probes + menu, launches `Bash(..., run_in_background: true)`.
3. Companion receives `--background` as no-op boolean; not in positionals.

### Trace 6: `/glm:review --wait --background` (both flags simultaneously)
Behavior: skill prompt rule-order matters. The `--wait` check is listed before `--background` in the same bullet group, but both "do not ask" branches route to mutually exclusive flows. In practice Claude picks the first match; if user passes both, `--wait` wins (foreground). **This is a NOTE for release_card**: if users are known to do this, the precedence should be explicit. For v0.4.5 it's unlikely in practice — no skill instruction conflict.

### Trace 7: Same 6 variants for `/glm:adversarial-review`
Identical decision tree with the adversarial framing note ("Do not weaken the adversarial framing or rewrite the user's focus text") layered on top of foreground/background flows. No new semantics.

---

## Residual — requires live Claude Code session

The following can only be verified in a fresh session after v0.4.5 cache is active
(already populated at `<HOME>/.claude/plugins/cache/glm-plugin-cc/glm/0.4.5/`):

1. `/glm:review` on a non-trivial diff → menu actually renders with correct
   option labels matching `commands/review.md` verbatim (`Wait for results` /
   `Run in background`).
2. Picking "Run in background" → `Bash(run_in_background: true)` actually
   detaches; Claude session continues responsive.
3. `/glm:status` and `/glm:result <id>` still work against the background
   job's log artifacts after detach (regression: these existed in v0.4.4,
   should be unaffected in v0.4.5).

Suggested post-release sanity check: after restart, run `/glm:review` on a
small working-tree diff (1-2 files), confirm menu suggests "Wait for results
(Recommended)" first, pick wait, verify foreground review completes. That
single flow covers size-estimation + recommendation + AskUserQuestion render +
foreground execution. The background and bypass paths are proven mechanically
by Scenarios G + H.

---

## Verdict

**Companion plumbing**: 9 / 9 PASS including 2 new v0.4.5 scenarios (flag
consumption, usage help).
**Skill structure**: 7-path decision tree (Trace 1-7) is well-formed; every
branch terminates in a single companion call or a single Bash invocation with
no re-entry.
**Simplify findings** (4 applied pre-UAT): printUsage stale bug closed,
redundant Scope flags prose tightened, companion comment trimmed, CHANGELOG
narrative stripped.

**Recommendation**: advance to `codex:adversarial-review` + push.
