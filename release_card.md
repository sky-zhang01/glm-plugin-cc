# Release Card — glm-plugin-cc v0.3.3

Status: READY
Approval Mode: inline-session (user: "如果codex 就只是model_reasoning_effort = 'medium' 而没按task分是否开关thinking的话 我们也就默认都on就行了 用户需要可以自己手动关")

Requested Scope: v0.3.3 simplify thinking default — collapse v0.3.2's per-command split into a single global `on` default that mirrors codex CLI's single `model_reasoning_effort = "medium"` default on `gpt-5.4`. Codex itself does not split reasoning per task, so our plugin shouldn't either. User can pass `--thinking off` on any command for light calls.

Out of Scope: API format / preset URLs (v0.3.0); default model (v0.3.1); generation ordering (v0.3.2); anything other than thinking-default unification.

Intended Ref: main @ new commit (post v0.3.2 18b8225) + tag v0.3.3 (annotated), remote gitea.tokyo.skyzhang.net/SkyLab/glm-plugin-cc.

Planned Actions: (1) commit v0.3.3 changes on main; (2) push main via cloudflared access token header; (3) create + push tag v0.3.3.

Scope Completion: COMPLETE — `scripts/glm-companion.mjs` runTask default changed `rescueMode` → `true` (both rescue and task now default on); runReview unchanged (already `true`); comments updated to "global default on — mirrors codex single medium default". `commands/task.md` description updated ("Thinking defaults ON"). `commands/review.md`, `adversarial-review.md`, `rescue.md`, `agents/glm-rescue.md` wording updated from per-command framing to "default on across all commands". `README.md` "Thinking / reasoning" section collapsed from per-command table to single-sentence explanation. `CHANGELOG.md` v0.3.3 entry explicitly calls out v0.3.2 over-engineering + documents the one functional change (task default on, was off). `plugin.json` + `package.json` bumped 0.3.2 → 0.3.3.

Outstanding In-Scope Work: none

Major Upgrade Review: N/A — patch version bump; zero new runtime deps; zero API shape change. Functional diff vs v0.3.2: `/glm:task` without explicit `--thinking` now defaults `on` (was `off`). Users who relied on the v0.3.2 `task` off-default should pass `--thinking off` explicitly going forward — one-line migration.
Breaking Changes: none (additive — explicit `--thinking off` fully restores v0.3.2 `task` behavior)
Repo Usage Audit: `grep -rn "rescueMode\|per-command default\|task default.*off"` across scripts/commands/agents/README confirms the per-command split narrative has been purged. parseThinkingFlag signature unchanged from v0.3.2 (still accepts defaultValue; call sites just always pass `true`). `rescueMode` variable still used for system-prompt selection inside runTask (unchanged) but no longer drives thinking default.
Verification Plan: (executed) node --check all 15 .mjs files; grep audit confirms both runReview + runTask pass `true` as the parseThinkingFlag default; all five doc files (`review.md` / `adversarial-review.md` / `rescue.md` / `task.md` / `agents/glm-rescue.md`) carry the unified "default on across all commands" phrasing; README section is now 3 lines (was 14); explicit `--thinking off` override path unchanged + still parses correctly.

Local Verification: node --check passed on all 15 .mjs files; grep -n "parseThinkingFlag(options.thinking" scripts/glm-companion.mjs returns two lines, both with `, true)` argument; grep for stale per-command narratives returns empty; README Thinking section reduced to single paragraph matching the single-default stance.

CI Evidence: no CI pipeline in v0.3.3 (planned v0.4+); ref-bound verification is local-only.

Rollback: delete tag v0.3.3; revert v0.3.3 commit; v0.3.2 state (per-command split, task default off) remains at its tag. Users who need task-off behavior can always pass `--thinking off` explicitly without rolling back.
