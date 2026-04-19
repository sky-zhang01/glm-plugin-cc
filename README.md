# glm-plugin-cc

Claude Code plugin: use 智谱 GLM models as an external reviewer or rescue
backend via **OpenAI-compatible HTTP**. Scaffold derived from
[openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) (Apache-2.0).

## Why this plugin exists

This plugin is one of the external reviewers feeding into
[claude-dev-harness](https://gitea.tokyo.skyzhang.net/SkyLab/claude-dev-harness)'s
SEV `/verify` Layer 3 orchestration. When the primary codex reviewer is
rate-limited or unavailable, GLM is the secondary provider in the
fallback chain.

It does **not** replace GLM as a provider in the Claude Code CLI itself —
it's a plugin that calls GLM over OpenAI-compatible HTTP from inside a
Claude session, so Claude stays the primary model while GLM provides a
second opinion.

Design constraints:

- **Stateless HTTP.** No persistent sessions, no broker subprocess.
- **No Stop hook.** Orchestration and Stop-gate logic live in the harness
  (`completion-stop-guard.sh`), not in plugins. See
  [claude-dev-harness docs/quality-loop-v3-boundary-crosswalk.md §4.4](https://gitea.tokyo.skyzhang.net/SkyLab/claude-dev-harness/src/branch/plan/quality-loop-v3/docs/quality-loop-v3-boundary-crosswalk.md).
- **Zero runtime npm deps.** Only Node stdlib (global `fetch` since 18.18).
- **OpenAI-compatible schema.** Works with 智谱 BigModel's
  `https://open.bigmodel.cn/api/.../chat/completions` endpoints out of the box;
  any other OpenAI-compatible endpoint (海外 Z.AI, self-hosted) plugs in
  via the `custom` preset.

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
   dir 0700 / file 0600; all OpenAI-compatible):
   - `coding-plan` — `https://open.bigmodel.cn/api/coding/paas/v4`
     (智谱 BigModel subscription pricing, **recommended**)
   - `pay-as-you-go` — `https://open.bigmodel.cn/api/paas/v4`
     (智谱 BigModel metered)
   - `custom` — bring-your-own OpenAI-compatible URL (e.g. 海外 Z.AI:
     `https://api.z.ai/api/paas/v4`, or a self-hosted endpoint)
2. **API key** — always read from the `ZAI_API_KEY` environment variable.
   Never written to disk.

### First-time setup

Run `/glm:setup` in Claude Code. It prompts you via `AskUserQuestion` to
pick a preset. Or pass one directly:

```
/glm:setup --preset coding-plan
/glm:setup --preset pay-as-you-go
/glm:setup --preset custom --base-url https://your-endpoint.example.com/openai
```

Then export your API key in your shell (add to `.zshrc` / `.bashrc` for
persistence):

```bash
# Get from https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys
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
| `ZAI_BASE_URL` | overrides config-file preset (must be `https://`, OpenAI-compatible) |
| `GLM_MODEL` | overrides config-file `default_model` |
| `GLM_TIMEOUT_MS` | per-request timeout (default 900000 = 15 min) |

Priority: CLI flag > env var > config file > built-in default
(`https://open.bigmodel.cn/api/paas/v4`, `glm-5.1`).

## Commands

| Command | Purpose |
|---|---|
| `/glm:setup [--preset ...] [--base-url ...] [--default-model ...] [--ping]` | Pick endpoint preset, optionally probe connectivity. |
| `/glm:review [--base <ref>] [--scope auto\|working-tree\|branch] [--model <name>] [--thinking on\|off] [focus text]` | Balanced review of git diff. Returns structured JSON per `schemas/review-output.schema.json`. |
| `/glm:adversarial-review [same flags] [focus text]` | Aggressive review prioritizing defects + design challenges. |
| `/glm:task [--system <prompt>] [--model <name>] [--thinking on\|off] [prompt]` | Free-form GLM call. |
| `/glm:rescue [same flags]` | Delegate to the `glm-rescue` subagent for stuck/blocked work. |
| `/glm:status [job-id] [--all]` | List local job history (no server polling — GLM is stateless). |
| `/glm:result <job-id>` | Replay a stored job's final output. |
| `/glm:cancel <job-id>` | Mark a recorded job cancelled (bookkeeping only; no server-side abort). |

## Model configuration

Default model is **`glm-5.1`** — the flagship tier on 智谱 BigModel.
Picked to match codex CLI's default tier (`gpt-5.4`):

- Artificial Analysis Intelligence Index: `gpt-5.4` = 57, `glm-5.1` = 51
  (closest open-weights model)
- SWE-Bench Pro: `glm-5.1` = **58.4** (outperforms `gpt-5.4`, Claude
  Opus 4.6, Gemini 3.1 Pro on this benchmark)
- BenchLM aggregate: `glm-5.1` = 84 vs `gpt-5.4-mini` = 73
- Available to all 智谱 Coding Plan tiers (Max/Pro/Lite) since
  2026-03-28

This mirrors the codex-plugin-cc pattern of a single default (no
per-command model split) — override per-invocation with `--model <name>`
or globally via the `GLM_MODEL` env var. See 智谱 BigModel's text-model
catalog for available names.

Commonly useful text models (ordered by generation, newest first):

| Model | Tier | When to use |
|---|---|---|
| `glm-5.1` | Current flagship | **Default** — closest open-weights tier to `gpt-5.4` (AA Index 51 vs 57); SWE-Bench Pro 58.4 beats `gpt-5.4` / Opus 4.6 / Gemini 3.1 Pro. |
| `glm-5` | Current near-flagship | AA Index 50. Cheaper + faster than 5.1, marginal capability drop. |
| `glm-5-turbo` | Current lightweight | Agent-optimized. Use for high-volume or simple tasks where latency matters more than depth. |
| `glm-4.7` | **Previous-generation flagship** | LiveCodeBench V6 open-source SOTA; surpassed GLM-4.6 across multiple dimensions. Use if on a 4.x-only plan. |
| `glm-4.6` | Older generation | Aligned with Claude Sonnet 4 on most benchmarks. Earlier architecture. Only use if 4.7 / 5.x unavailable. |

Vision models (`glm-4v`, `glm-4.5v`, `glm-4.6v`, `glm-4.1v-thinking`, etc.)
are **rejected** — this plugin only sends text messages.

### Thinking / reasoning

Thinking defaults are **per-command**, mirroring codex CLI's
`model_reasoning_effort = "medium"` default on `gpt-5.4` for
deep-analysis work:

| Command | Default | Rationale |
|---|---|---|
| `/glm:review` | **on** | Code review benefits from reasoning. |
| `/glm:adversarial-review` | **on** | Adversarial passes need depth. |
| `/glm:rescue` | **on** | Rescue = stuck work needs extended analysis. |
| `/glm:task` | **off** | Free-form channel; user opts in with `--thinking on`. |

Override on any command with `--thinking on` or `--thinking off`. GLM
routes this via the `thinking: {"type": "enabled" | "disabled"}` request
field.

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
   └─ harness SEV /verify Layer 3 (external orchestration, stop-gate)
```

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
