# Release Card — glm-plugin-cc v0.3.1

Status: READY
Approval Mode: inline-session (user flagged v0.3.0 default model not benchmark-validated: "我不是让你先看看benchmark吗？我让你看的目的是尽量找和codex能力相近的模型去用")

Requested Scope: v0.3.1 benchmark-informed default model correction — change `DEFAULT_MODEL` from `glm-4.6` (mid-tier previous generation) to `glm-5.1` (current-generation flagship, closest open-weights tier to codex CLI's default `gpt-5.4`). Update all three preset `default_model` fields to `glm-5.1`. Rewrite README "Model configuration" section with benchmark rationale (Artificial Analysis Intelligence Index + SWE-Bench Pro + BenchLM aggregate). Update command docs (`review.md`, `rescue.md`) + rescue agent to reflect new default. Version bump 0.3.0 → 0.3.1.

Out of Scope: API format changes (done in v0.3.0); preset URL changes (done in v0.3.0); vision deny-list additions; `--thinking` default flip; config file auto-migration (user declined in v0.3.0 thread); multi-provider fallback.

Intended Ref: main @ new commit (post v0.3.0 7f9ea71) + tag v0.3.1 (annotated), remote gitea.tokyo.skyzhang.net/SkyLab/glm-plugin-cc.

Planned Actions: (1) commit v0.3.1 changes on main; (2) push main via cloudflared access token header; (3) create + push tag v0.3.1. All prior tags retained.

Scope Completion: COMPLETE — `model-catalog.mjs` DEFAULT_MODEL updated (+ inline comment with benchmark rationale); `preset-config.mjs` all 3 presets updated; `README.md` model configuration section rewritten with benchmark table + ranking explanation; `commands/review.md` + `commands/rescue.md` + `agents/glm-rescue.md` default references updated with "flagship tier closest to codex gpt-5.4" framing; `CHANGELOG.md` v0.3.1 entry added with benchmark table + rationale paragraph + notes on backwards-compat (v0.3.0 saved configs keep `glm-4.6` until user re-runs setup); `plugin.json` + `package.json` bumped.

Outstanding In-Scope Work: none

Major Upgrade Review: N/A — patch version bump; zero new runtime deps; no API surface change; default-value shift only. Users on v0.3.0 with saved config.json continue using `glm-4.6` until they run `/glm:setup` again (config-file value wins over built-in default), so this is explicitly non-breaking for existing configured users.
Breaking Changes: none
Repo Usage Audit: `grep -rn "glm-4\.6"` across `scripts/` + `commands/` + `agents/` + `README.md` confirms only historical / previous-generation / vision-suffix references remain (e.g. `glm-4.6v` in vision deny-list, `glm-4.6` in "use when quota tight" model table). No stale `DEFAULT_MODEL = "glm-4.6"` assignments. CHANGELOG retains `glm-4.6` only inside the v0.3.0 and v0.2.0 historical entries.
Verification Plan: (executed) node --check all 15 .mjs files; smoke test of `setup --preset coding-plan --json` + `setup --preset pay-as-you-go --json` + `setup --preset custom --base-url ... --json` — confirm persisted `default_model` is `glm-5.1`; smoke test `task --model glm-4.6 "hi"` (valid override still accepted, no API key so bails at availability check); smoke test `task --model glm-4.6v "hi"` (vision still rejected with MODEL_REJECTED error); `grep` confirms no stale `glm-4.6` default references.

Local Verification: node --check passed on all 15 .mjs files; preset smoke test confirms `default_model: "glm-5.1"` persisted in `~/.config/glm-plugin-cc/config.json` for all 3 presets; vision deny-list unchanged (13/13 still PASS); model-catalog DEFAULT_MODEL export = `"glm-5.1"`. No live API call (offline validation only — model name is a string passed to HTTP body; wrong name would surface as HTTP 400 from 智谱 BigModel at runtime).

Benchmark Evidence:
- Artificial Analysis Intelligence Index: `gpt-5.4` = 57, `gpt-5.3-codex (xhigh)` = 54, `glm-5.1 (Reasoning)` = 51 (top open-weights), `glm-5 (Reasoning)` = 50
- SWE-Bench Pro: `glm-5.1` = 58.4 (outperforms `gpt-5.4`, Claude Opus 4.6, Gemini 3.1 Pro per docs.z.ai + multiple third-party reviews)
- BenchLM aggregate (GLM-5.1 vs GPT-5.4-mini head-to-head): 84 vs 73
- 智谱 Coding Plan availability: GLM-5.1 rolled out to all tiers (Max/Pro/Lite) on 2026-03-28

Sources audited:
- https://artificialanalysis.ai/models (Intelligence Index)
- https://docs.z.ai/guides/llm/glm-5.1 (GLM-5.1 official benchmark page)
- https://benchlm.ai/compare/glm-5-1-vs-gpt-5-4-mini (aggregate comparison)
- https://developers.openai.com/codex/models (codex CLI default = gpt-5.4)
- https://www.bigmodel.cn/glm-coding (Coding Plan tier availability)
- https://pinchbench.com/ (cross-reference; no direct GLM data in top-10)

CI Evidence: no CI pipeline in v0.3.1 (planned v0.4+); ref-bound verification is local-only.

Rollback: delete tag v0.3.1; revert v0.3.1 commit; v0.3.0 state (with `glm-4.6` default) remains accessible at its tag. Zero user-data impact — config-file `default_model` value wins over built-in default, so users who already re-ran `/glm:setup` under v0.3.1 can manually edit their `~/.config/glm-plugin-cc/config.json` back to `"glm-4.6"` if desired.
