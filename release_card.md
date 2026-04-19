# Release Card — glm-plugin-cc v0.3.2

Status: READY
Approval Mode: inline-session (user flagged two concrete errors in v0.3.1 commentary: "上一代，档位明显低 明显是glm-4.7而不是 glm-4.6" + "你之前言之凿凿的说codex的插件用的是gpt-5.4-mini现在又说用的是gpt-5.4 那我有合理怀疑到底用不用thinking了 不行的话就按照task来分默认到底开不开thinking")

Requested Scope: v0.3.2 research-correction patch — (1) fix GLM generation ordering in README (glm-4.7 is previous-gen flagship, glm-4.6 is older; v0.3.1 had them in the same "previous-generation" bucket); (2) verify codex CLI real defaults via official config-reference (confirms `model = "gpt-5.4"` + `model_reasoning_effort = "medium"`, NOT unset); (3) split thinking default per command — review/adversarial-review/rescue default `on` (mirrors codex medium-reasoning default on gpt-5.4), task default `off` (free-form channel). Update glm-companion.mjs parseThinkingFlag + all call sites + commands + agent + CHANGELOG + version.

Out of Scope: API format changes (done in v0.3.0); preset URL changes (done in v0.3.0); vision deny-list (done in v0.3.0); default model change (done in v0.3.1); per-command model splits (user-confirmed not needed in v0.3.0 thread).

Intended Ref: main @ new commit (post v0.3.1 34caadb) + tag v0.3.2 (annotated), remote gitea.tokyo.skyzhang.net/SkyLab/glm-plugin-cc.

Planned Actions: (1) commit v0.3.2 changes on main; (2) push main via cloudflared access token header; (3) create + push tag v0.3.2.

Scope Completion: COMPLETE — scripts/glm-companion.mjs (`parseThinkingFlag(value, defaultValue = false)` signature extended; runReview passes `true`; runTask passes `rescueMode` boolean so rescue=on, task=off); commands/review.md + adversarial-review.md + rescue.md + task.md + agents/glm-rescue.md wording updated to reflect per-command defaults + codex-medium alignment; README.md generation table rewritten with explicit Tier column + newest-first ordering (glm-5.1 → glm-5 → glm-5-turbo → glm-4.7 prev-gen flagship → glm-4.6 older gen); README "Thinking / reasoning" section rewritten with per-command default table; CHANGELOG v0.3.2 entry explicitly acknowledges the two corrections + lists changed behavior + documents non-breaking nature; plugin.json + package.json bumped 0.3.1 → 0.3.2.

Outstanding In-Scope Work: none

Major Upgrade Review: N/A — patch version bump; zero new runtime deps; zero API shape change; corrections-only release. The only behavior change users may notice: if they never pass `--thinking` on review/adversarial-review/rescue, they'll now get `thinking on` by default (previously `off`). `--thinking on|off` overrides unchanged on every command. Non-breaking: explicit `--thinking` values in user invocations keep exact prior behavior.
Breaking Changes: none (behavior change is additive — user can always explicitly pass `--thinking off` to restore v0.3.1 default on review/adversarial-review/rescue)
Repo Usage Audit: `grep -rn "effort unset\|thinking.*default.*off\|--effort unset"` across all files confirms the incorrect codex-unset claim has been purged from commands/ + agents/ + README.md. Previous-gen `glm-4.6` description is now "Older generation" (not "Previous-generation mid-tier"). Generation ordering verified against docs.bigmodel.cn/glm-4.7 + glm-4.6 pages.
Verification Plan: (executed) node --check all 15 .mjs files; per-command thinking-default smoke test via Node inline import — confirmed `parseThinkingFlag(undefined, true)` returns true and `parseThinkingFlag(undefined, false)` returns false; `--thinking off` still parses to false regardless of default; `--thinking on` still parses to true; `--thinking bogus` still throws; companion `task --thinking off` + `task` (no flag) both route correctly via rescueMode=false default=false; companion `review` (no flag) routes via review default=true (inside-code confirmed by reading the modified source).

Local Verification: node --check passed on all 15 .mjs files; inline Node test verified parseThinkingFlag default-value parameter; smoke test (XDG_CONFIG_HOME tmpdir) confirmed help output + preset apply unchanged from v0.3.1; README generation table ordering verified against official docs.bigmodel.cn pages for both glm-4.6 and glm-4.7.

Research Sources:
- https://developers.openai.com/codex/config-reference ("model_reasoning_effort" default = "medium")
- https://developers.openai.com/codex/models ("defaults to a recommended model — currently gpt-5.4")
- https://docs.bigmodel.cn/cn/guide/models/text/glm-4.7 ("高智能模型"; "surpassing GLM-4.6 across multiple dimensions"; LiveCodeBench V6 open-source SOTA)
- https://docs.bigmodel.cn/cn/guide/models/text/glm-4.6 ("对齐 Claude Sonnet 4"; older generation)

CI Evidence: no CI pipeline in v0.3.2 (planned v0.4+); ref-bound verification is local-only.

Rollback: delete tag v0.3.2; revert v0.3.2 commit; v0.3.1 state (default thinking off, glm-4.7 in "previous-gen" bucket) remains accessible at its tag. Zero config-level impact — no persisted state changed.
