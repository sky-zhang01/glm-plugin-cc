---
description: Run a GLM code review against local git state
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--thinking on|off] [--temperature <0-2>] [--top-p <0-1>] [--seed <int>] [focus text]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run a balanced GLM review of the current git state.

Raw slash-command arguments:
`$ARGUMENTS`

## Core constraint

- This command is review-only.
- Do not fix issues, apply patches, or suggest you are about to make changes.
- Your only job is to run the review and return GLM's output verbatim.

## Execution mode rules

GLM is a single synchronous HTTP POST per review — but with `thinking` on and a
large diff, that round-trip can take several minutes during which the Claude
session is blocked. `--wait` keeps the synchronous foreground behavior;
`--background` detaches via Claude Code's `Bash(run_in_background: true)` so the
session stays responsive. Both flags are accepted by the companion as no-ops
(actual foreground/background is owned by Claude Code).

- `--wait` and `--background` are mutually exclusive. If both are present, `--wait` takes precedence (run in foreground).
- If the raw arguments include `--wait`, do not ask. Run the review in the foreground.
- If the raw arguments include `--background` (and `--wait` is not also present), do not ask. Run the review in a Claude background task.
- Otherwise, estimate the review size before asking:
  - For working-tree review, start with `git status --short --untracked-files=all`.
  - For working-tree review, also inspect both `git diff --shortstat --cached` and `git diff --shortstat`.
  - For base-branch review, use `git diff --shortstat <base>...HEAD`.
  - Treat untracked files or directories as reviewable work even when `git diff --shortstat` is empty.
  - Only conclude there is nothing to review when the relevant working-tree status is empty or the explicit branch diff is empty.
  - If any `git diff` probe exits nonzero (shallow clone, non-existent `--base` ref, detached HEAD, repository error), do NOT classify the diff as empty or tiny. Treat the size as unclear and recommend background. Surface the error message to the user so they can correct the invocation if needed.
  - Recommend waiting only when the review is clearly tiny, roughly 1-2 files total and no sign of a broader directory-sized change.
  - In every other case, including unclear size, recommend background.
  - When in doubt, run the review instead of declaring that there is nothing to review.
- Then use `AskUserQuestion` exactly once with two options, putting the recommended option first and suffixing its label with `(Recommended)`:
  - `Wait for results`
  - `Run in background`

Argument handling:
- Preserve the user's arguments exactly.
- Do not strip `--wait` or `--background` yourself.
- The companion script parses `--wait` and `--background` as accepted no-op flags (so they don't pollute focus text), but Claude Code's `Bash(..., run_in_background: true)` is what actually detaches the run.
- `/glm:review` is balanced-review only. It does not support staged-only review, unstaged-only review, or extra focus text. If the user needs custom review instructions or more adversarial framing, they should use `/glm:adversarial-review`.

## Foreground flow

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" review "$ARGUMENTS"
```

Return the command stdout verbatim. Do not paraphrase, summarize, or add
commentary before or after it. Do not fix any issues mentioned in the
review output.

## Background flow

Launch the review with `Bash` in the background:

```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" review "$ARGUMENTS"`,
  description: "GLM review",
  run_in_background: true
})
```

- Do not call `BashOutput` or wait for completion in this turn.
- After launching the command, tell the user: "GLM review started in the background. Check `/glm:status` for progress, `/glm:result <id>` to replay when done."

## Scope flags (parsed by companion)

- `--base <ref>` — base branch for branch-scope review (default: repo's
  default branch).
- `--scope auto|working-tree|branch` — review scope (default: `auto`).
- `--model <model>` — override GLM model (default: `glm-5.1` or whatever
  `default_model` in the config file says). Text models only — vision
  models (e.g. `glm-4v`, `glm-4.5v`) are rejected. Use `--model glm-4.6`
  or `--model glm-5-turbo` when latency / cost matters more than the
  flagship reasoning tier.
- `--thinking on|off` — toggle GLM reasoning mode (default `on` across
  all commands; mirrors codex CLI default `model_reasoning_effort =
  "medium"` on `gpt-5.4`). Use `--thinking off` on fast targets when the
  latency / token cost outweighs the reasoning benefit. BigModel API
  only exposes binary enabled/disabled; no multi-level effort control
  is available.
- `--temperature <0-2>` / `--top-p <0-1>` / `--seed <int>` — sampling
  parameters forwarded to the BigModel API. Unset = BigModel
  server-side default (generally tuned for chat, not review). Lowering
  temperature (e.g. `0.2`) and top-p (e.g. `0.85`) makes review more
  deterministic and is worth trying if you observe fabricated
  citations or schema-echo failures. `--seed 42` plus low temperature
  makes runs approximately reproducible. The plugin does NOT ship
  opinionated defaults yet — see Gitea issue #7 for the in-flight
  empirical investigation.
- `--wait` / `--background` — execution mode bypass. See "Execution mode rules" above.
- Trailing tokens after flags are treated as free-form focus text.
