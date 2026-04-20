---
description: Configure GLM endpoint preset + API key. Both persist to ~/.config/glm-plugin-cc/config.json (0600).
argument-hint: '[--preset coding-plan|pay-as-you-go|custom] [--base-url <url>] [--default-model <model>] [--api-key <key>] [--ping] [--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), AskUserQuestion
---

GLM is API-key based — no `glm login` OAuth, no external CLI to install.
`/glm:setup` writes both the endpoint preset and the API key to
`~/.config/glm-plugin-cc/config.json` (dir 0700 / file 0600). This
mirrors the codex CLI pattern (`codex login --api-key <key>` writing to
`~/.codex/auth.json`).

All built-in presets point at **OpenAI-compatible** endpoints
(`POST /chat/completions`). Defaults target 国内智谱 BigModel. Overseas
Z.AI or self-hosted endpoints go through the `custom` preset.

Raw slash-command arguments:
`$ARGUMENTS`

## Flow

First, always snapshot current state:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" setup --json "$ARGUMENTS"
```

Then inspect the JSON output (`report.config.preset_id`,
`report.config.has_api_key`) and branch:

### Case A — arguments include `--preset` AND `--api-key`

The companion already persisted both on that run. Render the final
output to the user. Done.

### Case B — arguments include `--preset` but NOT `--api-key`

Preset has been persisted. Now prompt the user for the API key:

1. Tell the user: *"Paste your GLM API key on a single line in your next
   message. I'll store it in `~/.config/glm-plugin-cc/config.json`
   (mode 0600) and never echo it back."*
2. When the user replies, extract ONLY the API key token (everything
   between leading / trailing whitespace — do NOT paraphrase or quote
   the key).
3. Run:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" setup --api-key "<pasted-key>" --json
   ```
4. In your response, confirm persistence WITHOUT echoing the key value.
   The companion's `actionsTaken` line says "stored api_key to ...
   (0600)" — that is the only confirmation needed.

### Case C — no arguments, `report.config.preset_id` is null (first-time setup)

Use `AskUserQuestion` exactly once with these four options, `Coding
Plan` first and suffixed `(Recommended)`:

- `智谱 BigModel Coding Plan (Recommended)` — `open.bigmodel.cn/api/coding/paas/v4`, subscription pricing
- `智谱 BigModel Pay-as-you-go` — `open.bigmodel.cn/api/paas/v4`, metered billing
- `Custom endpoint` — bring-your-own OpenAI-compatible URL
- `Skip` — don't configure now

After the user picks:

- `智谱 BigModel Coding Plan`:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" setup --preset coding-plan --json
  ```
- `智谱 BigModel Pay-as-you-go`:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" setup --preset pay-as-you-go --json
  ```
- `Custom endpoint`: ask the user (plain-text prompt, NOT `AskUserQuestion`): *"Paste the base URL (must start with `https://`, OpenAI-compatible; do NOT include `/chat/completions`)."* Then:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" setup --preset custom --base-url "<url>" --json
  ```
- `Skip`: surface the initial output + reminder that `/glm:setup` can
  re-run any time. Do NOT proceed to key prompt.

Once the preset is persisted, drop into **Case B flow** above to collect
the API key.

### Case D — `report.config.preset_id` set + `report.config.has_api_key` true + no args

Nothing to do. Render the current state verbatim. If the user wants
to rotate the key, tell them to run `/glm:setup --api-key <new-key>`.

### Case E — `report.config.preset_id` set + `report.config.has_api_key` false + no args

Preset exists but the key is missing. Drop into **Case B flow** to
prompt for the key.

## Where to get the API key

- Coding Plan key → https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys (subscription tier)
- Pay-as-you-go key → https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys (metered tier)
- Custom preset → whichever provider issued the endpoint

## Secrets handling rules

- NEVER print the API key back to the user in any form (no quoting, no
  summarizing, no "your key starts with ..."). The only confirmation is
  the companion's `stored api_key to ... (0600)` line.
- NEVER include the key in a Claude `TodoWrite` entry, explanation, or
  chat summary. Extract → pass as `--api-key "<key>"` to `node` →
  forget.
- If the user pastes multiple lines or extra prose, extract just the
  token (typically `sk-...` or a long hex / base64-ish blob). If
  ambiguous, ask them to re-paste just the key on one line.
- The companion sets file mode 0600 on write. Do not add `chmod`
  suggestions.

## Output rules

- Present the final companion stdout verbatim.
- Do not strip the JSON wrapper when running with `--json`.
- Sensitive material NEVER appears in your response. The companion's
  report uses `has_api_key: true | false` specifically so rendering is
  safe.

## Alternative (shell-only, for users who want the key out of Claude chat logs)

Experienced users can skip the Claude-chat paste and run directly in a
terminal:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/glm-companion.mjs" setup --preset coding-plan --api-key "YOUR_KEY_HERE"
```

The Claude session logs don't see the key this way; only the shell
history does. Most users don't need this.
