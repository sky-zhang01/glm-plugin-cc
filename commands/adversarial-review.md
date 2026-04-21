---
description: Run a GLM review that challenges the implementation approach and design choices
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--thinking on|off] [--temperature <0-2>] [--top-p <0-1>] [--seed <int>] [focus ...]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run an adversarial GLM review that questions the chosen approach, design
choices, tradeoffs, and assumptions — not just a stricter defect scan.

Raw slash-command arguments:
`$ARGUMENTS`

## Core constraint

- Review-only. Do not fix issues, apply patches, or signal you are about
  to make changes.
- Keep the framing on whether the current approach is right, what
  assumptions it depends on, and where the design could fail under real
  conditions.
- Return GLM's output verbatim.

## Execution mode rules

Adversarial review with `thinking` on is typically slower than balanced review
(deeper analysis per finding). `--wait` keeps synchronous foreground;
`--background` detaches via Claude Code's `Bash(run_in_background: true)` so
the session stays responsive for large diffs.

- `--wait` and `--background` are mutually exclusive. If both are present, `--wait` takes precedence (run in foreground).
- If the raw arguments include `--wait`, do not ask. Run in the foreground.
- If the raw arguments include `--background` (and `--wait` is not also present), do not ask. Run in a Claude background task.
- Otherwise, estimate the review size before asking:
  - For working-tree review, start with `git status --short --untracked-files=all`.
  - For working-tree review, also inspect both `git diff --shortstat --cached` and `git diff --shortstat`.
  - For base-branch review, use `git diff --shortstat <base>...HEAD`.
  - Treat untracked files or directories as reviewable work for auto or working-tree review even when `git diff --shortstat` is empty.
  - Only conclude there is nothing to review when the relevant scope is actually empty.
  - If any `git diff` probe exits nonzero (shallow clone, non-existent `--base` ref, detached HEAD, repository error), do NOT classify the diff as empty or tiny. Treat the size as unclear and recommend background. Surface the error message to the user so they can correct the invocation if needed.
  - Recommend waiting only when the scoped review is clearly tiny, roughly 1-2 files total and no sign of a broader directory-sized change.
  - In every other case, including unclear size, recommend background.
  - When in doubt, run the review instead of declaring that there is nothing to review.
- Then use `AskUserQuestion` exactly once with two options, putting the recommended option first and suffixing its label with `(Recommended)`:
  - `Wait for results`
  - `Run in background`

Argument handling:
- Preserve the user's arguments exactly.
- Do not weaken the adversarial framing or rewrite the user's focus text.
- The companion script parses `--wait` and `--background` as accepted no-op flags (so they don't pollute focus text), but Claude Code's `Bash(..., run_in_background: true)` is what actually detaches the run.
- `/glm:adversarial-review` uses the same review target selection as `/glm:review`. It supports working-tree review, branch review, and `--base <ref>`. Unlike `/glm:review`, it can still take extra focus text after the flags.

## Foreground flow

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" adversarial-review "$ARGUMENTS"
```

Return the command stdout verbatim. Do not weaken the adversarial framing
or rewrite the user's focus text. Do not fix any issues mentioned.

## Background flow

Launch the review with `Bash` in the background:

```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" adversarial-review "$ARGUMENTS"`,
  description: "GLM adversarial review",
  run_in_background: true
})
```

- Do not call `BashOutput` or wait for completion in this turn.
- After launching the command, tell the user: "GLM adversarial review started in the background. Check `/glm:status` for progress, `/glm:result <id>` to replay when done."

## Scope flags (parsed by companion)

- `--base <ref>` — base branch for branch-scope review.
- `--scope auto|working-tree|branch` — review scope (default: `auto`).
- `--model <model>` — override GLM model. Text models only — vision
  models are rejected. Consider `--model glm-5.1` for the strongest
  adversarial pass.
- `--thinking on|off` — toggle GLM reasoning mode (default `on` across
  all commands; adversarial review benefits most from reasoning.
  Mirrors codex CLI default `model_reasoning_effort = "medium"` on
  `gpt-5.4`). Use `--thinking off` only if the latency / token cost is
  prohibitive. BigModel API only exposes binary enabled/disabled.
- `--temperature <0-2>` / `--top-p <0-1>` / `--seed <int>` — sampling
  parameters. Same semantics as `/glm:review`. For adversarial review
  specifically, lower temperature can reduce fabricated citations
  (a known GLM-5.1 failure mode on large diffs — see Gitea issue #7).
  Plugin currently ships no opinionated default; `/glm:adversarial-review`
  uses BigModel's server-side default unless overridden.
- `--wait` / `--background` — execution mode bypass. See "Execution mode rules" above.
- Trailing tokens after flags are treated as free-form focus text.
