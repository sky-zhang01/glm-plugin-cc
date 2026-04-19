# Changelog

## v0.2.0 — 2026-04-20

Endpoint preset system + command-layer cleanup. Key UX change: `/glm:setup`
is now interactive (menu-driven via `AskUserQuestion`) for first-time
configuration; behavior for existing env-only users is unchanged.

### Added

- `scripts/lib/preset-config.mjs` with three built-in presets:
  - `coding-plan` → `https://api.z.ai/api/anthropic` (Z.AI subscription)
  - `pay-as-you-go` → `https://open.bigmodel.cn/api/anthropic` (BigModel metered)
  - `custom` → user-provided `https://` endpoint
- Endpoint config persists to `~/.config/glm-plugin-cc/config.json`
  (XDG_CONFIG_HOME honored). Dir 0700, file 0600. API key is **never**
  written to disk — always read from `ZAI_API_KEY` env.
- `glm-companion.mjs setup` accepts `--preset`, `--base-url`,
  `--default-model`.
- `renderSetupReport` shows current endpoint config, env overrides, and
  all available presets.

### Changed

- Endpoint priority now: `ZAI_BASE_URL` env > config file preset >
  built-in fallback (`api.z.ai`). Model priority: `--model` arg >
  `GLM_MODEL` env > config `default_model` > `glm-4.6`.
- `commands/setup.md` rewritten to use `AskUserQuestion` menu for
  first-time setup. Removes the copy-paste `npm install -g` block that
  was incorrect (GLM has no external CLI — plugin IS the runtime).
- `commands/review.md` + `commands/adversarial-review.md` drop the
  `--wait` / `--background` argument-hint lies. Companion is sync-only.
  Both commands now correctly document sync foreground execution.
- `commands/status.md` drops `--wait` / `--timeout-ms` (polling
  leftovers from codex scaffold).
- `commands/cancel.md` description clarified: marks local record only,
  no server-side abort (GLM is stateless HTTP).
- `review.md` removed incorrect claim that focus text is unsupported.

### Security

- Config file written with mode 0600 (owner-only read/write).
- Config dir created with mode 0700, with a follow-up `chmodSync` in case
  the dir pre-existed with looser perms (defense-in-depth).
- `writeConfigFile` writes to a `.tmp-<pid>-<epoch>` file then
  `renameSync` — atomic swap prevents half-written state from concurrent
  `/glm:setup` runs.
- `applyPreset` and `sanitizeConfig` reject non-`https://` base URLs.
  Error messages truncate over-long URLs to avoid echoing
  accidentally-pasted credentials.
- No API key ever written to disk; env-only by design.

## v0.1.1 — 2026-04-20

Post-review fixes from internal sev-verifier + security-auditor passes.

- Add missing `commands/task.md` (sev-verifier finding: `/glm:task` was
  documented + dispatched but no slash-command frontmatter existed; Claude
  Code wouldn't register it).
- Enforce `https://` on `ZAI_BASE_URL` env override (security-auditor T5
  HIGH: plaintext endpoint would leak API key). Override now throws if
  scheme is not https.
- Validate job IDs and enforce path containment in
  `scripts/lib/state.mjs:resolveJobFile` / `resolveJobLogFile`
  (security-auditor T4: defense-in-depth against path traversal via
  malicious `--job-id ../../etc/passwd`). Pattern:
  `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`, max 128 chars; resolved path must
  stay inside jobs dir.

## v0.1.0 — 2026-04-20

Initial release.

- Plugin manifest (`.claude-plugin/plugin.json`) with 7 commands:
  `/glm:setup`, `/glm:review`, `/glm:adversarial-review`, `/glm:task`,
  `/glm:rescue`, `/glm:status`, `/glm:result`, `/glm:cancel`.
- `glm-rescue` subagent for delegated rescue workflows.
- GLM HTTP client (`scripts/lib/glm-client.mjs`): stateless POST to
  `https://api.z.ai/api/anthropic/v1/messages` with `x-api-key` auth.
  Handles 429 / 401 / 403 / 400 / timeout / network errors explicitly.
- Session-lifecycle hook retained from codex-plugin-cc scaffold for
  job-state bookkeeping.
- Stop-review-gate hook **omitted** by design: Claude-dev-harness
  `completion-stop-guard.sh` is the single Stop gate for the SEV
  quality loop.
- Zero runtime npm dependencies. Node >=18.18 required (for global
  `fetch`).
- Derived scaffold from `openai/codex-plugin-cc` (Apache-2.0);
  backend-specific code is original.
