# glm-plugin-cc

Claude Code plugin: use z.ai GLM models as an external reviewer or rescue
backend via **OpenAI-compatible HTTP**.

Chinese version: [README_zh.md](./README_zh.md).

## Why this plugin exists

This plugin is for teams that want a GLM-powered second opinion inside a
Claude Code session without replacing their primary Claude workflow.

It does **not** replace GLM as a provider in the Claude Code CLI itself —
it's a plugin that calls GLM over OpenAI-compatible HTTP from inside a
Claude session, so Claude stays the primary model while GLM provides a
second opinion.

Design constraints:

- **Stateless HTTP.** No persistent sessions, no broker subprocess.
- **No Stop hook.** Review orchestration stays explicit; this plugin does not
  install hidden stop-gate behaviour.
- **Modern Node baseline.** Runtime commands require Node.js `>=24.14.1`;
  development / CI scripts use npm `>=11.0.0`. Still zero runtime npm
  dependencies.
- **OpenAI-compatible schema.** Works with z.ai's
  `https://open.bigmodel.cn/api/.../chat/completions` endpoints out of the box;
  any other OpenAI-compatible endpoint (z.ai or self-hosted) plugs in
  via the `custom` preset.

## Install

Add to your Claude Code plugin marketplace:

```
/plugin marketplace add https://github.com/sky-zhang01/glm-plugin-cc
/plugin install glm@glm-plugin-cc
```

## Auth — no CLI install, no OAuth

GLM is API-key based. There is no `glm login` OAuth and no external CLI
to install — the plugin itself is the runtime. Both the endpoint
preset and the API key persist to `~/.config/glm-plugin-cc/config.json`
(dir 0700 / file 0600).

1. **Endpoint preset** (all OpenAI-compatible):
   - `coding-plan` — `https://open.bigmodel.cn/api/coding/paas/v4`
     (z.ai subscription pricing, **recommended**)
   - `pay-as-you-go` — `https://open.bigmodel.cn/api/paas/v4`
     (z.ai metered)
   - `custom` — bring-your-own OpenAI-compatible URL (e.g.
     `https://api.z.ai/api/paas/v4`, or a self-hosted endpoint)
2. **API key** — persisted to the same config file (field `api_key`,
   file mode 0600). Set / rotate via `/glm:setup --api-key <key>` or
   the interactive paste flow. There is no environment-variable
fallback (`/glm:setup` is the single entry point, matching
the plugin's local config-file model).

### First-time setup

In Claude Code, run:

```
/glm:setup
```

`AskUserQuestion` prompts for the preset, then the plugin asks you to
paste the API key in your next message. The key is stored at
`~/.config/glm-plugin-cc/config.json` with file mode 0600.

Or pass everything at once:

```
/glm:setup --preset coding-plan --api-key sk-...
```

Or from a terminal (keeps the key out of Claude's session logs):

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/glm-companion.mjs" setup --preset coding-plan --api-key "YOUR_KEY"
```

Verify with a minimal network probe:

```
/glm:setup --ping
```

### Rotating or removing the key

- Rotate: `/glm:setup --api-key <new-key>` (preset preserved).
- Remove: delete `~/.config/glm-plugin-cc/config.json` and re-run setup.

### Optional env overrides

| Env var | Effect |
|---|---|
| `GLM_TIMEOUT_MS` | per-request timeout (default 900000 = 15 min) |

Priority for model + endpoint: CLI flag > config file > built-in default
(`https://open.bigmodel.cn/api/paas/v4`, `glm-5.1`).

## Commands

| Command | Purpose |
|---|---|
| `/glm:setup [--preset ...] [--base-url ...] [--default-model ...] [--ping]` | Pick endpoint preset, optionally probe connectivity. |
| `/glm:review [--base <ref>] [--scope auto\|working-tree\|branch] [--model <name>] [--thinking on\|off] [--reflect]` | Balanced review of git diff. Returns structured JSON per `schemas/review-output.schema.json`. `/glm:review` rejects trailing focus text — use `/glm:adversarial-review` for custom framing. |
| `/glm:adversarial-review [same flags] [--reflect] [focus text]` | Aggressive review prioritizing defects + design challenges. `--reflect` opts into one additional reflection/rerank pass. |
| `/glm:task [--system <prompt>] [--model <name>] [--thinking on\|off] [prompt]` | Free-form GLM call. |
| `/glm:rescue [same flags]` | Delegate to the `glm-rescue` subagent for stuck/blocked work. |
| `/glm:status [job-id] [--all]` | List local job history (no server polling — GLM is stateless). |
| `/glm:result <job-id>` | Replay a stored job's final output. |
| `/glm:cancel <job-id>` | Mark a recorded job cancelled (bookkeeping only; no server-side abort). |

## Model configuration

Default model is **`glm-5.1`** — the flagship tier on z.ai:

- Artificial Analysis Intelligence Index: `gpt-5.4` = 57, `glm-5.1` = 51
  (closest open-weights model)
- SWE-Bench Pro: `glm-5.1` = **58.4** on the published benchmark
- BenchLM aggregate: `glm-5.1` = 84 vs `gpt-5.4-mini` = 73
- Available to all z.ai Coding Plan tiers (Max/Pro/Lite) since
  2026-03-28

The plugin intentionally uses a single default model. Override per invocation
with `--model <name>`
or project-wide via `default_model` in the config file. See z.ai's
text-model catalog for available names.

Commonly useful text models (ordered by generation, newest first):

| Model | Tier | When to use |
|---|---|---|
| `glm-5.1` | Current flagship | **Default** — current flagship model for review and rescue tasks. |
| `glm-5` | Current near-flagship | AA Index 50. Cheaper + faster than 5.1, marginal capability drop. |
| `glm-5-turbo` | Current lightweight | Agent-optimized. Use for high-volume or simple tasks where latency matters more than depth. |
| `glm-4.7` | **Previous-generation flagship** | LiveCodeBench V6 open-source SOTA; surpassed GLM-4.6 across multiple dimensions. Use if on a 4.x-only plan. |
| `glm-4.6` | Older generation | Earlier architecture. Only use if 4.7 / 5.x unavailable. |

Vision models (`glm-4v`, `glm-4.5v`, `glm-4.6v`, `glm-4.1v-thinking`, etc.)
are **rejected** — this plugin only sends text messages.

### Thinking / reasoning

Thinking is **on by default across all commands**. Pass `--thinking off` on
any command to disable it for quick/light calls. GLM routes this via the
`thinking: {"type": "enabled" | "disabled"}` request field.

## Architecture

```
Claude Code session
   │
   ├─ /glm:adversarial-review  (command frontmatter: Bash(node:*))
   │       │
   │       └─ node scripts/glm-companion.mjs adversarial-review ...
   │               │
   │               ├─ lib/git.mjs          (collect diff)
   │               ├─ lib/glm-client.mjs   (HTTP POST to /chat/completions)
   │               ├─ lib/model-catalog.mjs (vision deny-list)
   │               ├─ lib/preset-config.mjs (XDG config)
   │               └─ lib/render.mjs       (schema-validated output)
   │
   └─ optional external orchestration / review workflow
```

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## Distribution

See [docs/distribution.md](./docs/distribution.md).
