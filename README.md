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

## Auth

Obtain a Z.AI API key (GLM Coding Plan) from https://z.ai, then set:

```bash
export ZAI_API_KEY="..."      # required
export GLM_MODEL="glm-4.6"    # optional; default glm-4.6
export ZAI_BASE_URL="https://api.z.ai/api/anthropic"  # optional override
export GLM_TIMEOUT_MS="900000"  # optional; default 15 min
```

Verify:

```
/glm:setup --ping
```

`--ping` sends a minimal request to confirm the endpoint + API key.

## Commands

| Command | Purpose |
|---|---|
| `/glm:setup [--ping] [--enable-review-gate\|--disable-review-gate]` | Check availability, probe API key, toggle the review-gate flag (harness reads this flag; harness, not this plugin, actually gates Stop). |
| `/glm:review [--base <ref>] [--scope auto\|working-tree\|branch]` | Balanced review of git diff. Returns structured JSON per `schemas/review-output.schema.json`. |
| `/glm:adversarial-review [same flags] [focus text]` | Aggressive review prioritizing defects over approval. |
| `/glm:task [--system <prompt>] [--model <name>] [prompt]` | Free-form GLM call. |
| `/glm:rescue [same flags]` | Delegate to the `glm-rescue` subagent for stuck/blocked work. |
| `/glm:status [job-id] [--all]` | List local job history. |
| `/glm:result <job-id>` | Replay a stored job's final output. |
| `/glm:cancel <job-id>` | Mark a recorded job cancelled (GLM is stateless; no server-side interrupt sent). |

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
