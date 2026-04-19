---
description: Run a free-form GLM task (stateless OpenAI-compatible HTTP call). Thinking defaults OFF; add --thinking on when reasoning matters.
argument-hint: "[--system <prompt>] [--model <model>] [--thinking on|off] [prompt text]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" task "$ARGUMENTS"`
