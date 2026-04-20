# Release Card — glm-plugin-cc v0.4.0

Status: READY
Approval Mode: inline-session (user: "api key和codex原本的保持一模一样吧" + "GitHub public repo版本和 gitea的一致可以但不用提示之前做了什么修改 gitea repo 保留 因为以后如果要做修改 也是先在gitea上弄完 确认没问题了再push到GitHub")

Requested Scope: v0.4.0 **breaking auth change** — API key now persists to `~/.config/glm-plugin-cc/config.json` (mode 0600) instead of reading `ZAI_API_KEY` env var. Mirrors codex CLI `~/.codex/auth.json` (confirmed codex rejects env-only via issue openai/codex#5212 closed "not planned"). Phase 1 = gitea side ship. Phase 2 (separate — out-of-scope for this card) = clean GitHub public snapshot to `sky-zhang01/glm-plugin-cc`.

Out of Scope: GitHub public mirror (separate card / snapshot flow); multi-provider fallback; CI pipeline (v0.5+); cancel atomicity (M3 from v0.3.4 codex review, still deferred).

Intended Ref: main @ new commit (post v0.3.4 df89ceb) + tag v0.4.0 (annotated), remote gitea.tokyo.skyzhang.net/SkyLab/glm-plugin-cc.

Planned Actions: (1) commit v0.4.0 on main; (2) push main via cloudflared access token header; (3) create + push tag v0.4.0.

Scope Completion: COMPLETE
- preset-config.mjs: `api_key` field in schema (max 512 chars, trimmed, validated in sanitizeConfig); `resolveApiKeyFromConfig()` separate from `resolveEffectiveConfig` so raw key only enters memory when fetch needs it; `persistApiKey()` writes key-only update; removed cosmetic `api_key_env` from built-in presets
- glm-client.mjs: `resolveApiKey` reads config-only (env-var chain `ZAI_API_KEY` / `Z_AI_API_KEY` / `GLM_API_KEY` removed); `resolveBaseUrl` no longer honors `ZAI_BASE_URL`; `resolveModel` no longer honors `GLM_MODEL` env var (`GLM_TIMEOUT_MS` retained — operational not credential); auth-failure messages point to `/glm:setup --api-key <key>` for rotation
- glm-companion.mjs: `runSetup` accepts `--api-key <key>`; actionsTaken line says "stored api_key to ... (0600)" without key value; setup report exposes `has_api_key: boolean` (never raw key)
- render.mjs: setup renderer shows `api_key: stored | (not set — run /glm:setup --api-key <key>)`; no raw-key echo possible
- commands/setup.md: fully rewritten for Claude-native paste flow — preset via AskUserQuestion, then natural-language key-paste prompt; extraction / anti-echo rules explicit; shell-only path documented as alternative
- commands/rescue.md + agents/glm-rescue.md: "no API key" guidance updated to `/glm:setup` instead of env-var
- README.md: auth section rewritten with new on-disk pattern; env override table trimmed to `GLM_TIMEOUT_MS` only
- CHANGELOG.md: v0.4.0 entry with explicit "accepted same trade-off codex does" rationale + migration path for v0.3.x users
- plugin.json / marketplace.json / package.json: 0.3.4 → 0.4.0

Outstanding In-Scope Work: none

Major Upgrade Review: DONE (minor version — v0.4.0 — because auth architecture shift is breaking for v0.3.x users relying on env-var fallback)
Breaking Changes: env-var auth chain removed. Users on v0.3.x with `export ZAI_API_KEY="..."` must run `/glm:setup --api-key $ZAI_API_KEY` once to migrate the value to config.json, then `unset ZAI_API_KEY` (optional — env var is now ignored). Similarly `ZAI_BASE_URL` env override removed; users must `/glm:setup --preset custom --base-url <url>` instead. `GLM_MODEL` env override removed; use `--model` CLI flag or update `config.json default_model`.
Repo Usage Audit: `grep -rn 'ZAI_API_KEY\|Z_AI_API_KEY\|GLM_API_KEY\|ZAI_BASE_URL\|GLM_MODEL' scripts/ commands/ agents/ README.md` returns zero hits in active code and docs (historical mentions in CHANGELOG pre-v0.4.0 entries preserved). `resolveApiKey()` internal callers: only `getGlmAvailability` + `getGlmAuthStatus` + `runChatRequest` — all go through the same config path.
Verification Plan: executed — `npm run check` (syntax + ESM import resolution on 13 lib modules + 3 top-level scripts) passes; 5-scenario smoke test: (1) setup with --preset + --api-key single-shot persists both, `has_api_key: true`, raw key does NOT appear in JSON output (leak check negative); (2) file mode 0600 verified via stat; (3) rotate via `--api-key` only preserves preset (confirmed via stored key last-8 change while preset unchanged); (4) availability resolves model+endpoint from config with no env vars set (`ready: true`); (5) corrupt config.json fails closed via `config.error` surface.

Local Verification: all pass. Particularly: leak-check (`"secret leaked? False"`) confirms raw key absent from JSON output. Config inspection: `"api_key": "sk-fake-test-key-123"` on disk with `-rw-------` perms. Rotate last-8 test: persisted key changed to `-key-456` while preset unchanged. Corrupt config: `config.error: Could not parse ...` surfaced correctly.

Codex-alignment Evidence: [Issue openai/codex#5212](https://github.com/openai/codex/issues/5212) explicitly closed "not planned" — codex maintainers rejected "use OPENAI_API_KEY env var without writing to auth.json". Official [Authentication docs](https://developers.openai.com/codex/auth) confirm auth.json is the single source. v0.4.0 adopts the same posture.

CI Evidence: no CI pipeline in v0.4.0 (planned v0.5+); ref-bound verification is local-only.

Rollback: delete tag v0.4.0; revert v0.4.0 commit; v0.3.4 remains at its tag. Users who already migrated their key to config.json can still use v0.3.4 if they re-export `ZAI_API_KEY` — v0.3.4 ignores the `api_key` field in config.json. No data loss.
