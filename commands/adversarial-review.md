---
description: Run a GLM review that challenges the implementation approach and design choices
argument-hint: '[--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [focus ...]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*)
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

## Execution

GLM is stateless HTTP; all calls are synchronous foreground. No
`--wait` / `--background` flags — those do not exist in this plugin.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" adversarial-review $ARGUMENTS
```

Return the command stdout verbatim. Do not weaken the adversarial framing
or rewrite the user's focus text.

## Scope flags (parsed by companion)

- `--base <ref>` — base branch for branch-scope review.
- `--scope auto|working-tree|branch` — review scope (default: `auto`).
- `--model <model>` — override GLM model.
- Trailing tokens after flags are treated as free-form focus text.
