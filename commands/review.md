---
description: Run a GLM code review against local git state
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--thinking on|off] [--temperature <0-2>] [--top-p <0-1>] [--seed <int>]'
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
  server-side default. Per the v0.4.7 457-run sweep across small /
  medium / large fixtures (see "Diff size guidance" below), **the
  plugin intentionally ships no opinionated defaults**: at effective
  N=81-84 per cell on the large-diff fixture, no pairwise Fisher
  exact contrast between `temp=0`, `0.5`, and `1.0` reached
  significance (p = 0.5348 / 0.7466 / 0.7812) and observed rates
  flattened to 95.1% / 91.6% / 92.9%. At this sample size the test
  has ~80% power to detect a ~15pct per-step effect and ~95% power
  for ~20pct under that assumed alternative, but the supported release
  claim is narrower: no temperature effect was detected in this sweep,
  so the evidence cannot support a default. `--seed <int>` plus an
  explicit `--temperature` makes runs approximately reproducible and
  is useful for A/B probing.
- `--wait` / `--background` — execution mode bypass. See "Execution mode rules" above.
- Trailing tokens after flags are treated as free-form focus text.

## Diff size guidance

Empirical observations from the v0.4.7 evaluation harness
(`test-automation/review-eval/`, 457 runs across three curated
fixtures with full sidecar capture). These describe GLM-5.1 with
`--thinking on`; they are not contracts — re-run the harness if you
want to verify the model hasn't drifted:

| diff size | example | files / lines | schema pass (effective N) | citation notes | typical latency |
|---|---|---|---|---|---|
| **Small** (<500 lines) | C1-v044-setup-menu | 6 / 440 | **100% (N=42-44 per temp)** | Harness `citation_accuracy` 0.68-0.82. `0/227 findings cite out-of-diff or cross-project files`; the 31.7% scoring mismatches are driven by "diff-meta" findings (commit-message / CHANGELOG-entry / scope-rename critique) where bodies use review meta-language not present as literal tokens in the cited file (scoring-rubric limitation). **Caveat**: the harness can't detect line-level content fabrication within an allowed file — at least one run confabulated a fictional `@anthropics → @anthropic-ai` rename. This is the "correctness without faithfulness" failure mode (Wallat 2024); v0.4.8 Tier 1 deterministic claim verifier is the planned mitigation. If you're using `/glm:review` for small diffs, sanity-check the findings' quoted claims against the diff. | 10-60s |
| **Medium** (~1500 lines) | C2-v046-aftercare | 11 / 1550 | 95% (40/42 effective across the full temp×seed matrix) | `citation_accuracy` 0.85-1.00 across all cells. Schema and citation both robust. | 30-90s |
| **Large** (8000+ lines) | C3-v04x-cumulative | 84 / 8336 | **~92-95% across `temp∈{0,0.5,1}` (N=81-84 per cell)**, Fisher exact p > 0.5 for every pair (0.5348 / 0.7466 / 0.7812) | `citation_accuracy` 0.83-0.92. **0/457 runs cited `known_false_files`** — the 2026-04-21 cross-project hallucination pattern did not reproduce. Parse-layer defenses recover most of the 5-8% schema failures via typed correction-retry. | 60s-3min |

Practical notes:

- **JSON mode is enforced at the API level in v0.4.7**: the plugin
  sends `response_format: { type: "json_object" }` on every review
  call so BigModel's structured-output path is taken.
  Parse-layer defenses (`stripMarkdownFences`, `classifyParseFailure`,
  correction-retry) remain active as fallback. Scoring-rubric
  limitation: the harness verifies cited file + token presence near
  line range, **not** the truthfulness of content claims in
  `finding.body`. Spot-check quoted claims on small diffs; see
  `docs/anti-hallucination-roadmap.md` for the v0.4.8 verifier plan.
- **Background (`--background`) is strongly preferred for anything
  above "small"** — large-diff runs routinely take 1-3 minutes and the
  Claude Code session stays interactive.
- **No single temperature setting dominated** across all three fixture
  sizes. If you have a reason to pick one (e.g. you want run-to-run
  reproducibility for a comparison), `--temperature 0 --seed <int>`
  is sensible, but do not expect it to systematically improve schema
  or citation quality.
- **Upstream (BigModel-side) errors** appeared in 8.3% of the 457
  sweep runs and were time-correlated, not cell-correlated. v0.4.7's
  expanded error dispatch (see `scripts/lib/bigmodel-errors.mjs`)
  covers all codes observed. If your single invocation hits one,
  rerun — it is almost certainly transient.
