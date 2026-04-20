# Release Card — glm-plugin-cc v0.3.4

Status: READY
Approval Mode: inline-session (user asked to prepare install + first run to the plugin; triggered codex independent review before install)

Requested Scope: v0.3.4 = (1) enable `/plugin marketplace add` loading by adding `.claude-plugin/marketplace.json` (root-as-marketplace, `source: "."`, name `skylab-glm`); (2) ship all 9 verified findings from the codex full-repo review (3 HIGH, 4 MEDIUM, 2 LOW); (3) add an ESM import-resolution check to `npm run check` so v0.3.3-class broken imports fail loudly in CI.

Out of Scope: Multi-provider fallback; background jobs; CI pipeline (v0.4+); cancel-vs-complete atomicity (M3 deferred with rationale); anything other than the codex findings + install manifest.

Intended Ref: main @ new commit (post v0.3.3 edc8f68) + tag v0.3.4 (annotated), remote gitea.tokyo.skyzhang.net/SkyLab/glm-plugin-cc.

Planned Actions: (1) commit v0.3.4 on main; (2) push main via cloudflared access token header; (3) create + push tag v0.3.4; (4) after tag lands, proceed to local-path `/plugin marketplace add` validation.

Scope Completion: COMPLETE
- `.claude-plugin/marketplace.json` NEW (15 lines)
- `scripts/check-imports.mjs` NEW (50 lines, wired into `npm run check`)
- `scripts/session-lifecycle-hook.mjs` rewritten (-50/+25, stateless-HTTP bookkeeping only)
- `scripts/lib/preset-config.mjs`: `resolveEffectiveConfig` fail-closed (uses `readConfigFile` directly); `sanitizeConfig` rejects arrays
- `scripts/lib/glm-client.mjs`: `normalizeBaseUrl` structural via `new URL()`; `sanitizeUrlForDisplay` NEW; all error / status paths pass URLs through sanitizer; runChatRequest `CONFIG_ERROR` branch added; `getGlmAvailability` and `getGlmAuthStatus` wrapped in try/catch for config errors
- `scripts/lib/state.mjs`: `ensureStateDir` 0700 + chmod; `saveState` + `writeJobFile` 0600 + chmod
- `scripts/lib/tracked-jobs.mjs`: `createJobLogFile` + `appendLogLine` + `appendLogBlock` 0600; `createProgressReporter` isolates callback exceptions
- `scripts/lib/render.mjs`: `renderReviewResult` success path falls back to `parsedResult.reasoningSummary`
- `scripts/lib/job-control.mjs`: `getJobTypeLabel` now maps `kind` authoritatively (review/adversarial-review/task/rescue → themselves)
- 5 command files: `$ARGUMENTS` quoted
- `package.json` check script + version bump
- `.claude-plugin/plugin.json` version bump
- CHANGELOG v0.3.4 entry (codex review + fixes + install path)

Outstanding In-Scope Work: none

Major Upgrade Review: N/A — patch version bump; zero new runtime deps. Functional behavior changes summarized:
- Previously-broken Claude Code SessionStart / SessionEnd hook now actually runs (was crashing on import).
- Corrupt user config.json now FAILS CLOSED (error returned) instead of silently falling through to the built-in BigModel default.
- Shell-injection vector in 5 command files closed.
Non-breaking for well-configured callers on v0.3.3.
Breaking Changes: Callers who were (accidentally) depending on v0.3.3's fail-open on corrupt config will now see an error. This is a fix, not a regression; user instruction is `/glm:setup --preset ...` to rewrite the config.
Repo Usage Audit: grepped for broker / app-server / `$ARGUMENTS` without quotes / `fs.mkdirSync` without mode / `fs.writeFileSync` without mode — all sites addressed. `find scripts -name '*.mjs' -exec grep -l "app-server\|broker" {} \;` returns empty. `grep -n 'glm-companion\.mjs.*\\\$ARGUMENTS' commands/*.md` shows all now have `"$ARGUMENTS"`.
Verification Plan: executed — (1) `npm run check` passes all 15 .mjs files (syntax) + 13 lib modules (import resolution); (2) 7-scenario smoke test: preset write, 0700/0600 perms verified via `stat`, URL normalize strips `/chat/completions/`, URL sanitize strips `user:pass@?token=...` to host-only, corrupt config fails-closed via `config.error` surface, thinking flag bogus value rejected, vision model rejected, shell-metachar arguments routed as strings (no shell execution).

Local Verification: all pass. File perm verified via `stat -f "%Sp"`: `drwx------` on state dir, `-rw-------` on config.json. URL sanitize verified: input `http://user:secret@bad.example/?token=abc` → error shows `http://bad.example/` only. Fail-closed verified: `echo "not valid json" > config.json` → `config.error: Could not parse ...`. ESM import check: `[check-imports] OK (13 modules)`.

Codex Review Provenance: Full-repo adversarial review dispatched via codex:codex-rescue subagent on v0.3.3 (commit edc8f68). 11 findings returned, all 11 independently re-verified by reading the cited `file:line`. 9 landed in this release, 2 deferred with rationale (M3 cancel atomicity — current stateless HTTP semantics; N1 import resolution — addressed with `scripts/check-imports.mjs`). No hallucinated findings detected.

CI Evidence: no CI pipeline yet (planned v0.4+); ref-bound verification is local-only. `npm run check` now also does ESM import resolution — would catch H2-class regressions.

Rollback: delete tag v0.3.4; revert v0.3.4 commit; v0.3.3 remains at its tag (but with known SessionStart/End crash bug + fail-open bug). Not recommended to roll back to v0.3.3 — use an older tag (v0.3.2 or earlier) if v0.3.4 is rejected.
