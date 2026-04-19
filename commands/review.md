---
description: Run a GLM code review against local git state
argument-hint: '[--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--thinking on|off] [focus text]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*)
---

Run a balanced GLM review of the current git state.

Raw slash-command arguments:
`$ARGUMENTS`

## Core constraint

- This command is review-only.
- Do not fix issues, apply patches, or suggest you are about to make changes.
- Your only job is to run the review and return GLM's output verbatim.

## Execution

GLM is stateless HTTP. All calls are synchronous foreground. There is no
`--wait` / `--background` / `--resume` / `--fresh`. Polling commands
(`/glm:status`, `/glm:result`) exist only for local job-log inspection.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" review $ARGUMENTS
```

Return the command stdout verbatim. Do not paraphrase, summarize, or add
commentary before or after it. Do not fix any issues mentioned in the
review output.

## Scope flags (parsed by companion)

- `--base <ref>` — base branch for branch-scope review (default: repo's
  default branch).
- `--scope auto|working-tree|branch` — review scope (default: `auto`).
- `--model <model>` — override GLM model (default: `glm-5.1` or whatever
  the `GLM_MODEL` env var / config says). Text models only — vision
  models (e.g. `glm-4v`, `glm-4.5v`) are rejected. Use `--model glm-4.6`
  or `--model glm-5-turbo` when latency / cost matters more than the
  flagship reasoning tier.
- `--thinking on|off` — toggle GLM reasoning mode (default: `on` for
  `review`; mirrors codex CLI default `model_reasoning_effort = "medium"`
  for `gpt-5.4`). Use `--thinking off` on fast targets when the latency /
  token cost outweighs the reasoning benefit.
- Trailing tokens after flags are treated as free-form focus text.
