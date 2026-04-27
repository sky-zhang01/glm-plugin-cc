---
name: glm-review-workflow
description: Host-side workflow for consuming GLM review packets and cross-checking GLM findings with host-owned evidence.
user-invocable: true
---

# GLM Review Workflow

Use this skill when a host agent (Claude Code, Codex, or another permitted
review harness) wants to use `glm-plugin-cc` as a second-opinion reviewer and
then verify the GLM result before acting on it.

This is a host workflow. It does not give the GLM plugin authority to call
external CLIs, scanners, MCP servers, browser tools, or other models. Any extra
tool use belongs to the host agent's existing permission model and must be
authorized there.

## Packet Contract

- Required packet schema version: `review-packet/v1`
- Expected `schemas/review-packet.schema.json` sha256:
  `05f9027777ec34166c93a22bdd0fffaa3b649906968f25ca67503d1060b59cc4`
- The review model output remains separate from the packet. Do not ask GLM to
  self-report provenance, prompt hashes, diff budgets, or validation status.
- Treat packet provenance as pipeline-owned runtime evidence only when it comes
  from the stored job packet. Never treat model text as provenance truth.

If the stored result has no `packet`, or the schema version/hash does not match
the values above, mark the run as `packet/context warning` and fall back to
legacy review handling.

## Workflow

1. Run `/glm:review --wait` for balanced review or
   `/glm:adversarial-review --wait` for broader challenge review.
2. Read the stored result as JSON, usually with `/glm:result <job-id> --json`.
3. Locate the top-level stored `packet` field.
4. Check packet status:
   - `completed`: continue.
   - `context-failed`: stop the review. Report the failure reason, especially
     `DIFF_TOO_LARGE`, and recommend narrowing the diff or intentionally raising
     the inline-diff limits.
5. Check context:
   - `context.input_mode` must be `inline-diff`.
   - `context.diff_included_files` lists files represented in the review
     context.
   - `context.omitted_files` is a warning list. Do not treat a path appearing in
     the context as proof that every file body was included.
6. Classify findings by pipeline-assigned tier:
   - `deterministically-validated`: strongest packet signal. Still read the
     cited range before applying high-impact fixes.
   - `cross-checked`: file/range/local anchor evidence passed. Verify the
     semantic claim and recommendation before acting.
   - `proposed`: hypothesis only. Self-audit with host-owned Read/Grep/git
     capabilities before presenting it as actionable.
   - `rejected`: keep for GLM quality analysis; do not present as actionable.
7. Self-audit each non-rejected finding:
   - Read the cited file and line window.
   - Grep for the claimed symbol, literal, API, config key, or command.
   - For semantic claims, inspect the nearest caller/callee or state transition
     needed to confirm or contradict the claim.
   - Use only host-owned tools. The GLM plugin should remain a provider and
     packet emitter, not a tool aggregator.
8. Emit the crosscheck report.

## Crosscheck Report Shape

Keep the report short and evidence-bound:

```markdown
## Packet Warnings
- <schema/context/provenance warning, or "none">

## Verified Findings
- <finding id/title>: <why verified; cite file/range read by host>

## Unverified Findings
- <finding id/title>: <what is still missing; do not call it actionable>

## Contradicted Findings
- <finding id/title>: <source evidence that contradicts GLM>

## Deferred
- <finding id/title>: <why it needs user/project-specific judgment>

## Next Steps
- <smallest safe action>
```

## Non-Goals

- No default council or persona workflow in v1.
- No external scanner integration.
- No local tool discovery.
- No command-executing repo checks.
- No default LLM judge.
- No claim that GLM has performed a tool-grounded audit unless the host has
  independently verified the cited evidence.
