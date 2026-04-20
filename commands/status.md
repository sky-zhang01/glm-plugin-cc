---
description: Show recent GLM jobs recorded in this repository
argument-hint: '[job-id] [--all]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" status "$ARGUMENTS"`

GLM calls are stateless HTTP foreground — this command shows only local
job records for history / audit. There is no server-side polling.

If the user did not pass a job ID:
- Render the command output as a compact Markdown table of recent jobs.
- Preserve job id, kind, status, duration, and summary.

If the user did pass a job ID:
- Present the full command output verbatim. Do not summarize.
