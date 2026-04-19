# Release Card — glm-plugin-cc v0.2.0

Status: READY
Approval Mode: inline-session (user asked to advance v0.2.0 auth rework in this session)

Requested Scope: v0.2.0 preset system + command cleanup — adds `scripts/lib/preset-config.mjs` with three presets (coding-plan, pay-as-you-go, custom), XDG-compliant config file at `~/.config/glm-plugin-cc/config.json` (dir 0700 / file 0600, atomic write), env overrides retained; `/glm:setup` becomes interactive menu via `AskUserQuestion`; 5 command files cleaned up (removed `--wait`/`--background` lies, removed broken `npm install -g` block, clarified stateless semantics); `renderSetupReport` shows preset + config block + available presets; API key remains env-only (never written to disk).

Out of Scope: gemini backend (separate repo); background job support; CI pipeline (v0.3+); qwen/deepseek/kimi backends; external CLI integration.

Intended Ref: main @ new commit (post v0.1.1 70c561a) + tag v0.2.0 (annotated), remote gitea.tokyo.skyzhang.net/SkyLab/glm-plugin-cc.

Planned Actions: (1) commit v0.2.0 changes on main; (2) push main; (3) create + push tag v0.2.0. v0.1.0 + v0.1.1 tags retained as historical record. No release object, no binaries.

Scope Completion: COMPLETE — preset-config.mjs (208 LOC), glm-client.mjs (resolveBaseUrl + resolveModel merge env > config > fallback), glm-companion.mjs (runSetup accepts --preset/--base-url/--default-model + buildSetupReport includes config + presets blocks), render.mjs (renderSetupReport shows endpoint + presets), 5 commands cleaned (setup/review/adversarial-review/status/cancel), README rewritten, CHANGELOG updated, version bumped 0.1.1 → 0.2.0.

Outstanding In-Scope Work: none

Major Upgrade Review: N/A — minor version bump; zero new runtime deps; Node >=18.18 engine unchanged; API surface additive only (new flags accept, old behavior preserved via env).

Local Verification: node --check passed on all 14 .mjs files; 10-scenario smoke test passed covering: fresh state, preset write, coding-plan / pay-as-you-go / custom selection, custom without --base-url error, base-url without --preset error, unknown preset error, env override wins, file perms (0700 dir / 0600 file) verified, atomic write leaves no .tmp residue; sev-verifier PASS on all 8 invariants (API key never on disk, HTTPS triple-enforced, path traversal blocked, priority order correct, no new runtime dep, task.md registered, setup.md never prompts for API key, smoke scenarios supported).

Security notes applied: chmodSync(dir, 0o700) defense-in-depth after mkdirSync (mode not reapplied on existing dir); atomic write via tmp+rename so concurrent setups don't half-write; error messages truncate long base_urls to avoid echoing accidentally-pasted credentials.

Note on review: security-auditor sub-agent returned entirely hallucinated output (referenced non-existent code, wrong preset IDs, imagined `commander` dep, imagined crash bugs) — rejected and did the audit manually against real code. Sev-verifier was accurate (cited real file lengths and real exports).

CI Evidence: no CI pipeline in v0.2.0 (planned v0.3+); ref-bound verification is local-only.

Rollback: delete tag v0.2.0 via `gitea-release-delete-by-id.sh` or Gitea UI; revert v0.2.0 commit via `git revert`; v0.1.1 state remains accessible at its tag; existing users with saved config.json unaffected because config is forward-compatible (field-whitelisted on read).
