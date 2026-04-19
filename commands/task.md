---
description: Run a free-form GLM task (stateless OpenAI-compatible HTTP call). Thinking defaults ON (mirrors codex medium reasoning); pass --thinking off for lighter calls.
argument-hint: "[--system <prompt>] [--model <model>] [--thinking on|off] [prompt text]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" task "$ARGUMENTS"`
