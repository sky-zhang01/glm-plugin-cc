---
description: Delegate investigation, fix, or rescue work to the GLM rescue subagent
argument-hint: "[--model <model>] [--system <system-prompt>] [--thinking on|off] [what GLM should investigate, solve, or continue]"
context: fork
allowed-tools: Bash(node:*), AskUserQuestion
---

Route this request to the `glm:glm-rescue` subagent.
The final user-visible response must be the GLM companion stdout verbatim.

Raw user request:
$ARGUMENTS

Operating rules:

- GLM is stateless HTTP — there is no resume / fresh thread distinction.
  Every rescue call is independent.
- The subagent is a thin forwarder only. It should use one `Bash` call to
  invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/glm-companion.mjs" rescue ...`
  and return that command's stdout as-is.
- Return the GLM companion stdout verbatim to the user. Do not paraphrase,
  summarize, rewrite, or add commentary.
- `--model` selects the GLM model (default `glm-4.6`; also accepts
  `glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-4.7`, `glm-4.5`, etc. Check the
  智谱 BigModel text-model catalog — vision models are rejected).
- `--thinking on|off` toggles GLM reasoning mode (default `off`). Turn
  on only if the task genuinely needs extended reasoning.
- `--system` overrides the default rescue system prompt.
- Do not ask the subagent to inspect files, monitor progress, or poll
  status/result; that's the user's next step if needed.
- If `/glm:setup` reports GLM unavailable, stop and tell the user to set
  `ZAI_API_KEY`.
- If the user did not supply a request, ask what GLM should investigate
  or fix.
