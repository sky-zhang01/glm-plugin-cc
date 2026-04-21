# Anti-Hallucination Roadmap

## Problem framing

In the v0.4.7 149-run expanded sweep we confirmed a failure pattern on
small-diff reviews that the existing parse-layer defenses do not catch:
the model cites an allowed file in the diff, the citation passes our
token-in-window scoring, but the **content claim inside `finding.body`
is completely fabricated**.

Concrete example (C1-v044-setup-menu, temp=0.5, run 4):

- `finding.file` = `package.json` ✓ (file is in `allowed_files`)
- `finding.body` claims "the package name changed from
  `@anthropics/claude-code` to `@anthropic-ai/claude-code`"
- **Actual** C1 v0.4.4 rename: `@skylab/glm-plugin-cc` →
  `glm-plugin-cc`

The file picker is right. The content claim is invented from nothing.
The literature term for this (Wallat et al., "Correctness is not
Faithfulness in RAG Attributions", arXiv 2412.18004, 2024) is
**correctness without faithfulness**: an attribution points to the
right source but the attributed content is not supported by it.

Community consensus on mitigation: **external grounding + claim-level
verification + abstention on unverifiable claims**. Not "more JSON",
not "more samples".

## Ships in v0.4.7

**Tier 1 #3 only** — `response_format: { type: "json_object" }` on
every `expectJson: true` call. BigModel GLM-5.x supports this on the
OpenAI-compatible endpoint (confirmed 2026-04 via `docs.z.ai`, not
`json_schema` — only `text` and `json_object`). The v0.4.6/7 client
was relying on prompt-only JSON instructions and no response_format
header, which is a defensible default on most OpenAI-compatible
models but leaves the parser more exposed.

Expected impact: reduce MARKDOWN_FENCE_UNTERMINATED /
TRUNCATED_JSON / REASONING_LEAK parse failures (observed at ~1.3%
combined rate in the 149-run sweep). Does **not** change
content-fabrication behavior — that is strictly a parser-hardening
step.

The `buildChatRequestBody` function was extracted from the
`runChatRequest` body to make this testable (`tests/chat-request-body.test.mjs`
covers response_format + sampling-parameter forwarding + thinking-
mode toggle). 14 new unit tests.

## Deferred to v0.4.8 — content-level verifier

**Tier 1 #1 — Deterministic claim verifier (fail-closed).**

For specific high-risk claim classes the model emits — renames,
version bumps, imports, env vars, package scope changes, path moves
— a local verifier greps the diff text for the asserted before/after
values. If neither appears in the touched diff, the finding is either
dropped or re-emitted with `confidence: low` and an explicit
`unverified_claim` flag.

Scope:

- Pure JS post-parse hook in `glm-client.mjs`, executes between
  `classifyReviewPayload` and result return
- Reads `options.reviewInput.diff` (the diff already given to the
  model) — no additional file system access required
- Claim-type heuristics driven by regex over `finding.body`:
  - `rename X → Y` / `renamed from X to Y` / `package scope changed`
  - `version A.B.C → X.Y.Z`
  - `import/path changes`
  - `added env var FOO` / `deprecated setting BAR`
- For each detected claim, check whether both values appear in the
  diff (or the value is deletion/addition and matches a diff hunk)
- If the verifier can't validate: attach a `verification_note` to the
  finding. Consumers (Claude Code, human reviewer) see which findings
  were verified vs unverified.

Why not in v0.4.7: this changes production review output behavior
(adding a `verification_note` field, possibly demoting confidence).
That needs a schema decision, prompt adjustment (tell the model what
happens when claims aren't verifiable so it doesn't over-specify),
and a proper design-gate review. Rushing it into the v0.4.7 tail
without those steps risks shipping a regression that's hard to debug.

**Tier 1 #2 — Typed claim anchors in the output schema.**

Extend `prompts/output-schema.json` findings schema with optional
fields:

```
{
  "claim_type": "rename" | "version" | "import" | "env_var" | "value_change" | "structural",
  "old_value": string?,   // only when claim_type implies a diff
  "new_value": string?,
  "evidence_span": { "start_line": int, "end_line": int }?
}
```

These make the claim parseable (currently we parse from free-form
`body`) and therefore reliably verifiable. Combined with #1 above,
this is the strongest impact-per-LOC mitigation.

Risk: schema migration. Need to keep the fields OPTIONAL so older
GLM responses don't fail validation; need to update the prompt so
the model knows to populate them; need to update eval scoring
(`scoreCitation`) to use them when present.

## Deferred to v0.5+ — architecture changes

- **Tool-grounded reviewer** (Open Hands / Continue / Aider pattern):
  reviewer model calls `read_file` / `grep` before citing content.
  Major rewrite. GLM-5.1 function-calling support on BigModel not yet
  verified.
- **RAG + attribution-faithfulness scorer**: repo index + a separate
  judge model call to verify each finding against retrieved content.
  Large latency and token cost; would more than double per-review
  runtime.
- **SelfCheckGPT / semantic entropy**: multi-sample consistency check
  (Manakul et al., EMNLP 2023; Farquhar et al., Nature 2024). For
  code review with deterministic wrong beliefs — model fabricating a
  specific false package name — N=3 sampling + majority vote does
  not help because all samples share the same wrong belief. Defer.

## What we explicitly rejected

- **`response_format: { type: "json_schema" }`** — not supported by
  GLM-5.x per BigModel/Z.AI documentation (only `text` and
  `json_object`).
- **Default N=3-5 self-consistency for whole reviews** — at 30-180s
  per GLM call, this is a 3-5x cost lever with no reliable gain on
  the observed failure class.
- **Grammar-constrained decoding (Outlines / Guidance / LMQL)** —
  client-side retrofit impossible on remote BigModel HTTP; would
  need a local model. Also only constrains shape, not content.
- **Guardrails.ai / NeMo Guardrails / Pydantic AI as-is** — they are
  primarily output-format validators and policy filters, not
  content-claim verifiers for domain-specific fabrication. NeMo's
  fact-checking module and Promptfoo's factuality rubric are closer
  but need a judge model + ground-truth document to compare against,
  which we don't have at review time.

## References

Papers cited in Codex's v0.4.7 research pass:

- Dhuliawala et al., "Chain-of-Verification Reduces Hallucination in
  Large Language Models", arXiv 2309.11495, 2023.
- Wang et al., "Self-Consistency Improves Chain of Thought
  Reasoning", ICLR 2023.
- Aggarwal et al., "Let's Sample Step by Step: Adaptive-Consistency",
  EMNLP 2023.
- Manakul et al., "SelfCheckGPT: Zero-Resource Black-Box
  Hallucination Detection", EMNLP 2023.
- Farquhar et al., "Detecting hallucinations via semantic entropy",
  Nature 2024.
- Rashkin et al., "Measuring Attribution in NLG Models (AIS)",
  Computational Linguistics 2023.
- Wallat et al., "Correctness is not Faithfulness in RAG
  Attributions", arXiv 2412.18004, 2024. **Closest to our
  rename-fabrication pattern.**
- Wang et al., "OpenHands: An Open Platform for AI Software
  Developers", arXiv 2407.16741, 2024.

Open-source implementations surveyed:

- `langchain-chain-of-verification` (PyPI, Sep 2024).
- `potsawee/selfcheckgpt` (GitHub).
- Outlines / Guidance / LMQL / llguidance (grammar-constrained
  decoding).
- Guardrails AI / NeMo Guardrails / Pydantic AI output validators /
  Promptfoo factuality (output-format + policy validators).

## Next milestone (v0.4.8)

Targeted deliverable: claim verifier (Tier 1 #1) + schema anchors
(Tier 1 #2), with a design-gate discussion before implementation
starts. The 149 sidecar JSONs from the v0.4.7 sweep are the
regression corpus — any implementation must reduce the observed
rename-fabrication case on the C1 fixture without degrading
review quality on C2 / C3.
