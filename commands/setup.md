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

**Decision-tree invariant — read this before the branches below.** The branch-dispatch in this file runs exactly once per `/glm:setup` invocation, keyed off the state returned by the *initial* companion call above. Any further `node glm-companion.mjs setup …` call triggered by a branch action (preset remediation, key paste, menu option, ping, review-gate toggle) is treated as a single terminal write: show its stdout verbatim, then stop. Do **not** re-evaluate these branches against the post-rerun state. "Fall through" between branches, where called out, applies only within the initial probe's state evaluation, not across companion reruns.

Then inspect `report.config.preset_id` and `report.config.has_api_key`:

- **Preset unset** (`preset_id: null`): use `AskUserQuestion` once, Coding Plan first and suffixed `(Recommended)`:
  - `z.ai Coding Plan (Recommended)` → `--preset coding-plan`
  - `z.ai Pay-as-you-go` → `--preset pay-as-you-go`
  - `Custom endpoint` → first ask in plain chat: *"Paste the base URL (`https://…`, OpenAI-compatible, no `/chat/completions`)."* Then `--preset custom --base-url <url>`.
  - `Skip` → stop.
  Rerun companion with the chosen preset; fall through.

- **Key missing** (`has_api_key: false`): one-line prompt, nothing else — *"Paste your GLM API key on a single line in your next message. I'll store it at `~/.config/glm-plugin-cc/config.json` (0600) and never echo it back."* When the user replies, extract the token verbatim (strip whitespace, no quoting / paraphrasing) and run `node … setup --api-key "<token>" --json`. Show stdout verbatim. **Pivot guard**: if the reply starts with `/` (e.g., `/glm:review`, `/codex:task`) or is obviously a slash-command invocation rather than a key, do NOT pass it to `--api-key`. Stop, tell the user "That looks like a slash-command, not a GLM API key. No change made — run the slash-command separately, or re-invoke `/glm:setup` and paste the key when prompted.", then exit without calling the companion.

- **Both set AND `$ARGUMENTS` is non-empty** (user passed explicit flags such as `--ping`, `--api-key`, `--preset`, `--enable-review-gate`, `--disable-review-gate`): stop — the companion already handled the explicit request and the JSON report is the full response.

- **Both set AND `$ARGUMENTS` is empty** (bare `/glm:setup` invocation on a healthy configuration): use `AskUserQuestion` exactly once to surface an action menu with these options in order. Every option resolves to either a single terminal companion call or a direct stop (see the decision-tree invariant above — no post-action re-evaluation).
  - `Keep current configuration (done)` → stop. No further action.
  - `Rotate API key` → one-line prompt, nothing else — *"Paste your new GLM API key on a single line in your next message. I'll overwrite the existing key in `~/.config/glm-plugin-cc/config.json` (0600) and never echo it back."* When the user replies, extract the token verbatim (strip whitespace, no quoting / paraphrasing) and run `node … setup --api-key "<token>" --json`. Show stdout verbatim. **Pivot guard**: apply the same `/`-prefix check as the "Key missing" branch above — if the reply looks like a slash-command, refuse and do not call the companion; the existing key remains untouched.
  - `Switch preset` → nested `AskUserQuestion` with four options:
    - `z.ai Coding Plan` → `--preset coding-plan`
    - `z.ai Pay-as-you-go` → `--preset pay-as-you-go`
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
