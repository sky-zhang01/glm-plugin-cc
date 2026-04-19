# Release Card — glm-plugin-cc v0.1.1

Status: READY
Approval Mode: inline-session (user asked to ship end-to-end in this session; v0.1.1 captures internal review fixes)

Requested Scope: v0.1.1 post-review fix release — adds missing `commands/task.md` (sev-verifier finding), enforces `https://` on `ZAI_BASE_URL` override (security-auditor T5 HIGH), adds jobId format validation + path containment in `state.mjs` (security-auditor T4 defense-in-depth). Version bump across `package.json`, `.claude-plugin/plugin.json`, `CHANGELOG.md`.

Out of Scope: backfilling tests (v0.2.0); CI pipeline (v0.2.0); background jobs; ACP/CLI path; Gemini backend; qwen/deepseek.

Intended Ref: main @ new commit (post v0.1.0 c613ff8) + tag v0.1.1 (annotated), remote gitea.tokyo.skyzhang.net/SkyLab/glm-plugin-cc

Planned Actions: (1) commit fixes on main; (2) push main; (3) create + push tag v0.1.1. v0.1.0 tag retained as historical record. No release object, no binaries.

Scope Completion: COMPLETE — 3 fixes landed, version bumped in 3 manifest files, CHANGELOG updated with v0.1.1 entry.

Outstanding In-Scope Work: none

Major Upgrade Review: N/A — patch release; no dependency changes; no API shape changes; zero runtime deps still zero.

Local Verification: node --check passed on all 13 .mjs files post-fix; regression tests confirmed: `setup --json` (no key) → `ready: false` + actionable nextSteps; `ZAI_BASE_URL=http://evil` → clear error "must use https://"; `ZAI_BASE_URL=https://api.z.ai/api/anthropic` → `ready: true`; `result ../etc/passwd` → "No job found" (blocked at matchJobReference layer, defense-in-depth at resolveSafeJobPath).

CI Evidence: no CI pipeline in v0.1.1 (planned v0.2.0); ref-bound verification is local-only.

Rollback: delete tag v0.1.1 via `gitea-release-delete-by-id.sh` or Gitea UI; revert the v0.1.1 commit via `git revert` then push. v0.1.0 state remains accessible at its tag.
