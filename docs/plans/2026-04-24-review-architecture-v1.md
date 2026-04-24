# Review Architecture v1 (2026-04-24)

```
Status: DRAFT
Approval: DESIGN_OK (reviewed by Claude, 2026-04-24)
Scope: design only, no implementation in this document
Depends on:
  - docs/plans/2026-04-24-review-design-external-baseline.md
  - docs/plans/2026-04-22-review-fabrication-root-cause-design.md
Issue: #12
```

## 1. Product Boundary

glm-plugin-cc should provide two review surfaces:

- `/glm:review`: a balanced, evidence-oriented code reviewer
- `/glm:adversarial-review`: a bounded challenge reviewer that tries to break
  confidence in the chosen approach

This product is **not** intended to become:

- a general security platform
- a pentesting framework
- an autonomous exploit agent
- an auto-fix system

The design center is still code review.
The question is how to make review findings more trustworthy, more useful, and
more mode-specific without silently expanding scope.

## 2. Problem Statement

### 2.1 The main trust problem is content-faithfulness

The current system is no longer blocked only by parsing failures.
v0.4.7 materially improved transport and parse-layer reliability, but the
central unresolved problem is still whether a finding is **about the actual
change** instead of a plausible-sounding fabrication.

This matters more than raw JSON validity.

### 2.2 The two current review modes are too close together

Today, `/glm:review` and `/glm:adversarial-review` mostly differ by prompt
stance. That is useful, but too shallow.

The intended product split is deeper:

- one mode should optimize for balanced review with low noise
- one mode should optimize for bounded challenge and failure-mode pressure

### 2.3 Large-diff behavior is architecturally constrained

The current GLM path is still a remote request/response path.
It does not give the remote model a live local tool runtime.

Therefore, the right mental model for the next step is **multi-pass
orchestrated review**, not "the model now has a tool loop."

### 2.4 `/glm:review` still lacks direct measurement

The 457-run v0.4.7 harness was on `/glm:adversarial-review`, not on
`/glm:review`.
This means we should avoid pretending the two modes have equal empirical
support.

## 3. Design Goals

1. Increase trust in findings without pretending v1 solves semantic-faithfulness
   completely.
2. Make `/glm:review` and `/glm:adversarial-review` meaningfully different.
3. Keep the command surface review-focused and bounded.
4. Improve machine-readability without making human review output painful to
   consume.
5. Preserve a path for later security-specific workflows without silently
   folding them into adversarial review.

## 4. Consumer Profiles

The design should explicitly support different consumers instead of forcing one
compromise output on everyone.

### 4.1 `/glm:review` consumers

Primary:

- human reviewer skimming a branch or working-tree review
- CI or advisory workflow that wants concise, stable machine-readable output

Secondary:

- another agent or orchestration layer that wants structured findings to consume

### 4.2 `/glm:adversarial-review` consumers

Primary:

- human design reviewer
- release reviewer
- author asking "why should this not ship yet?"

Secondary:

- agentic workflow that wants a bounded challenge pass before ship/release

### 4.3 Output implication

The core schema should stay shared.
Verbosity and rendering should vary by mode and renderer, not by inventing
entirely different result formats per consumer.

## 5. Mode Split

## 5.1 `/glm:review`

### Mission

Provide a balanced, high-signal, evidence-oriented review of the target change.

### What it should optimize for

- low noise
- strong grounding
- practical bug/regression detection
- missing-test and contract-breakage detection
- stable output for repeated use

### What it should not optimize for

- generalized skepticism for its own sake
- maximal breadth of challenge surfaces
- speculative risk surfacing without support

### Expected posture

- saying "no clear issues found" is a valid successful outcome
- empty findings are acceptable
- it should prefer omission over weak or speculative findings

### Review AC matrix

| Dimension | `/glm:review` target |
|---|---|
| Grounding | Every finding binds to real file/line evidence |
| Noise | Avoid weak comments on trivial or ambiguous changes |
| Materiality | Prefer one strong finding over many weak ones |
| Tests | Call out clear missing-test gaps when behavior changed |
| Output | Stable shared schema plus concise balanced summary |
| Confidence | Findings expose confidence tier and validation signals |

## 5.2 `/glm:adversarial-review`

### Mission

Challenge whether the current approach should ship, while staying inside an
explicitly declared challenge surface.

### What it should optimize for

- failure-path pressure testing
- assumption challenge
- rollback / retry / ordering / stale-state pressure
- trust-boundary and operability challenge when declared

### What it should not optimize for

- unconstrained pentest behavior
- becoming a general security scanner
- vague negativity with no concrete failure scenario

### Expected posture

- default to skepticism
- report only material findings
- if no substantive challenge survives grounding, it may return no findings, but
  the summary should remain challenge-framed rather than LGTM-framed

### Challenge surface declaration

Adversarial review should support explicit challenge-surface tags before it
supports "packs".

Initial examples:

- `correctness`
- `resilience`
- `security`
- `compatibility`
- `operability`

These are **surface tags**, not yet full architecture-level packs.

### Adversarial AC matrix

| Dimension | `/glm:adversarial-review` target |
|---|---|
| Scope clarity | Active challenge surface is explicit |
| Failure coverage | Goes beyond happy-path logic review |
| Boundedness | Does not silently become a security platform |
| Report value | Says what breaks, why, when, and what reduces risk |
| Evidence transparency | Distinguishes inference from stronger validation |
| Escalation | Says when deeper security validation is required |

## 5.3 Shared result model

Both review modes should share:

- target selection semantics
- the core finding schema
- confidence tiers
- validation signal structure
- machine-readable output contract

Mode-specific behavior should primarily influence:

- stance
- summary framing
- what gets surfaced aggressively vs conservatively
- renderer defaults

## 5.4 Per-mode default render policy

The stored result object should preserve the full machine-readable review record.
Mode-specific differentiation should happen primarily at the renderer/default
filter layer.

Recommended v1 defaults:

### `/glm:review`

- default minimum tier: `cross-checked`
- default minimum severity: `medium`
- default visible finding cap: `5`
- if more than `5` findings survive the default filter, render the top `5` and
  show an `N more hidden` indicator
- `rejected` findings are hidden by default in human-facing output, but remain
  present in stored job JSON for audit/eval use

### `/glm:adversarial-review`

- default minimum tier: `proposed`
- default minimum severity: `low`
- default visible finding cap: `15`
- if more than `15` findings survive the default filter, render the top `15`
  and show an `N more hidden` indicator
- should prefer to include challenge-surface pressure findings when they exist
- `rejected` findings are hidden by default in human-facing output, but remain
  present in stored job JSON for audit/eval use

This is still a **configuration-level differentiation** in v1.
Architecture-level differentiation should only be claimed once a later stage
introduces materially different challenge-surface collection, validation, or
report structure.

## 6. Finding Schema and Evidence Model

The finding model should become more explicit about what has and has not been
verified.

## 6.1 Shared finding shape

Minimum shared shape:

```json
{
  "severity": "high",
  "title": "Retry path is not idempotent",
  "body": "A second delivery attempt can duplicate writes when the first attempt succeeds after timeout.",
  "file": "src/retry.ts",
  "line_start": 42,
  "line_end": 57,
  "confidence_score": 0.78,
  "confidence_tier": "cross-checked",
  "validation_signals": [
    {
      "kind": "file_in_target",
      "result": "pass",
      "artifact": "src/retry.ts"
    }
  ],
  "recommendation": "Guard the write behind an idempotency key or move the side effect after the durable acknowledgement."
}
```

Notes:

- severity should use a shared enum such as:
  `critical | high | medium | low | info`
- `confidence_score` is still model- or pipeline-produced scalar confidence
- `confidence_tier` is the higher-signal state machine for humans and tooling
- `validation_signals` makes the evidence audit trail inspectable
- `confidence_score` and `confidence_tier` are **orthogonal**:
  - `confidence_score` is the model- or rerank-produced scalar
  - `confidence_tier` is the pipeline-assigned evidence state
- if a rerank or verifier pass changes the final score, the initial score should
  be preserved in `validation_signals`

## 6.2 Confidence tiers

Use four tiers in v1:

- `proposed`
- `cross-checked`
- `deterministically-validated`
- `rejected`

### `proposed`

Raw model output.
No structural validator has confirmed the claim yet.

### `cross-checked`

Structural checks passed.
Examples:

- file exists in target set
- line range is sane
- quoted or anchor token exists
- referenced path or symbol can be structurally grounded

This is **not** a semantic guarantee.

### `deterministically-validated`

A stronger local signal exists.
Examples:

- test failure tied to the claim
- deterministic grep rule pass/fail
- reproducible command output
- explicit repo-owned check result

This still may not fully prove semantic correctness, but it is materially
stronger than structural confirmation.

### `rejected`

The finding failed a validation gate strongly enough that it should not be shown
as a live candidate finding.

Examples:

- referenced file is not in target scope
- line range is impossible for the referenced file
- quoted or anchor evidence is missing
- a repo-owned hard check explicitly invalidates the claim

`rejected` findings should remain available in stored results for audit and
evaluation purposes, but should be hidden by default in human-facing output.

## 6.3 Validation signals

Each signal should be auditable and typed:

```json
{
  "kind": "line_range_in_file",
  "result": "pass",
  "artifact": "src/retry.ts:42-57"
}
```

Recommended initial signal kinds:

- `initial_confidence_score`
- `file_in_target`
- `line_range_in_file`
- `anchor_literal_found`
- `known_false_reference_absent`
- `repo_check`
- `test_result`
- `command_result`

## 7. Validation Architecture

## 7.1 Decision

For v1, validation should live in `glm-companion.mjs`.

This is the primary architecture decision for the next phase.

### Why this is the default

- best fit with current background job/status/result model
- easiest place to unit test with fixtures
- keeps `commands/*.md` thin
- keeps parsed output and validation state close together
- avoids fragmenting review semantics across multiple command surfaces

### Why not `commands/*.md`

- poor testability
- easy drift between prompt text and real runtime logic
- too tempting to turn command markdown into business logic

### Why not `/glm:grounded-review` first

- preserves weak defaults in the main review modes
- forks the product surface too early
- delays shared evidence-model improvement

## 7.1.1 Placement inside the companion

Within the companion, validation should not be embedded as ad hoc prompt logic
or transport glue.

Recommended split:

- `scripts/glm-companion.mjs`
  - owns orchestration
  - decides which passes run
  - stores pass status in job records
- `scripts/lib/glm-client.mjs`
  - remains transport- and parse-layer oriented
  - should not become the home for business-level validation policy
- `scripts/lib/validators/*.mjs`
  - pure validation library
  - deterministic checks only
  - independently unit-testable
  - reusable for revalidation of stored raw review output

The important future-proofing point is that stored job output should be
re-checkable without sending another remote review request.
That is easiest if validators are pure library functions invoked by
`runReview`-level orchestration rather than being buried in transport code.

## 7.2 Pipeline shape

v1 should be designed as **multi-pass orchestrated review**:

1. collect target and context
2. model pass produces raw findings
3. local structural validation runs in companion
4. optional rerank / verifier pass runs
5. confidence tier is assigned
6. result is rendered and stored

This is intentionally not described as a model-side tool loop.

## 7.2.1 Per-pass failure and persistence policy

| Pass | Expected outcome | Partial-failure policy | Persistence impact |
|---|---|---|---|
| Context collection | target + review context ready | fail whole job if target/context cannot be built | persist job failure with no review result |
| Model review pass | raw structured findings or empty findings | fail whole job if no parseable review result exists | persist transport/parse failure details |
| Structural validation pass | findings are tiered or rejected | do **not** fail whole job because one finding fails validation; downgrade or reject affected findings | persist raw findings, validation signals, and final tiers |
| Optional rerank / verifier pass | score/tier adjustment or no-op | if pass errors, keep pre-rerank validated result and mark rerank as skipped/failed | persist both pre-rerank and final scoring metadata where applicable |
| Render/store pass | user-facing output + job JSON written | fail job only if storage/rendering itself fails | persist pass-level status when possible before render failure |

The design intent is:

- transport failure is a job failure
- finding-level validation failure is **not** a job failure
- optional pass failure should degrade gracefully to the strongest earlier
  stable result

Note:

- during `S0`-only deployments before `S2` lands, the structural validation
  pass may be skipped entirely; in that phase, findings remain `proposed`
  unless another explicit pass upgrades them

## 7.3 Structural validation in v1

Initial structural validators should stay narrow and deterministic:

1. `file_in_target`
   - finding file must exist in the target review set
2. `line_range_in_file`
   - line range must be sane for the referenced file
3. `anchor_literal_found`
   - if the model provides quoted or anchor evidence, it must exist
4. `known_false_reference_absent`
   - known fabricated cross-project references must not be accepted silently

These four validators are the initial v1 subset of the broader signal kinds
listed in §6.3.

These validators are enough for v1 structural trust lift.
They are not a semantic proof system.

## 7.4 Optional second-pass mechanisms

v1 design should leave room for two optional pass types:

### Reflection / rerank pass

Use a second model pass to score, rerank, or drop weak findings from the first
pass.

This is the cheapest candidate for early noise reduction.

### Cross-model narrow verifier

Use a second model or model family for a narrow verification task such as:

- is this claim actually anchored in the file?
- is this line-range explanation consistent with the visible code?

This is still weaker than deterministic proof, but stronger than same-pass
self-confidence.

## 7.5 Repo-owned checks v0.1

Repo-owned checks are worth supporting, but only with a tightly constrained
shape.

### Goals

- let a repo declare a small set of hard checks
- avoid inventing a large free-form DSL
- keep checks machine-testable and auditable

### v0.1 allowed check kinds

Only two check kinds:

- `grep-exists`
- `grep-notpresent`

`test-passes` is explicitly deferred to v0.2 or later.
It introduces command execution, sandboxing, environment, and policy questions
that are too broad for the first repo-owned checks cut.

### v0.1 shape

Use a hard-schema config format under `.glm/checks/`.
No free-form markdown logic as the executable contract.

Example:

```yaml
kind: grep-notpresent
id: no-workflow-governor-leak
path_globs:
  - "src/**/*.ts"
pattern: "workflow_governor"
message: "Review findings must not reference unrelated cross-project paths."
```

### Output/result shape

Config schema alone is not enough; repo check results also need a stable
machine-readable output shape.

Example:

```json
{
  "id": "no-workflow-governor-leak",
  "kind": "grep-notpresent",
  "result": "fail",
  "violations": [
    {
      "file": "src/review.ts",
      "line": 81,
      "match": "workflow_governor"
    }
  ]
}
```

### Merge strategy

Do not merge repo checks into the same ranking pool as model findings in v0.1.

Instead:

- keep built-in findings in `findings`
- keep repo check results in a separate `repo_checks` section
- let renderers or gates decide later how to combine them

This avoids premature coupling between policy failures and review findings.

### Governance deferments

The following are intentionally deferred to v0.2 or later:

- who may author or approve repo-owned checks
- duplicate check id conflict policy
- whether repo checks can override built-in behavior
- any command-executing check kind such as `test-passes`

## 8. Explicit Non-Goals

The following are out of scope for v1:

1. auto-fix behavior
2. a claim of full semantic-faithfulness guarantee
3. a generalized security platform surface
4. arbitrary repo-policy DSLs
5. unconstrained challenge packs with no architectural distinction

## 9. Implementation Stages

This section defines the intended design rollout, not a promise to implement all
stages immediately.

Every stage should include command/help/docs sync before it is considered
complete.

## S0. Schema-only groundwork

Deliver:

- shared schema gains `confidence_tier`, `validation_signals`, and `rejected`
- renderers and stored-job readers can consume the new shape safely

Acceptance:

- schema shape is stable and reviewable
- no binary `validated` shortcut is introduced
- backwards-compat assumptions are documented

## S1. Reflection/rerank comparison

Deliver:

- compare "single pass" vs "reflection/rerank" as the cheapest noise-reduction
  option

Acceptance:

- experiment result is documented
- no permanent dependency on reflection is assumed before validation lands

## S2. Structural validation post-processor

Deliver:

- local companion validators for file/line/anchor/known-false checks
- findings are upgraded or downgraded by validator outcome

Acceptance:

- structural fabrication classes become visible in machine-readable signals
- invalid findings no longer appear indistinguishable from raw findings

## S3. Repo-owned checks v0.1

Deliver:

- `.glm/checks/` with two hard-coded check kinds only
- separate `repo_checks` output section

Acceptance:

- checks are schema-validated
- no free-form markdown execution contract exists
- built-in and repo checks remain separately inspectable

## S4. Cross-model quick verifier (optional)

Deliver:

- narrow verifier hook that can use a second configured model

Acceptance:

- verifier task is narrow and auditable
- result affects confidence tier or rerank, not silent overwrite

Exit criterion:

- only start S4 after S2 exists
- and only if dogfood / evaluation still shows a meaningful tail of weak
  `proposed` or `rejected` findings that S1 rerank does not materially reduce

## S5. Challenge surface graduation

Deliver:

- decide whether any declared challenge surface deserves promotion to a real
  pack

Graduation rule:

A challenge surface becomes a real pack only if it implies at least one of:

1. distinct context collection behavior
2. distinct deterministic validation hooks
3. distinct severity scale or report section

If none of these apply, it stays a tag/focus declaration.

## S-docs. Command/help/docs sync

Deliver:

- update `commands/review.md`
- update `commands/adversarial-review.md`
- update any help text or README sections that explain visible review behavior

Acceptance:

- user-facing docs match the actual confidence-tier and filtering behavior
- review mode differentiation is visible in help text, not only in design docs

## 10. Open Questions

1. Should `/glm:review` eventually expose separate renderer profiles for
   `human`, `ci`, and `agent`, or should one renderer adapt automatically from a
   single shared result object?
2. What is the minimum deterministic evidence set required before a finding
   should be allowed to graduate from `proposed` to `cross-checked`?
3. Should repo-owned checks live under `.glm/checks/` or another repo-owned
   path?
4. What exact signals should be surfaced in CLI output vs stored job JSON?
5. At what point does a challenge-surface tag deserve promotion to a real pack?
6. What blind spot did reviewers notice that was not anticipated by this
   checklist?

## 11. Review Checklist For This Doc

When this design is reviewed, the reviewer should explicitly challenge:

1. whether `glm-companion.mjs` is the right home for validation
2. whether the four confidence tiers are enough
3. whether repo-owned checks v0.1 is too narrow or still too broad
4. whether `/glm:review` and `/glm:adversarial-review` are now meaningfully
   distinct
5. whether any of the proposed stages would silently blur product boundary
6. any other blind spot or concern that does not fit this checklist but still
   affects review architecture quality

## 12. Summary

The architecture choice for v1 is:

- keep two review modes
- make them genuinely different
- put validation in the companion
- use confidence tiers instead of fake certainty
- treat repo-owned checks as a narrow adjunct, not a free-form policy engine
- keep adversarial review bounded unless data later justifies a deeper split

That gives glm-plugin-cc a realistic path from "structured review prompt" toward
"review product with inspectable evidence" without pretending it is already a
full security platform or a fully grounded semantic verifier.
