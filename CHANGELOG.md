# Changelog

## v0.3.2 — 2026-04-20

Corrections to two v0.3.1 claims that were based on incomplete research.
Functional behavior changes: thinking defaults now split per command.
Non-breaking for configured endpoints / API keys / model names.

### Corrections

- **GLM generation ordering in README was wrong.** Listed `glm-4.6` as
  "previous-generation mid-tier" and `glm-4.7` as "previous-generation
  flagship" in the same tier. Official docs.bigmodel.cn confirms
  `glm-4.7` strictly succeeds `glm-4.6` ("surpassing GLM-4.6 across
  multiple dimensions"). Corrected ordering: `glm-5.1 > glm-5 >
  glm-5-turbo (current gen) > glm-4.7 (previous-gen flagship) > glm-4.6
  (older gen, aligned with Claude Sonnet 4)`.
- **Codex CLI default behavior claim was wrong.** v0.3.0 / v0.3.1 said
  "codex `--effort` defaults to unset → equivalent off". Actual codex
  CLI default per `developers.openai.com/codex/config-reference` is
  `model_reasoning_effort = "medium"` — reasoning ON by default. Our
  "thinking default off" was mis-aligned with codex, not aligned.

### Changed

- `scripts/glm-companion.mjs`: `parseThinkingFlag` now accepts a
  per-command default. Call sites pass task-appropriate defaults:
  - `runReview` (review + adversarial-review): default **on**
  - `runTask` with `rescueMode=true`: default **on**
  - `runTask` with `rescueMode=false` (plain `/glm:task`): default **off**
- `commands/review.md`, `commands/adversarial-review.md`,
  `commands/rescue.md`, `commands/task.md`, `agents/glm-rescue.md`:
  wording updated to reflect per-command defaults + codex-`medium`
  alignment.
- `README.md`: generation table rewritten with explicit `Tier` column
  and newest-first ordering. "Thinking / reasoning" section rewritten
  with per-command default table.

### Non-breaking

- `--thinking on|off` still overrides on every command.
- No config file changes; no preset URL changes; no API shape changes.
- Users with `--thinking` explicitly in their invocations keep exact
  prior behavior. Users who never pass `--thinking` will now get `on`
  for review/adversarial-review/rescue (previously `off`).

## v0.3.1 — 2026-04-20

Benchmark-informed default model correction. Functional API unchanged
from v0.3.0; only the default model changes.

### Changed

- `scripts/lib/model-catalog.mjs`: `DEFAULT_MODEL` `glm-4.6` → `glm-5.1`.
- `scripts/lib/preset-config.mjs`: all three preset `default_model`
  fields updated `glm-4.6` → `glm-5.1`.
- `README.md`: rewrote "Model configuration" section with the benchmark
  rationale + re-sorted the commonly-useful table.
- `commands/review.md`, `commands/rescue.md`, `agents/glm-rescue.md`:
  updated default model reference + guidance.

### Why

v0.3.0 defaulted to `glm-4.6` without actually cross-checking against
codex's CLI default. Codex CLI default = `gpt-5.4` (flagship), not
`gpt-5.4-mini` (subagent tier). Picking `glm-4.6` as our default left us
two generations below codex's default tier.

Benchmark check:

| Model | AA Intelligence Index | SWE-Bench Pro |
|---|---|---|
| `gpt-5.4` (codex default) | 57 | — |
| `glm-5.1` | 51 | **58.4** (beats gpt-5.4, Claude Opus 4.6, Gemini 3.1 Pro) |
| `glm-5` | 50 | — |
| `glm-4.6` (previous default) | (older tier) | — |

`glm-5.1` is the closest open-weights tier to `gpt-5.4` on general
intelligence and *leads* on the SWE-Bench Pro coding axis. It's included
in all 智谱 Coding Plan subscription tiers (Max/Pro/Lite) since
2026-03-28. BenchLM aggregate: `glm-5.1` (84) vs `gpt-5.4-mini` (73),
confirming the direction.

### Notes

- Users whose v0.3.0 `~/.config/glm-plugin-cc/config.json` already has
  `default_model: "glm-4.6"` keep that — config-file value wins over the
  built-in default. Re-run `/glm:setup --preset <id>` to refresh to the
  new default, or pass `--default-model glm-5.1` explicitly.
- Thinking still defaults off. Turning on `--thinking on` with `glm-5.1`
  is the strongest mode; it costs latency and token budget.

## v0.3.0 — 2026-04-20

**Breaking**: API format switched from Anthropic-compatible to
**OpenAI-compatible**. This plugin never was meant to replace GLM as a
Claude Code CLI provider; it calls GLM from inside a session over
OpenAI-compatible HTTP. Preset URLs updated accordingly. Users on v0.2.0
must re-run `/glm:setup` (no auto-migration — the previous Anthropic
URLs would 404 against the new client).

### Changed

- `scripts/lib/glm-client.mjs` rewritten:
  - Endpoint now `${base_url}/chat/completions` (was `/v1/messages`).
  - Auth now `Authorization: Bearer <key>` (was `x-api-key`).
  - Request body uses OpenAI `messages[]` schema; `system` promoted to a
    first-role message (was top-level `system`).
  - Response parses `choices[0].message.content` (was `content[].text`).
  - Extracts `choices[0].message.reasoning_content` when present, exposed
    to `render.mjs` as `reasoningSummary`.
- Preset URLs switched to 智谱 BigModel OpenAI-compatible endpoints:
  - `coding-plan` → `https://open.bigmodel.cn/api/coding/paas/v4`
    (was `https://api.z.ai/api/anthropic`)
  - `pay-as-you-go` → `https://open.bigmodel.cn/api/paas/v4`
    (was `https://open.bigmodel.cn/api/anthropic`)
  - `custom` unchanged in shape; now expects OpenAI-compatible URL.
- Fallback base URL when no preset/env is set: now
  `https://open.bigmodel.cn/api/paas/v4` (was `https://api.z.ai/api/anthropic`).
- Preset `display` text rebranded to 智谱 BigModel (国内 default); overseas
  Z.AI or self-hosted endpoints go through `custom`.
- `commands/setup.md` menu wording updated.
- `commands/review.md`, `adversarial-review.md`, `task.md`, `rescue.md`,
  `agents/glm-rescue.md`: documented `--thinking on|off` flag and text-only
  model constraint.

### Added

- `scripts/lib/model-catalog.mjs`:
  - `DEFAULT_MODEL` constant (`glm-4.6`).
  - `isVisionModel(model)` + `assertNonVisionModel(model)` — reject vision
    models (`glm-4v`, `glm-4.5v`, `glm-4.6v`, `glm-4.1v-thinking`, etc.)
    so text-review commands fail fast instead of silently wasting tokens.
- `--thinking on|off` CLI flag for `review`, `adversarial-review`, `task`,
  `rescue`. Default `off` matches codex `--effort unset`; GLM routes via
  `thinking: {"type": "enabled" | "disabled"}` request field.
- `resolveModel()` now validates the selected model against the vision
  deny-list before any HTTP call.

### Security

- Error message on non-https base URLs still truncates long inputs to
  avoid echoing accidentally-pasted credentials (carried from v0.2.0).
- API key still env-only, never persisted.
- `ZAI_BASE_URL` still rejected unless `https://`.

### Rationale

- Clarified architectural intent after confusion in v0.1/v0.2: this plugin
  calls GLM from *inside* a Claude session over OpenAI-compatible HTTP,
  it does not swap Claude for GLM at the CLI provider layer.
- 国内智谱 `open.bigmodel.cn` is the default; 海外 Z.AI is reachable via the
  `custom` preset. Users on v0.2.0 with an Anthropic-format Z.AI URL in
  their config.json need to re-run `/glm:setup` — the plugin will throw
  a clear 404 error if they don't, rather than silently failing.
- Single default model + `--thinking off` by default mirror the
  codex-plugin-cc pattern (no per-command splits; reasoning opt-in).

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
