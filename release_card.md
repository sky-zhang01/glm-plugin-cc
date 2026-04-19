# Release Card — glm-plugin-cc v0.3.0

Status: READY
Approval Mode: inline-session (user confirmed OpenAI-format pivot + preset URLs + single default model + thinking default off in the v0.2.0 → v0.3.0 working thread)

Requested Scope: v0.3.0 OpenAI-compatible API format pivot — rewrite `scripts/lib/glm-client.mjs` to POST `/chat/completions` with `Authorization: Bearer` and OpenAI `messages[]` schema; switch preset URLs to 智谱 BigModel OpenAI-compatible endpoints (`coding-plan` → `open.bigmodel.cn/api/coding/paas/v4`, `pay-as-you-go` → `open.bigmodel.cn/api/paas/v4`); add `scripts/lib/model-catalog.mjs` with vision deny-list (glm-4v / glm-4.5v / glm-4.6v / glm-4.1v-thinking) and `DEFAULT_MODEL = "glm-4.6"`; add `--thinking on|off` CLI flag (default `off`, mirrors codex `--effort unset`); rebrand preset displays to 智谱 BigModel (overseas Z.AI moves to `custom` preset); update README/CHANGELOG; version bump 0.2.0 → 0.3.0.

Out of Scope: gemini backend (separate repo); background job support; CI pipeline (v0.4+); auto-migration of v0.1/v0.2 config files (user explicitly declined — "根本就还没人用过呢 考虑是不是自动迁移 太早了"); multi-provider fallback inside one plugin; qwen/deepseek/kimi backends.

Intended Ref: main @ new commit (post v0.2.0 12e5ba9) + tag v0.3.0 (annotated), remote gitea.tokyo.skyzhang.net/SkyLab/glm-plugin-cc.

Planned Actions: (1) commit v0.3.0 changes on main; (2) push main; (3) create + push tag v0.3.0. v0.1.0 / v0.1.1 / v0.2.0 tags retained as historical record. No release object, no binaries.

Scope Completion: COMPLETE — preset-config.mjs (OpenAI URLs + 智谱 BigModel display text + `/chat/completions` suffix strip), glm-client.mjs (full rewrite: Bearer auth, OpenAI messages schema, choices[0].message.content parsing, reasoning_content extraction, vision-model guard via assertNonVisionModel, thinking passthrough), model-catalog.mjs (new 63-LOC module: DEFAULT_MODEL + isVisionModel + assertNonVisionModel), glm-companion.mjs (`--thinking on|off` parsed for review/adversarial-review/task/rescue; passed into client), 5 commands + rescue agent documented, README rewritten (OpenAI format, model table, thinking section), CHANGELOG v0.3.0 entry (breaking-change call-out + rationale), plugin.json + package.json bumped 0.2.0 → 0.3.0.

Outstanding In-Scope Work: none

Major Upgrade Review: DONE
Breaking Changes: Endpoint format switched Anthropic-compatible → OpenAI-compatible (URL path `/v1/messages` → `/chat/completions`; auth header `x-api-key` → `Authorization: Bearer`; request body `system` top-level → `messages[{role: "system"}]`; response parse `content[].text` → `choices[0].message.content`). Preset URLs changed: existing v0.2.0 config.json files still load (schema-compatible: preset_id/base_url/default_model fields unchanged) but the saved Anthropic-format URLs (`api.z.ai/api/anthropic`, `open.bigmodel.cn/api/anthropic`) will 404 against the new client — users must re-run `/glm:setup`. Error message on 404 explicitly tells user the preset base_url must be OpenAI-compatible.
Repo Usage Audit: `grep -r "x-api-key\|anthropic-version\|api/anthropic\|v1/messages" scripts/` returns 0 hits after rewrite. All Anthropic-specific strings purged from client + companion. `agents/glm-rescue.md` and all `commands/*.md` updated to reflect new format. README architectural paragraph rewritten to clarify plugin-inside-session vs CLI-provider-replacement distinction (fixes confusion from v0.1/v0.2).
Verification Plan: (executed) node --check all 15 .mjs files; 11-scenario smoke test covering help / unconfigured setup / preset apply for all 3 presets / file perms 0700-0600 / custom-without-url rejection / http URL rejection / https normalize (strips /chat/completions suffix) / --thinking bogus rejection / --thinking on+off parse / env override http rejection / env override https normalize / vision model rejection at task time. Unit-level vision deny-list check (13 model names: 6 text allowed, 7 vision rejected, plus uppercase variant) — all pass.

Local Verification: node --check passed on all 15 .mjs files (13 existing + 1 new model-catalog.mjs + glm-companion.mjs + session-lifecycle-hook.mjs); 11-scenario smoke test PASS; unit vision deny-list test PASS (13/13 cases); manual inspection of generated config.json confirms 0600 perms + correct OpenAI URL persisted. No residual Anthropic-format strings in scripts/. Did NOT hit live 智谱 BigModel endpoint (offline validation only — endpoint shape verified by HTTP header + body construction, 404 guard covers wrong-preset case).

Security notes applied: Bearer token still env-only (ZAI_API_KEY); never written to disk. HTTPS enforcement retained on env override + custom preset + config file reads (three enforcement points). Vision model deny-list fails fast before any HTTP call (prevents accidentally wasting token budget on mis-routed vision call). File perms defense-in-depth (chmodSync after mkdir + chmod after rename) retained from v0.2.0. Error messages still truncate long base URLs to avoid echoing accidentally-pasted credentials.

CI Evidence: no CI pipeline in v0.3.0 (planned v0.4+); ref-bound verification is local-only (node --check + smoke + unit).

Rollback: delete tag v0.3.0 via `gitea-release-delete-by-id.sh` or Gitea UI; revert v0.3.0 commit via `git revert`; v0.2.0 state remains accessible at its tag. Users who already re-ran `/glm:setup` under v0.3.0 and want to go back to v0.2.0 would need to manually restore the Anthropic-format URL in `~/.config/glm-plugin-cc/config.json` (preset IDs unchanged; only base_url string differs). No user-data loss path — config file is forward-compatible and field-whitelisted on read.
