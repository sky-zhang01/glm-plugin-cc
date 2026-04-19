---
description: Configure GLM endpoint preset and verify API key / connectivity
argument-hint: '[--preset coding-plan|pay-as-you-go|custom] [--base-url <url>] [--default-model <model>] [--ping] [--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), AskUserQuestion
---

GLM is API-key based — there is no `glm login` OAuth and no external CLI to
install. `/glm:setup` writes an endpoint preset to
`~/.config/glm-plugin-cc/config.json`; the API key itself is always read
from the `ZAI_API_KEY` environment variable (never stored on disk).

Raw slash-command arguments:
`$ARGUMENTS`

## Flow

First, always show the current state:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" setup --json $ARGUMENTS
```

Inspect the JSON output. Branch on what it reports:

### Case A — arguments include an explicit `--preset` or `--base-url`

The companion already persisted the choice on that same run. Render the
final JSON to the user and stop — no menu needed.

### Case B — no preset arguments, and `report.config.preset_id` is null (first-time setup)

Use `AskUserQuestion` exactly once with these four options, putting
`Z.AI Coding Plan` first and suffixing it with `(Recommended)`:

- `Z.AI Coding Plan (Recommended)` — `api.z.ai/api/anthropic`, subscription pricing
- `Pay-as-you-go` — `open.bigmodel.cn/api/anthropic`, metered billing
- `Custom endpoint` — bring-your-own Anthropic-compatible URL
- `Skip` — don't configure now

Based on the answer:

- `Z.AI Coding Plan` → run:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" setup --preset coding-plan --json
  ```
- `Pay-as-you-go` → run:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" setup --preset pay-as-you-go --json
  ```
- `Custom endpoint` → ask the user once with a plain-text prompt (NOT `AskUserQuestion`): *"Paste the base URL (must start with https://, do not include /v1/messages)."*
  Then run:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" setup --preset custom --base-url "<url>" --json
  ```
- `Skip` → do not run again; surface the initial output plus a reminder that
  `/glm:setup` can be re-run any time.

### Case C — no preset arguments, and `report.config.preset_id` is already set

Do not show the preset menu. Just render the initial setup output verbatim.

## After preset is written

If the rendered output shows `glm.detail: ... API key not set`, tell the user:

> GLM preset saved. Set your API key in your shell, e.g.:
>
> ```bash
> export ZAI_API_KEY="<your-key>"
> ```
>
> Then re-run `/glm:setup --ping` to verify connectivity.

If the user asks where to obtain the key:

- Coding Plan key → https://z.ai subscription console
- Pay-as-you-go key → https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys
- Custom preset → whichever provider issued the endpoint

## Output rules

- Present the final companion stdout verbatim.
- Do not strip the JSON wrapper when running with `--json`.
- Never store the API key anywhere yourself, and never ask the user to
  paste their API key into this conversation. Always direct them to
  `export ZAI_API_KEY=...` in their shell.
