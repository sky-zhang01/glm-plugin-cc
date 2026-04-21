---
description: Configure GLM endpoint preset + API key (persists to ~/.config/glm-plugin-cc/config.json, mode 0600).
argument-hint: '[--preset coding-plan|pay-as-you-go|custom] [--base-url <url>] [--default-model <model>] [--api-key <key>] [--ping] [--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" setup --json "$ARGUMENTS"
```

Present the companion stdout verbatim. Do not add commentary, bullet-list summary, or Chinese re-statement — the JSON report is the full response.

Then inspect `report.config.preset_id` and `report.config.has_api_key`:

- **Preset unset** (`preset_id: null`): use `AskUserQuestion` once, Coding Plan first and suffixed `(Recommended)`:
  - `智谱 BigModel Coding Plan (Recommended)` → `--preset coding-plan`
  - `智谱 BigModel Pay-as-you-go` → `--preset pay-as-you-go`
  - `Custom endpoint` → first ask in plain chat: *"Paste the base URL (`https://…`, OpenAI-compatible, no `/chat/completions`)."* Then `--preset custom --base-url <url>`.
  - `Skip` → stop.
  Rerun companion with the chosen preset; fall through.

- **Key missing** (`has_api_key: false`): one-line prompt, nothing else — *"Paste your GLM API key on a single line in your next message. I'll store it at `~/.config/glm-plugin-cc/config.json` (0600) and never echo it back."* When the user replies, extract the token verbatim (strip whitespace, no quoting / paraphrasing) and run `node … setup --api-key "<token>" --json`. Show stdout verbatim.

- **Both set AND `$ARGUMENTS` is non-empty** (user passed explicit flags such as `--ping`, `--api-key`, `--preset`, `--enable-review-gate`, `--disable-review-gate`): stop — the companion already handled the explicit request and the JSON report is the full response.

- **Both set AND `$ARGUMENTS` is empty** (bare `/glm:setup` invocation on a healthy configuration): use `AskUserQuestion` exactly once to surface an action menu with these options in order. **Each option is terminal** — after showing companion stdout from the chosen action, stop; the branch-dispatch rules above apply only to the initial probe and must not re-open the menu on the post-action state.
  - `Keep current configuration (done)` → stop. No further action.
  - `Rotate API key` → one-line prompt, nothing else — *"Paste your new GLM API key on a single line in your next message. I'll overwrite the existing key in `~/.config/glm-plugin-cc/config.json` (0600) and never echo it back."* When the user replies, extract the token verbatim (strip whitespace, no quoting / paraphrasing) and run `node … setup --api-key "<token>" --json`. Show stdout verbatim.
  - `Switch preset` → nested `AskUserQuestion` with four options:
    - `智谱 BigModel Coding Plan` → `--preset coding-plan`
    - `智谱 BigModel Pay-as-you-go` → `--preset pay-as-you-go`
    - `Custom endpoint` → first ask in plain chat: *"Paste the base URL (`https://…`, OpenAI-compatible, no `/chat/completions`)."* Then `--preset custom --base-url <url>`.
    - `Cancel` → stop.
    Rerun companion with the chosen preset; show stdout verbatim.
  - `Ping test (validate connectivity)` → run `node … setup --ping --json`. Show stdout verbatim.
  - `Toggle review gate` → nested `AskUserQuestion` with three options:
    - `Enable stop-time review gate` → `--enable-review-gate`
    - `Disable stop-time review gate` → `--disable-review-gate`
    - `Cancel` → stop.
    Rerun companion with the chosen flag; show stdout verbatim.
  - `Cancel` → stop. No further action.

Secrets rules: never echo the key (no quote, summary, or "starts with…"); never put it in `TodoWrite`, chat summary, or explanation. The companion's `stored api_key to … (0600)` line is the only confirmation.

API keys: https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys (both tiers).
Shell-only: `node "$CLAUDE_PLUGIN_ROOT/scripts/glm-companion.mjs" setup --preset coding-plan --api-key "YOUR_KEY"`
