# glm-plugin-cc

Claude Code plugin: use Z.AI GLM models as an external reviewer or rescue
backend via Anthropic-compatible HTTP. Scaffold derived from
[openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) (Apache-2.0).

## Why this plugin exists

This plugin is one of the external reviewers feeding into
[claude-dev-harness](https://gitea.tokyo.skyzhang.net/SkyLab/claude-dev-harness)'s
SEV `/verify` Layer 3 orchestration. When the primary codex reviewer is
rate-limited or unavailable, GLM is the secondary provider in the
fallback chain.

Design constraints:

- **Stateless HTTP.** No persistent sessions, no broker subprocess.
- **No Stop hook.** Orchestration and Stop-gate logic live in the harness
  (`completion-stop-guard.sh`), not in plugins. See
  [claude-dev-harness docs/quality-loop-v3-boundary-crosswalk.md §4.4](https://gitea.tokyo.skyzhang.net/SkyLab/claude-dev-harness/src/branch/plan/quality-loop-v3/docs/quality-loop-v3-boundary-crosswalk.md).
- **Zero runtime npm deps.** Only Node stdlib (global `fetch` since 18.18).
- **Anthropic-compatible schema.** Works with Z.AI's
  `https://api.z.ai/api/anthropic/v1/messages` endpoint out of the box.

## Install

Add to your Claude Code plugin marketplace:

```
/plugin marketplace add https://gitea.tokyo.skyzhang.net/SkyLab/glm-plugin-cc
/plugin install glm@SkyLab/glm-plugin-cc
```

## Auth — no CLI install, no OAuth

GLM is API-key based. There is no `glm login` OAuth and no external CLI
to install — the plugin itself is the runtime. Configuration has two
independent parts:

1. **Endpoint preset** (persisted to `~/.config/glm-plugin-cc/config.json`,
   dir 0700 / file 0600):
   - `coding-plan` — `https://api.z.ai/api/anthropic` (subscription pricing)
   - `pay-as-you-go` — `https://open.bigmodel.cn/api/anthropic` (BigModel metered)
   - `custom` — bring-your-own Anthropic-compatible URL
2. **API key** — always read from the `ZAI_API_KEY` environment variable.
   Never written to disk.

### First-time setup

Run `/glm:setup` in Claude Code. It prompts you via `AskUserQuestion` to
pick a preset. Or pass one directly:

```
/glm:setup --preset coding-plan
/glm:setup --preset pay-as-you-go
/glm:setup --preset custom --base-url https://your-endpoint.example.com/anthropic
```

Then export your API key in your shell (add to `.zshrc` / `.bashrc` for
persistence):

```bash
# Coding Plan key → get from https://z.ai
# Pay-as-you-go key → get from https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys
export ZAI_API_KEY="..."
```

Verify with a minimal network probe:

```
/glm:setup --ping
```

### Env overrides

| Env var | Effect |
|---|---|
| `ZAI_API_KEY` (also `Z_AI_API_KEY`, `GLM_API_KEY`) | required; no disk fallback |
| `ZAI_BASE_URL` | overrides config-file preset (must be `https://`) |
| `GLM_MODEL` | overrides config-file `default_model` |
| `GLM_TIMEOUT_MS` | per-request timeout (default 900000 = 15 min) |

Priority: CLI flag > env var > config file > built-in default.

## Commands

| Command | Purpose |
|---|---|
| `/glm:setup [--preset ...] [--base-url ...] [--default-model ...] [--ping]` | Pick endpoint preset, optionally probe connectivity. |
| `/glm:review [--base <ref>] [--scope auto\|working-tree\|branch] [--model <name>] [focus text]` | Balanced review of git diff. Returns structured JSON per `schemas/review-output.schema.json`. |
| `/glm:adversarial-review [same flags] [focus text]` | Aggressive review prioritizing defects + design challenges. |
| `/glm:task [--system <prompt>] [--model <name>] [prompt]` | Free-form GLM call. |
| `/glm:rescue [same flags]` | Delegate to the `glm-rescue` subagent for stuck/blocked work. |
| `/glm:status [job-id] [--all]` | List local job history (no server polling — GLM is stateless). |
| `/glm:result <job-id>` | Replay a stored job's final output. |
| `/glm:cancel <job-id>` | Mark a recorded job cancelled (bookkeeping only; no server-side abort). |

## Model configuration

Default model is `glm-4.6`. Override per-invocation with `--model glm-4.7`
or globally via `GLM_MODEL` env var. See Z.AI's model catalog for
available names.

## Architecture

```
Claude Code session
   │
   ├─ /glm:adversarial-review  (command frontmatter: Bash(node:*))
   │       │
   │       └─ node scripts/glm-companion.mjs adversarial-review ...
   │               │
   │               ├─ lib/git.mjs       (collect diff)
   │               ├─ lib/glm-client.mjs (HTTP POST to api.z.ai)
   │               └─ lib/render.mjs    (schema-validated output)
   │
   └─ harness SEV /verify Layer 3 (external orchestration, stop-gate)
```

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
