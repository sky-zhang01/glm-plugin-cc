# Review Design External Baseline (2026-04-24)

This note captures the first design-phase checkpoint after re-auditing the current
`/glm:review` and `/glm:adversarial-review` implementation, revisiting existing
repo knowledge, and surveying high-signal 2000+ star open-source references.

It is intentionally scoped to product/design guidance. It is **not** a feature
commitment and does **not** imply that glm-plugin-cc should become a general
security platform.

## 1. Verified Current Local State

### 1.1 `/glm:review` still exists

`/glm:review` was not removed. It still dispatches through the shared
`runReview()` engine in `scripts/glm-companion.mjs`, just with
`{ adversarial: false }`.

### 1.2 `/glm:adversarial-review` is not a separate runtime

`/glm:adversarial-review` uses the same review engine and the same transport
layer, but swaps in an adversarial prompt and allows extra focus text.

### 1.3 Current hardening is still mostly parse-layer hardening

The current v0.4.7 work materially improved:

- `response_format: { type: "json_object" }`
- typed parse failure classification
- correction retry
- retry/backoff for upstream failures

But this still does **not** solve content-faithfulness at the claim level.
The current system is not yet a deterministic verifier of review findings.

### 1.4 Large-diff review is still architecture-limited

When review context exceeds the inline threshold, `collectReviewContext()`
falls back toward lightweight summary / self-collect guidance.
However, the remote GLM review path is still a one-shot HTTP call, not a true
tool loop with live repository inspection.

Implication: for larger diffs, the system remains more like a structured
review prompt than a grounded review agent.

## 2. Existing Repo Knowledge To Reuse

The most relevant existing design artifacts remain:

- `docs/anti-hallucination-roadmap.md`
- `docs/plans/2026-04-22-review-fabrication-root-cause-design.md`

The key carry-forward point is that the repo already recognized the main gap:
parse-layer robustness is necessary but insufficient without post-parse,
deterministic claim validation.

## 3. External References Reviewed

The following were the highest-signal external references for this phase.

### 3.1 Direct PR/code review systems

#### `The-PR-Agent/pr-agent` (10k+ stars)

Relevant patterns:

- configurable review sub-sections instead of a single flat verdict
- explicit security / ticket-compliance / review-effort outputs
- automatic labels derived from review findings
- dynamic + asymmetric context expansion
- self-reflection / reranking for generated suggestions
- online and CLI invocation surfaces

Design lesson:
review quality is treated as a pipeline problem, not only a prompt-writing
problem.

#### `coderabbitai/ai-pr-reviewer` (2k+ stars)

Relevant patterns:

- incremental review across commits
- light-model summary + heavy-model review split
- smart skip for trivial changes
- exact hunk-level line-range comments
- comment-thread interaction on review comments

Design lesson:
review cost, latency, and noise control are first-class product concerns.

#### `continuedev/continue` (30k+ stars)

Relevant patterns:

- source-controlled AI checks in `.continue/checks/*.md`
- repo-owned review policy, enforced in CI
- review logic expressed as project policy rather than only central product mode

Design lesson:
part of "review quality" may need to live in repo-owned policy modules rather
than only in the built-in reviewer.

#### `mattzcarey/shippie` (2k+ stars)

Relevant patterns:

- agentic review instead of single-pass review
- automatic ingestion of rules files (`AGENTS.md`, `CLAUDE.md`, etc.)
- structured summary plus specific review comments
- optional sub-agent spawning for scoped deep dives

Design lesson:
project rules and context files should be first-class review inputs, not
incidental prompt garnish.

### 3.2 Challenge / red-team / reporting references

#### `promptfoo/promptfoo` (20k+ stars)

Relevant patterns:

- red-team / code-scan / eval framing as separate but related surfaces
- explicit severity thresholding (for example `minimumSeverity`)
- `diffsOnly` mode for PR-oriented scanning
- vulnerability-report productization rather than raw logs only

Design lesson:
challenge systems become usable when they define a report contract, thresholds,
and clear scope boundaries.

#### `NVIDIA/garak` (7k+ stars)

Relevant patterns:

- clear split between probes, detectors, evaluators, and harnesses
- JSONL run logs + hit logs
- explicit detector metrics with precision / recall / F1 / confidence intervals

Design lesson:
if we ever add challenge packs, we should separate attack generation from
finding detection from reporting quality measurement.

#### `PurpleAILAB/Decepticon` (2.5k+ stars)

Relevant patterns:

- OPPLAN / RoE / acceptance-criteria-first workflow
- explicit engagement phases
- structured findings format
- executive summary + technical report outputs
- workspace artifact layout, not just chat output

Design lesson:
serious challenge review starts by defining scope, target, exclusions, and
acceptance criteria before "running attacks".

#### `GH05TCREW/pentestagent` (2k+ stars)

Relevant patterns:

- attack playbooks
- persistent findings/notes categories
- report generation as an explicit surface

Design lesson:
challenge breadth can be controlled through named playbooks instead of one vague
adversarial mode.

#### `Tencent/AI-Infra-Guard` (3k+ stars)

Relevant patterns:

- multi-surface AI red teaming split into independent scanners
- explicit report view with severity + remediation
- keeps multiple scan types separate instead of collapsing them into one mode

Design lesson:
scope separation is what prevents "AI security platform" sprawl from becoming
unbounded.

### 3.3 Codex-specific references

#### `openai/codex-plugin-cc`

Observed pattern:

- `/codex:review` now maps directly to the built-in reviewer via `review/start`
- `/codex:adversarial-review` is a steerable custom prompt over collected repo
  context

Design lesson:
the two modes are deliberately separated:

- one is "use the product reviewer as intended"
- one is "run a challenge review with custom focus text"

#### OpenAI public Codex docs and product pages

Publicly claimed review capabilities include:

- matching PR intent to actual diff
- reasoning over the whole codebase and dependencies
- executing code and tests to validate behavior
- automatic PR review in GitHub
- steerable review requests such as security-focused review

Codex Security publicly claims a further pipeline:

- repository threat model
- realistic attack-path exploration
- isolated validation/reproduction
- patch proposal for human review

Design lesson:
we should distinguish between:

1. what a general review mode is expected to do
2. what a security-specific deeper pipeline does

Do not overload `/glm:adversarial-review` with expectations that belong to a
separate security product surface.

## 4. Early Gap Assessment For glm-plugin-cc

### Gap A: Too close to "single prompt in, structured JSON out"

Current review still behaves too much like one structured prompt plus transport
hardening. External references repeatedly treat review as a multi-stage flow:

- target selection
- context shaping
- review generation
- reflection / validation
- report shaping

### Gap B: `/glm:review` and `/glm:adversarial-review` are not different enough

Current difference is mainly prompt stance.
That is useful, but too shallow.

External references suggest a more meaningful split:

- balanced reviewer
- challenger
- policy / repo checks
- security evaluation

### Gap C: Findings lack richer evidence structure

The current schema is enough for simple findings, but thin for a long-lived
review surface. Missing structure may include:

- evidence provenance
- validation state
- acceptance-criteria coverage
- repo policy violations
- report sections beyond a flat findings list

### Gap D: No deterministic claim verifier yet

This remains the central trust problem.
Without a claim verifier or equivalent evidence-binding mechanism, better prompt
engineering alone will not make review findings reliably trustworthy.

### Gap E: Adversarial mode is too narrow and too vague at the same time

It is narrow because it mainly pressure-tests logic / design tradeoffs.
It is vague because the attack surface is not explicitly modeled.

This makes it easy to under-challenge serious risk classes while also making it
hard to know what the mode is actually responsible for.

### Gap F: "tool loop" is the wrong mental model for the current runtime

For glm-plugin-cc, the remote GLM path is still an HTTP request/response path.
That means "tool loop" is a misleading term if it implies live model-side
`Read`/`Grep` access.

The more accurate model is a **multi-pass orchestrated review**:

1. model pass produces raw findings
2. local validator or checker layer inspects those findings
3. an optional second model pass reranks, drops, or rewrites findings using the
   validation output

This terminology matters because it points design work toward orchestration and
validation architecture rather than pretending the remote model already has a
local tool runtime.

## 5. First-Pass Design Direction

### 5.1 Reframe `/glm:review`

Goal:
high-signal, balanced, evidence-oriented code review.

Expected character:

- mostly implementation-focused
- conservative on weak claims
- good at bug / regression / missing-test / contract-breakage review
- optionally aware of repo policy modules

This mode should optimize for:

- low noise
- high grounding
- predictable output contract
- reviewability by a human maintainer

### 5.2 Reframe `/glm:adversarial-review`

Goal:
bounded challenge review that tries to break confidence in the chosen approach.

Expected character:

- challenge assumptions
- stress failure paths
- pressure-test rollback / retries / concurrency / observability / trust
  boundaries
- optionally expose explicit challenge surfaces

This should **not** implicitly become:

- full autonomous pentesting
- general vulnerability scanner
- unrestricted AI red team platform

### 5.3 Prefer challenge surface tags first, not packs by default

The first move should not be a cargo-culted "pack" system if all it really does
is switch prompts over the same diff.

A challenge surface only graduates from a tag into a real pack when it implies
at least one of:

1. distinct context collection behavior
2. distinct deterministic validation hooks
3. distinct severity scale or report section

Until that threshold is met, use explicit focus tags or challenge-surface
declarations rather than pretending there is a deeper architecture split.

### 5.4 Separate review surface from security-evaluation surface

If deeper security workflows are ever added, they should likely be their own
surface or sub-mode with their own:

- scope declaration
- target model
- validation semantics
- report contract

Do not silently bury this inside baseline `/glm:adversarial-review`.

### 5.5 Validation architecture should live in the companion, not the command file

For v1, the best default is to put validation orchestration in
`glm-companion.mjs`, not in `commands/*.md`, and not behind a new
`/glm:grounded-review` command.

Why this wins:

- it keeps the slash-command surface thin and stable
- it is easier to unit test with fixtures than command-markdown logic
- it fits the existing background job/status/result model
- structural validation is local and deterministic enough to belong near the
  parsed output and review state

Why not `commands/*.md`:

- hard to test
- easy to let business logic sprawl into command prompts
- awkward to reuse for background jobs and stored results

Why not a new `/glm:grounded-review` first:

- it would preserve weak defaults in the two main review modes
- it would fragment the evidence model before the base architecture is stable

This still uses the **multi-pass orchestrated review** mental model, not a fake
model-side tool loop.

### 5.6 Confidence must be tiered, not binary

V1 validation should not collapse into a misleading `validated` label.
The output model should distinguish at least:

- `proposed`
- `cross-checked`
- `deterministically-validated`

`proposed` means raw model output.
`cross-checked` means structural checks passed (for example file exists, line is
in range, token/path anchors are present).
`deterministically-validated` means a stronger verifier ran, such as a failing
test, a deterministic grep assertion, or a concrete local artifact proving the
claim.

This should be paired with machine-readable validation signals so the result can
be audited later.

### 5.7 Cheaper Stage-1 noise reduction should be compared honestly

Before assuming a full validation pipeline is the first answer, compare lower
cost interventions:

1. reflection / rerank pass over the model's own finding list
2. cross-model narrow verifier for "is this claim anchored in the file?"

These may remove a large fraction of weak findings before deeper validation
machinery is required.

## 6. Candidate AC Dimensions For Design Phase

These are the early dimensions that seem worth turning into explicit acceptance
criteria.

### Review AC dimensions

1. **Grounding**
   - Every finding must bind to real file/line evidence.
2. **Materiality**
   - The reviewer should prefer one strong finding over many weak ones.
3. **Noise control**
   - Trivial changes should be skippable or downweighted.
4. **Context quality**
   - Small and large diffs should have explicit, different handling semantics.
5. **Repo adaptation**
   - Repo-owned rules / checks should be ingestible without rewriting the core
     reviewer.
6. **Validation**
   - Important findings should expose whether they are prompt-only, inferred,
     or locally validated.
7. **Output contract**
   - Review output should remain stable enough for CLI rendering, audits, and
     future aggregation.
8. **Consumer fit**
   - The output shape for CI/advisory use should not be forced into the same
     verbosity profile as human deep-review output.

### Adversarial AC dimensions

1. **Challenge scope clarity**
   - The active challenge surface must be explicit.
2. **Boundedness**
   - No silent expansion into general platform security scanning.
3. **Failure-mode coverage**
   - Challenge mode should go beyond happy-path logic review.
4. **Report usefulness**
   - Findings should say what breaks, why, under what scenario, and what to do.
5. **Evidence transparency**
   - Speculation vs grounded inference must be visible.
6. **Escalation path**
   - If a concern requires deeper security validation, the output should say so
     explicitly rather than pretending it already proved it.
7. **Challenge boundedness**
   - Adversarial breadth must remain inside declared challenge surfaces and must
     not become a catch-all security platform mode.

## 7. Validation Architecture Decision Matrix

The main architecture fork for the next design note is where validation should
live.

| Option | Cost | Testability | Codex alignment | Verdict |
|---|---|---:|---|---|
| `(a)` validation in `glm-companion.mjs` | medium | high | good | **choose for v1** |
| `(b)` validation in `commands/*.md` orchestration | low-to-medium initially, high drift later | low | weak | reject |
| `(c)` new `/glm:grounded-review` command | medium | medium | medium | defer |

### 7.1 Option `(a)`: `glm-companion.mjs`

Pros:

- easiest place to test multi-pass orchestration with fixtures
- keeps command layer thin
- works with existing background/status/result job model
- keeps parsed-output handling and validation state close together

Cons:

- makes the companion heavier
- can tempt future scope creep if every validation idea is stuffed into it

Decision:
best default for v1 structural validation and confidence-tier wiring.

### 7.2 Option `(b)`: `commands/*.md`

Pros:

- can theoretically reuse Claude Code native `Read`/`Grep` semantics directly
- low barrier for experimentation

Cons:

- weak testability
- command files become application logic
- harder to reason about background job behavior and replayability
- too easy to create drift between command prompt text and real runtime

Decision:
do not use this as the primary home for validation.

### 7.3 Option `(c)`: `/glm:grounded-review`

Pros:

- explicit opt-in surface
- honest naming if stronger validation semantics are materially different

Cons:

- lets weak defaults remain in the two main review modes
- splits the mental model too early
- risks a feature-surface fork before the core evidence model is stable

Decision:
revisit only after the shared validation substrate is proven.

## 8. Explicit Non-Goals For V1

1. no auto-fix behavior; review remains review-only
2. no claim of full semantic-faithfulness guarantee in v1
3. no silent expansion into pentest or generalized security-platform behavior
4. no unconstrained repo-policy DSL in the first repo-owned checks version

## 9. Immediate Next Questions

1. Should `/glm:review` stay as one generic reviewer, or split into:
   - built-in balanced review
   - repo-policy checks
   - optional validation pass?
2. What is the minimum evidence model needed before findings can be trusted as
   more than structured hypotheses?
3. Which parts of the external systems are genuinely transferable without
   blowing up the product boundary?
4. When does a challenge surface deserve to become a real pack, rather than
   staying a focus tag?

## 10. Status

This is a first-pass baseline only.
It should be followed by a design note that turns these observations into:

- product boundary
- mode split
- AC matrix
- validation architecture
- confidence tiering
- proposed implementation stages
- explicit non-goals
