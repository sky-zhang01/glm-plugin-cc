---
description: Mark a recorded GLM job as cancelled (bookkeeping only — GLM requests are stateless HTTP and cannot be interrupted server-side)
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" cancel "$ARGUMENTS"`

GLM is stateless HTTP — this command only marks the local job record as
cancelled for bookkeeping / status display. No request is aborted on the
Z.AI side.
