# Changelog

## v0.4.0 — 2026-04-20

Initial public release.

### Plugin surface

- `/glm:setup` — pick endpoint preset + store API key (persisted to
  `~/.config/glm-plugin-cc/config.json`, mode 0600). Three built-in
  presets: `coding-plan` (智谱 BigModel subscription,
  `open.bigmodel.cn/api/coding/paas/v4`), `pay-as-you-go`
  (`open.bigmodel.cn/api/paas/v4`), `custom` (bring-your-own
  OpenAI-compatible URL).
- `/glm:review` — balanced review of git diff. Returns structured
  JSON per `schemas/review-output.schema.json`.
- `/glm:adversarial-review` — aggressive review, prioritizes
  defects and design challenges.
- `/glm:task` — free-form GLM call.
- `/glm:rescue` — delegates to the `glm-rescue` subagent for
  stuck/blocked work.
- `/glm:status` / `/glm:result` / `/glm:cancel` — local job record
  inspection (GLM is stateless HTTP — these are bookkeeping only,
  no server polling).

### Design

- **Auth — codex-CLI-style.** API key persists to
  `~/.config/glm-plugin-cc/config.json` (XDG-compliant, dir 0700 /
  file 0600), same pattern as codex's `~/.codex/auth.json`. No
  environment-variable fallback; `/glm:setup --api-key <key>` is the
  single entry point for configuration.
- **OpenAI-compatible HTTP.** `POST /chat/completions` with
  `Authorization: Bearer <api_key>`, OpenAI `messages[]` schema.
- **Stateless.** No persistent sessions, no broker subprocess, no
  thread resume. Every call is an independent HTTP request.
- **Default model = `glm-5.1`.** Picked to match codex CLI's
  default tier (`gpt-5.4`); see README "Model configuration" for
  benchmark rationale.
- **Thinking on by default** across all commands. Mirrors codex
  CLI's `model_reasoning_effort = "medium"` default. Pass
  `--thinking off` for light / quick calls.
- **Vision models rejected.** The plugin only issues text requests;
  `glm-4v` / `glm-4.5v` / `glm-4.6v` / `glm-4.1v-thinking` and
  pattern-matched variants are rejected early.
- **Zero runtime npm deps.** Node stdlib only. Requires Node ≥ 18.18
  for global `fetch`.

### Security posture

- API key stored with file mode 0600; dir 0700; atomic write via
  tmp+rename.
- API key never appears in setup report output, job records,
  rendered review output, or error messages. Only a boolean
  `has_api_key` indicates presence.
- HTTPS enforced on all endpoints. Custom base URLs rejected if not
  `https://`.
- Error / status messages strip `user:pass@`, query string, and
  fragment from URLs before display.
- Job state + log files written with mode 0600 (dir 0700).
- Job IDs validated against `[a-zA-Z0-9][a-zA-Z0-9_-]*`, max 128
  chars; resolved paths must stay inside the jobs directory
  (path-traversal defense).
- Slash-command frontmatter quotes `$ARGUMENTS` to prevent shell
  metachar escape.
- Corrupt config file FAILS CLOSED (does not silently fall back to
  the built-in endpoint).

### Credits

Scaffold derived from
[openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)
(Apache-2.0). GLM-specific backend code is original. See
[NOTICE](./NOTICE).
