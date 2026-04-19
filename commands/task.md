---
description: Run a free-form GLM task (stateless HTTP call to Z.AI)
argument-hint: "[--system <prompt>] [--model <model>] [prompt text]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" task "$ARGUMENTS"`
