# Changelog

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
