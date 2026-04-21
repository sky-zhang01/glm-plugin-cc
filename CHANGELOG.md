# Changelog

## v0.4.7-beta1 — 2026-04-22

**Prerelease snapshot — 途中版本 (interim / in-transit).** This tag
captures the v0.4.7 work-in-progress at the point where:

- all review-reliability **code changes are locked in** (parse-layer
  defenses, `response_format: json_object`, BigModel error-table
  expansion, `buildChatRequestBody` extraction, sampling CLI flags),
- all **docs are locked in** (this CHANGELOG, "Diff size guidance" in
  `commands/review.md`, `docs/anti-hallucination-roadmap.md`),
- **170/170 unit tests pass** (156 baseline + 14 new),
- the **149-run pre-Phase-7d baseline data is committed** as is the
  149 sidecar JSONs under `test-automation/review-eval/results/v0.4.7/`.

At commit time the **Phase 7d power-up sweep** (C3 to effective
N=80 per temperature cell for ~80% Fisher exact power; C1 to N=40
for confirmation) is **still in flight** in two parallel worktrees
(`/tmp/glm-eval-A` at d5fa754 for C3, `/tmp/glm-eval-B` at 7766943
for C1). `test-automation/review-eval/results/v0.4.7/expanded-sweep.csv`
and `payloads/` at this tag therefore contain the 149-run baseline
**plus whatever partial Phase 7d progress happened to be written to
disk at the exact moment of the beta1 commit** — the two sweep
processes append as they run, so `wc -l` on the CSV at this ref
will exceed 149. Do not read these partial Phase 7d rows as a
coherent dataset; the v0.4.7 final tag will refresh the CSV with
the complete Phase 7d sweep.

Cut as a prerelease — **NOT marked `Latest`** on Gitea / GitHub —
so the finalized code + docs + 149-run analysis can be audited
against a stable ref without waiting for the remaining ~7-8 hours
of C3 sweep wall time. v0.4.6 remains `Latest` until v0.4.7 final.

v0.4.7 final will be tagged on a follow-up commit that writes the
Phase 7d effective-N and Fisher-exact results into the tables
below + bumps `0.4.7-beta1 → 0.4.7` in the three manifests.
Behavior between beta1 and final is identical except for the
updated outcome numbers; no code or prompt change is planned
between these tags.

The rest of this section describes the v0.4.7 final scope. Read it
as "what beta1 already delivers + what Phase 7d will confirm".

---

Review reliability pass. Addresses the v0.4.5 SCHEMA_ECHO dogfood
observation + the 2026-04-21 workflow-governor cross-review
hallucination pattern via parse-layer defenses that run unconditionally
on review output, exposes BigModel sampling-parameter flags on the
CLI, lands a 3-fixture evaluation harness covering small / medium /
large diffs, and runs a 149-run empirical sweep across four adaptive
phases. Within the sweep's sample size (effective N=14-17 per
C1/C3 temperature cell) no sampling-parameter effect reaches
statistical significance — underpowered for ~15pct differences —
so the release ships no sampling-parameter default. Closes Gitea
issue #7 with this as the observed-but-non-significant state;
future sweeps needing decisive resolution of the temperature
contrast would need ~80+ runs per cell.

The initial 9-run sanity sweep on C2 (medium diff) was too thin to
justify any default change. Per user push-back, the sweep was expanded
in four adaptive phases:

1. **Phase 4/5 B+D+E matrix** — 3 fixtures × up to 4 seeds × 3
   temperatures × N=3 = 54 valid runs with raw-payload capture.
2. **Phase 7a adaptive consolidation** — 15 targeted runs on 5
   "signal-of-interest" cells to N=6, exposing that what looked like
   a dramatic "C3 temperature effect" (0.67→0.33→0.00) was
   substantially contaminated by BigModel-side vendor errors (1234,
   500) occurring during a period of upstream instability.
3. **Phase 7b effective-N fill** — 16 targeted runs filling cells
   that had been polluted by Phase 7a upstream failures, so every
   cell could be compared at **effective model-N ≥ 5**. Crucially,
   Phase 7b itself hit **zero upstream errors**, confirming vendor
   errors are time-correlated BigModel transient instability, not
   cell- or parameter-correlated.
4. **Phase 7c N≥14 fill** — 64 additional runs (C3 ×3 temps × +10
   each = 30; C1 ×3 temps × +10/+10/+14 = 34) delivered in parallel
   from two detached worktrees, taking every C1 and C3 cell to
   effective N≥14 per temperature. Fisher exact tests at this N are
   underpowered (~16% power for detecting a ~15pct difference at
   alpha=0.05), so the result is reported as observed-but-not-
   significant rather than a proof of no effect. A per-finding C1
   citation root-cause audit confirms 0 out-of-allowed-files
   fabrication (see § C1 citation audit).

Total evidence base: **149 valid runs with complete sidecar JSON for
each**. The data surfaced three categories of previously-silent
failures:

- **5 parse-failure modes** masquerading as `schema=0` with
  `errorCode=""` — all now typed + correction-hinted.
- **5 BigModel vendor error codes** (500, 1234, 1311, 1312, 1313) that
  the v0.4.6 dispatch table missed — all now added with correct retry
  semantics.
- **13 upstream-layer failures across 149 runs (8.7%)** — vendor
  errors + network timeout + empty-response cases. Distributed in
  time (concentrated in Phase 7a; Phase 7b had zero; Phase 7c had
  4/64 = 6.3%), not across cells, and now handled by the expanded
  dispatch table for automatic retry.

**No default sampling parameter change ships in v0.4.7**. At
effective N=14-17 per cell on C3, every pairwise Fisher exact test
returns p > 0.3; the result is observed-but-not-significant.
Power for detecting a ~15pct per-step difference at this N is
approximately 0.16, so this is not a proof of no effect — it is
absence of evidence at the current sample size. A decisive answer
would need ~80+ runs per cell, which is out of scope for a personal
Coding Plan in one session:

| fixture | temp | effective N | schema pass | Wilson 95% CI |
|---|---|---|---|---|
| C3 | 0.0 | 14 | **13/14 (92.9%)** | [68.5%, 98.7%] |
| C3 | 0.5 | 17 | 13/17 (76.5%) | [52.7%, 90.4%] |
| C3 | 1.0 | 14 | 12/14 (85.7%) | [60.1%, 96.0%] |
| C2 | all 12 cells | 42 | 40/42 (95.2%) | 2 parse-layer failures |
| C1 | 0.0 | 16 | **16/16 (100%)** | [80.6%, 100%] |
| C1 | 0.5 | 16 | **16/16 (100%)** | [80.6%, 100%] |
| C1 | 1.0 | 17 | **17/17 (100%)** | [81.6%, 100%] |

**Fisher exact 2×2 on C3 schema compliance across temperature**:

| contrast | table | p (two-sided) | interpretation |
|---|---|---:|---|
| C3 t=0 vs t=0.5 | 13/14 vs 13/17 | **0.344** | not significant |
| C3 t=0 vs t=1 | 13/14 vs 12/14 | **1.000** | not significant |
| C3 t=0.5 vs t=1 | 13/17 vs 12/14 | **0.664** | not significant |

Three things the N≥14 data clarifies relative to the N=6 view:

1. **Large-diff temperature effect — not detectable at this N.**
   The N=5-7 view showed a mild monotone 83%→71%→67% trend. At
   N=14-17 it flattens to a non-monotone 93%→76%→86% pattern (t=0.5
   worst, t=0 best, t=1 middle), and every pairwise Fisher contrast
   is non-significant (p=0.344 / 1.000 / 0.664). At the observed
   effect size this design has ~16% power, so this is "no
   significant effect detected at current N", not "no effect
   exists". The plugin ships no default temperature change because
   there is no detected effect to justify one; a future sweep that
   wanted to decisively rule in or out a ~15pct-per-step effect
   would need ~80+ runs per cell.
2. **Small-diff citation-accuracy root cause — scoring-harness
   artifact.** C1 schema is 100% across all three temps at
   N=16-17. The `citation_accuracy = 0.66-0.78` on C1 is explained
   by a per-finding audit of all 93 parsed findings: 0/93 cite
   out-of-diff files, 0/93 cite `known_false_files`, and the
   41.9% "LINE_MISMATCH" cases are all "diff-meta" findings
   (finding.body talks about commit-message / CHANGELOG entry /
   scope-rename, so reviewer meta-language tokens like `commit`,
   `CHANGELOG`, `rename`, `scope` don't appear as literal tokens
   in the cited file's content). The model is **not** fabricating
   citations — the scoring rubric is too strict for legitimate
   meta-findings on small diffs. No prompt or model change is
   needed. Optional harness refinement is v0.5.x scope.
3. **Diff-size usage matrix — documented in commands/review.md.**
   The `/glm:review` command's "Diff size guidance" section now
   summarises small / medium / large behavior and practical
   invocation notes (background preferred >1500 lines; no
   opinionated sampling default; expected latency bands).

The closing observation from the N=85 view still stands and is
sharpened by Phase 7c: **0/149 runs cite `known_false_files`** (the
2026-04-21 workflow-governor cross-project hallucination pattern).
That pattern is confidently not a GLM-5.1 failure mode at any
temperature under the current model snapshot.

### Added

- **`response_format: { type: "json_object" }` on every review call**
  (`scripts/lib/glm-client.mjs:buildChatRequestBody`). BigModel GLM-5.x
  supports this on the OpenAI-compatible endpoint (confirmed 2026-04
  via `docs.z.ai`; `json_schema` is NOT supported, only `text` and
  `json_object`). Previously the client relied on prompt-only JSON
  instructions — Codex's v0.4.7 adversarial review caught that gap.
  This is parser-hardening only; it does NOT defend against
  content-level fabrication ("correctness without faithfulness" per
  Wallat et al., arXiv 2412.18004, 2024). See the full menu of
  considered mitigations in `docs/anti-hallucination-roadmap.md`.
- **`buildChatRequestBody` extracted as a pure exported function** so
  request-shape behavior (response_format, thinking mode, sampling
  forwarding) is unit-testable without a mock HTTP endpoint. 14 new
  tests in `tests/chat-request-body.test.mjs`. Total suite now 170/170.
- **`docs/anti-hallucination-roadmap.md`** — captures Codex's v0.4.7
  research pass on Chain-of-Verification, Self-Consistency,
  SelfCheckGPT, RAG + attribution-faithfulness, constrained
  decoding, Guardrails/NeMo/Pydantic AI, and structures the
  v0.4.7/v0.4.8/v0.5+ landing plan. Primary sources: Dhuliawala
  2023, Wang 2023, Manakul 2023, Farquhar 2024, Rashkin 2023, Wallat
  2024. Community consensus on the rename-fabrication class:
  external grounding + claim-level verification + abstention.
- **Parse-layer review-output defenses** (`scripts/lib/glm-client.mjs`):
  - `stripMarkdownFences` — removes `` ```json ... ``` `` wrappers.
    v0.4.7-final extends it with two half-fence fallbacks: open-only
    (GLM started with ```json\n but truncated before closing ```,
    observed at C3 temp=1 run 2) and close-only (rare: model forgot
    opening fence). Full-fence match always wins when available.
  - `classifyReviewPayload` — typed classification of parsed JSON into
    `valid` / `schema_echo` / `invalid_shape`.
  - `classifyParseFailure` (new in v0.4.7-final) — typed classification
    of the 5 observed parse-failure modes derived from expanded-sweep
    sidecars:
    - `EMPTY_RESPONSE` — blank output (upstream terminated early)
    - `REASONING_LEAK` — `<thinking>` tags leaked to content channel
    - `MARKDOWN_FENCE_UNTERMINATED` — ```json\n start without ``` close
    - `TRUNCATED_JSON` — JSON shape but parse failed mid-structure
    - `PARSE_FAILURE` — catchall for unclassified parse errors
    Integrated into `runChatRequest`: when `parsed === null` the
    companion now returns a typed `errorCode` instead of silently
    passing through `errorCode=""`.
  - `runChatRequestWithCorrectionRetry` — single-shot targeted
    correction retry for shape failures. Extended in v0.4.7-final to
    cover all 5 parse-failure errorCodes via dedicated
    `buildCorrectionHint` branches.
- **Sampling-parameter CLI flags** (`scripts/glm-companion.mjs`,
  `commands/review.md`, `commands/adversarial-review.md`):
  `--temperature <0-2>`, `--top-p <0-1>`, `--seed <int>`,
  `--frequency-penalty <-2-2>`, `--presence-penalty <-2-2>`. Unset =
  server default (no change from v0.4.6 behavior). Out-of-range values
  are silently skipped so sweep automation never crashes mid-run.
- **Three-fixture evaluation harness** (`test-automation/review-eval/`):
  - **C1-v044-setup-menu** (small, ~440 lines, 6 files) — single
    v0.4.4 commit adding an interactive /glm:setup menu.
  - **C2-v046-aftercare** (medium, ~1550 lines, 11 files) — pinned
    v0.4.5→v0.4.6 diff covering BigModel error dispatch + retry layer.
  - **C3-v04x-cumulative** (large, ~8336 lines, 84 files) — cumulative
    v0.4.0→v0.4.6 diff approaching the 9200-line scale of the
    2026-04-21 workflow-governor hallucination session.
  - `run-experiment.mjs` — runs N copies of one (fixture, sampling-cell)
    combo, scores citations via grep-based file-existence + distinctive-
    token matching, saves per-run sidecar JSON with full parsed payload
    + rawOutput head + metrics, appends one row per run to CSV.
    Accepts `--base <ref>` for pinning the reviewed diff baseline.
  - `summarize.mjs` — aggregates CSVs by cell (fixture × temp × top_p ×
    seed × thinking), prints a markdown-compatible table, applies the
    issue #7 success criteria.
  - Each fixture ships `meta.json` (provenance: base/head refs,
    line/byte counts, touched-file list) and `ground-truth.json`
    (`allowed_files` + `known_false_files` universal hallucination
    signal list + `expected_bugs` curated for that diff scope).
- **v0.4.7 sweep data artifacts**:
  - `results/v0.4.7/sanity-sweep.csv` — original 9-run v1-strictness
    data (preserved for reference; old `schema_compliance` used a
    stricter truthy check).
  - `results/v0.4.7/expanded-sweep.csv` — 149-row CSV merging Phase
    4/5 B+D+E matrix (54 rows) + Phase 7a adaptive follow-up (15 rows)
    + Phase 7b effective-N fill (16 rows) + Phase 7c N≥14 fill
    (64 rows). New schema-compliance check aligned to
    `classifyReviewPayload`; `schema_empty_string` column isolates
    the empty-content content-quality signal.
  - `results/v0.4.7/payloads/` — 149 sidecar JSON files with full
    parsed output + rawOutput head (8KB cap) + per-run metrics +
    cell metadata. Evidence for the five parse-failure modes, the
    five new vendor error codes, the (underpowered) C3 temperature
    picture, and the C1 citation diff-meta pattern.
- **5 new BigModel vendor error codes** (`scripts/lib/bigmodel-errors.mjs`)
  — empirically caught in the v0.4.7 expanded sweep + confirmed
  against the current official docs at
  https://docs.bigmodel.cn/cn/faq/api-code:
  - `500` → `UPSTREAM_INTERNAL_ERROR`, retry=immediate (HTTP 500 or
    business code 500 upstream internal errors; docs: 稍后重试或联系客服).
  - `1234` → `UPSTREAM_NETWORK_ERROR`, retry=immediate (网络错误，错误id,
    typically transient BigModel-side network hiccup).
  - `1311` → `MODEL_NOT_IN_PLAN`, retry=never (subscription plan
    doesn't include the requested model).
  - `1312` → `MODEL_OVERLOADED`, retry=immediate (model-specific
    traffic spike with alt-model suggestion).
  - `1313` → `FAIR_USE_LIMIT`, retry=never (fair-use policy trip,
    requires unlock via personal center).
  Table grew from 7 to 12 known codes. 9 of the 149 sweep runs hit
  one of the new codes (combined 1234 + 500 count across raw and
  typed forms: 6+3=9) — adding them to the dispatch table means
  retry.mjs now handles these via the same exponential-backoff path
  as 1302 / 1305 rather than falling through to
  `VENDOR_ERROR:<code>` with `retry=unknown`.
- **Parse-defense unit tests** (`tests/review-payload.test.mjs`) —
  34 cases total (19 initial + 15 new): `stripMarkdownFences` full +
  half-fence fallbacks, `classifyReviewPayload` valid / schema_echo /
  invalid_shape, `classifyParseFailure` all 5 typed modes + priority
  ordering.
- **BigModel error-code unit tests** (`tests/bigmodel-errors.test.mjs`)
  — 7 new cases covering the 5 new vendor codes plus the expanded
  retry-semantic partitioning (immediate / after-cooldown / never).
  Total suite: **156/156 passing**.

### Changed

- **No default sampling parameter change.** Temperature, top_p, seed,
  frequency/presence penalty all remain server-default (unset) in the
  POST body unless a caller explicitly passes a flag. v0.4.6 behavior
  is preserved.
- **BigModel vendor error table expanded** from 7 to 12 codes. The
  v0.4.6 snapshot predated several codes the current official docs
  list. The 5 additions — `500`, `1234`, `1311`, `1312`, `1313` —
  each map to a typed internal `errorCode` and correct retry semantic
  per the docs. The two that actually appeared in our sweep (1234 ×
  5 and 500 × 2) will now be retried with the same exponential
  backoff pipeline as 1302 / 1305, instead of surfacing as
  `VENDOR_ERROR:<code>` with `retry=unknown` and no automatic recovery.
- **Schema-compliance measurement semantics.** `run-experiment.mjs`
  previously used a truthy check on `parsed.verdict` (rejected empty
  strings); v0.4.7-final aligns it with the plugin's own
  `classifyReviewPayload` (typeof-string check). Content-emptiness is
  now tracked as an independent `schema_empty_string` column. This
  eliminates the "schema=0 with errorCode='' " ambiguity that made
  the initial sweep result unreadable.
- **Path-leak scanner exclusions.** `scripts/ci/check-no-local-paths.sh`
  excludes `test-automation/review-eval/corpus/**` and
  `test-automation/review-eval/results/**` — fixture diff.patch files
  are frozen git-history artifacts carrying pre-cleanup strings by
  construction, and results payloads echo fixture content from model
  responses.

### Expanded-sweep outcome

149 valid runs total across four phases (54 + 15 + 16 + 64).

**outcome distribution across 149 runs** (counted by
`schema_compliance` and `error_code` jointly — see row notes):

| bucket | count | rate | interpretation |
|---|---:|---:|---|
| schema-compliant success (schema=1, error_code="") | 127 | 85.2% | plugin produced a valid schema-compliant payload |
| stealthy schema-0 with blank error_code (Phase 4/5 pre-classifier) | 7 | 4.7% | raw `<thinking>…</thinking>` prose, extra data after JSON, tool-call text — would be typed under v0.4.7 if replayed |
| BigModel 1234 upstream network (pre-7c raw + Phase 7c typed) | 6 | 4.0% | 5× raw `VENDOR_ERROR:1234` from Phase 4/5/7a/7b + 1× typed `UPSTREAM_NETWORK_ERROR` from Phase 7c |
| BigModel 500 upstream internal (pre-7c raw + Phase 7c typed) | 3 | 2.0% | 2× raw `VENDOR_ERROR:500` from pre-7c + 1× typed `UPSTREAM_INTERNAL_ERROR` from Phase 7c |
| EMPTY_RESPONSE | 3 | 2.0% | BigModel terminated before emitting content |
| NETWORK_ERROR | 1 | 0.7% | local 303s timeout on a long C3 response |
| MARKDOWN_FENCE_UNTERMINATED (Phase 7c typed) | 1 | 0.7% | parse-layer classifier caught an open-fence truncation |
| PARSE_FAILURE (Phase 7c typed) | 1 | 0.7% | parse-layer classifier catchall — schema JSON failed all five typed modes |

Phase attribution for raw-vs-typed vendor codes: **every raw
`VENDOR_ERROR:1234` and `VENDOR_ERROR:500` payload in the CSV
timestamps into Phase 4/5 or Phase 7a** (pre-dispatch-table-expansion
harness). Every Phase 7c (>=14:21 UTC) upstream BigModel failure
surfaced as a typed code, confirming the v0.4.7 worktrees both
loaded the expanded `bigmodel-errors.mjs` correctly. The histogram
collapses raw + typed rows for readability only; they are not
co-mingled within a single phase.

**13 of 149 runs (8.7%) were upstream-layer BigModel failures**
(rows 3-6). Phase 7a had a dense ~25-minute burst around 13:00 UTC
(5/15 runs ≈ 33%); Phase 7c spread across ~1 hour ran at ~6%;
Phase 4/5 and Phase 7b were low. That by-time structure rules out
any per-cell explanation — the vendor errors are **time-correlated
BigModel transient instability**, not temperature-, fixture-, or
seed-triggered behavior. v0.4.7's dispatch-table expansion (500,
1234, 1311, 1312, 1313) means all observed codes now trigger the
retry/backoff pipeline instead of falling through to
`VENDOR_ERROR:<code>` with `retry=unknown`.

**2 of 149 runs (1.3%) were Phase-7c parse-layer-classified
failures** (rows 7-8) — the invisible-pre-v0.4.7 failure class this
release targets, caught by the classifier in deployment. Plus an
additional **7 Phase 4/5 runs** (row 2) which are the same class of
failure captured before the classifier merged, so they surface with
`schema_compliance=0` and blank `error_code`. Under the v0.4.7 path
those would also be typed.

> **Baseline caveat**: the 149-run sweep and the 1.3% / 4.7% parse-
> failure rates measure the **pre-`response_format: json_object`**
> code path. v0.4.7 ships `response_format: json_object` on every
> review call (see § Added), which is expected to reduce these rates
> further. A future diff against this 149-run baseline will quantify
> the post-response_format improvement.

### Effective-N analysis (model-behavior isolation)

Re-aggregating after excluding upstream-layer failures gives the
model-only behavior rates. At effective N=14-17 per cell on C1 and
C3 (Phase 7c), the picture sharpens considerably:

| cell | effective N | schema pass | Wilson 95% CI |
|---|---|---|---|
| **C1 temp=0.0** | 16 | **16/16 (100%)** | [80.6%, 100%] |
| **C1 temp=0.5** | 16 | **16/16 (100%)** | [80.6%, 100%] |
| **C1 temp=1.0** | 17 | **17/17 (100%)** | [81.6%, 100%] |
| C2 (all 12 cells) | 42 | 40/42 (95.2%) | 2 parse-layer failures (one REASONING_LEAK, one extra-data-after-JSON) |
| **C3 temp=0.0** | 14 | **13/14 (92.9%)** | [68.5%, 98.7%] |
| **C3 temp=0.5** | 17 | 13/17 (76.5%) | [52.7%, 90.4%] |
| **C3 temp=1.0** | 14 | 12/14 (85.7%) | [60.1%, 96.0%] |

Re-reading at N≥14:

- **C1 schema is perfect.** 49/49 across three temperature cells. The
  earlier "C1 small-diff failure" signal from N=3 data was entirely
  upstream-error pollution. The small-diff concern that remained
  (C1 `citation_accuracy` at 0.66-0.78, vs C2/C3 at 0.83-1.00) is
  resolved by the per-finding audit below: it is a scoring-harness
  artifact on diff-meta findings, not a model regression.
- **C2 is robust across the full temperature × seed matrix.** 40/42
  effective runs pass across 12 cells. The two failures are both
  Phase 4/5 runs (before `classifyParseFailure` was merged, so they
  surfaced as `error_code=""` rather than typed): one REASONING_LEAK
  on seed=1337 temp=0 (193-char `<thinking>...</thinking>` leak, no
  JSON) and one trailing-content parse failure on seed=42 temp=0.5
  (JSON emitted, then model continued with "Let me examine..."
  extra prose, breaking `JSON.parse`). Neither recurred in the
  Phase 7a N=6 consolidation of its cell. Both would surface as
  typed `errorCode` under the v0.4.7 path. Medium diffs are
  effectively temperature-insensitive.
- **C3 temperature effect is not detected at this N** (but not
  disproved either). Fisher exact p-values for every pairwise
  contrast are > 0.3, ordering is non-monotonic (t=0.5 worst, t=0
  best, t=1 middle). Design power at N=14-17 for a ~15pct per-step
  difference at alpha=0.05 is only ~16% — the test is underpowered,
  so "no detected effect" is the correct claim, not "no effect
  exists". The Decision block at the end of this section records the
  final call.

### C1 citation audit (per-finding root cause)

49 C1 sidecars with parsed output contribute 93 findings. Classifying
each `finding.file` against the C1 ground truth:

| category | count | % | interpretation |
|---|---:|---:|---|
| IN_ALLOWED_LINE_OK | 54 | 58.1% | correct file + distinctive tokens from body appear within ±20 lines |
| IN_ALLOWED_LINE_MISMATCH | 39 | 41.9% | correct file, tokens not found near cited lines |
| OUT_OF_ALLOWED | 0 | 0% | would mean citing a file outside the diff (wrong-file fabrication) |
| KNOWN_FALSE | 0 | 0% | would mean workflow-governor cross-project hallucination |

**0/93 findings cite a file outside the C1 diff and 0/93 cite a
cross-project known-false path** — the "wrong-file" dimension of
fabrication does not appear in this dataset.

The 39 mismatch cases are dominated by "diff-meta" findings: the
reviewer cites `package.json` or `CHANGELOG.md` while the
finding.body describes the file's role in the diff ("the commit
message confirms the scope rename", "the CHANGELOG entry combines
two concerns"). The distinctive tokens extracted from such bodies
— `commit`, `CHANGELOG`, `scope`, `rename`, `package`, `confirms`
— don't appear as literal text in those files' content, so the
scoring harness registers a miss even though the critique itself
is legitimate review surface (commit-message-vs-diff alignment).

**Caveat: the scoring rubric does NOT validate line-level content
claims.** A spot-check of IN_ALLOWED_LINE_MISMATCH sidecars surfaces
at least one line-level content fabrication — e.g. a `package.json`
finding claiming the rename was `@anthropics/claude-code` →
`@anthropic-ai/claude-code` when the actual C1 v0.4.4 rename was
`@skylab/glm-plugin-cc` → `glm-plugin-cc`. The current
`scoreCitation` function only checks (file-in-allowed-set) +
(any token from finding.body appears within ±20 lines) — it cannot
detect when an allowed-file citation makes a factually wrong
claim about file content. So the stronger interpretation is:
"0/93 wrong-file citations", not "0/93 fabrications".

Shipping action: none in v0.4.7 code. The scoring-rubric
limitation is documented here and in `commands/review.md`
"Diff size guidance". Upgrading the audit to check quoted entity
claims against fixture content is v0.5.x scope.

### Key findings (evidence-backed claims)

- **No `SCHEMA_ECHO` reproduction across 149 runs.** The v0.4.5
  aftercare dogfood failure mode is absent from the current model
  version at every temperature × seed × fixture combination tested.
- **No `known_false_files` hits across 149 runs.** The 2026-04-21
  workflow-governor cross-project hallucination pattern (citing
  `reference_runtime.py` / `governance.py` / `workflow_governor/`
  paths while reviewing glm-plugin-cc) did NOT reproduce — not even
  on C3 at the 8336-line scale that matched the original session,
  not at any temperature, not at any seed, not at any N up to 17
  per cell.
- **Zero out-of-allowed C1 citations across 93 parsed findings.**
  On the small-diff fixture the model correctly identifies the
  cited file in 100% of its findings. The scoring rubric does NOT
  validate line-level content claims, so "0 out-of-allowed" is not
  the same as "0 fabrication" — at least one confabulated content
  claim (fictional package-name rename) was surfaced in a
  spot-check (see § C1 citation audit).
- **Parse-failure modes empirically observed across 149 runs**:
  - `EMPTY_RESPONSE` — 3/149 (upstream-layer variants where BigModel
    terminated before any content).
  - `MARKDOWN_FENCE_UNTERMINATED` — 1/149 (C3 temp=0.5 run 6, Phase 7c,
    typed by v0.4.7 classifier).
  - `PARSE_FAILURE` catchall — 1/149 (C3 temp=0.5 run 10, Phase 7c;
    model emitted a 108-char plain-English "Let me read the key
    files." message with no JSON structure, no fence, no `<thinking>`
    tag — a "declining to emit structured output" pattern not
    captured by the other typed modes).
  - `REASONING_LEAK` pattern — 1/149 (C2 temp=0 seed=1337 run 3,
    Phase 4/5; surfaced as `error_code=""` because it predates the
    classifier merge; `<thinking>...</thinking>` + plain prose).
  - Trailing-content-after-JSON pattern — 1/149 (C2 temp=0.5 seed=42
    run 3, Phase 4/5; 1158-char output with JSON complete at char
    1068 then extra prose, `JSON.parse` "Extra data" error; also
    predates classifier merge).
  The last two (Phase 4/5) would now surface as typed `errorCode`
  under the v0.4.7 path. `TRUNCATED_JSON` is defined in the classifier
  but was not observed — it is reserved for genuine mid-structure
  JSON truncation, a mode the sweep did not exercise.
  All five typed modes ship with targeted correction-retry hints.
- **Five vendor error codes classified**: `500`, `1234` observed
  empirically in Phase 7a/7c; `1311`, `1312`, `1313` added from the
  current official docs that were missing from the v0.4.6 snapshot.
- **Adaptive-sampling methodology paid off.** Phase 7a (15 targeted
  runs) + Phase 7b (16 effective-N fill runs) + Phase 7c (64 N≥14
  fill runs) = 95 follow-up runs total. The targeted approach
  surfaced the vendor-error-time-correlation finding, pushed
  effective N high enough to separate schema-compliance noise from
  signal, and kept the total sweep under ~3.5 hours of wall time on
  a personal Coding Plan. It was NOT enough to make the
  temperature-effect test conclusive — for that, ~80+ runs per cell
  would be required.

**Decision**: no default sampling parameter change in v0.4.7.
Relative to the N=6 version of this statement, the Phase 7c N=14-17
data shows every pairwise Fisher exact p > 0.3 on C3 and C1 at 49/49
across temperatures — but Fisher power at this N for a ~15pct
per-step effect is ~16%, so "no detected effect" is the claim, not
"no effect exists". Without a detected effect there is no temperature
setting justified as a default. The actionable wins in v0.4.7 are:

  (a) parse-failure classifier + correction-retry (5 modes),
  (b) BigModel dispatch table expansion (+5 codes to 12 total),
  (c) 149-run baseline + 149 sidecar JSONs future sweeps can diff against,
  (d) "Diff size guidance" section in `commands/review.md` capturing
      the observational model-behavior-vs-diff-size matrix.

Gitea issue #7 is closed by this changelog with the
observed-but-not-significant temperature picture documented. If a
future investigation wants a powered test, ~80+ runs per cell would
be required; no follow-up issue is opened because the existing
CHANGELOG + 149 sidecar JSONs are enough to re-enter that work
when / if it becomes motivated.

### Unchanged

- Default model `glm-5.1`, default `--thinking on`, default
  server-provided sampling parameters.
- Review prompt body and companion JSON output shape.
- v0.4.6 retry/backoff layer, BigModel error-code dispatch, pre-tag
  release-ready gate.

## v0.4.6 — 2026-04-21

Post-v0.4.5 aftercare release. Adds programmatic BigModel vendor
error-code handling with automatic retry/backoff for transient
conditions, corrects the error-code table against the official docs,
and retires the chronically-broken `verify-release.yml` workflow in
favor of a local pre-tag gate.

### Added

- **BigModel vendor error-code dispatch table**
  (`scripts/lib/bigmodel-errors.mjs`) — official codes 1301/1302/1304/1305/1308/1309/1310
  per [docs.bigmodel.cn/cn/faq/api-code](https://docs.bigmodel.cn/cn/faq/api-code).
  Each maps to a distinct internal `errorCode` + retry semantic
  (`immediate` / `after-cooldown` / `never`) + user-facing recovery
  hint. Unknown vendor codes fall through to `VENDOR_ERROR:<code>`
  preserving raw vendor message rather than being silently swallowed
  as generic `RATE_LIMITED`.
- **Automatic retry/backoff for transient conditions**
  (`scripts/lib/retry.mjs`) — `/glm:review`, `/glm:adversarial-review`,
  and `/glm:task` now transparently retry on `retry: immediate` failure
  codes (1302 account rate limit, 1305 shared-pool overload) plus
  network-layer errors (TIMEOUT, NETWORK_ERROR). Exponential backoff
  with ±20 % jitter, default policy: `maxAttempts=3`, `baseDelayMs=2000`,
  `multiplier=2.5`, `maxDelayMs=15000`, `totalBudgetMs=30000`. Terminal
  codes (1301/1304/1308/1309/1310, auth, bad request) return on first
  call — no wasted retries. Default matches ZhipuAI SDK's own
  `max_retries=3` industry norm. Each attempt surfaces through
  `onProgress` so the caller sees "attempt 2 hit SERVICE_OVERLOADED;
  backing off 5100 ms before retry". Result shape extends with
  `attempts`, `attemptHistory`, `retryExhausted` for observability.
  Opt-out via `retry: false` in the call-site options (useful for
  debugging).
- `scripts/ci/check-release-ready.sh` — local pre-tag gate running the
  four checks the defunct `verify-release.yml` tried to run
  (package.json ↔ tag parity, manifest parity, CHANGELOG section,
  release_card Status: READY). Invoked automatically by the pre-push
  hook on `refs/tags/v*.*.*` refspec.

### Changed

- **Error-code table corrections** against the official BigModel docs:
  - `1303` REMOVED from the table (does not exist in official docs; my
    earlier mapping was memory-derived)
  - `1304` reclassified from `INSUFFICIENT_BALANCE` (wrong) to
    `DAILY_QUOTA_EXHAUSTED` — daily call-count cap, requires plan
    purchase not balance top-up
  - `1302` message clarified: account-level **rate limit** (not just
    concurrent), retry=immediate per official "建议重试 / 控制请求频率"
  - Added 1301 (CONTENT_BLOCKED), 1308 (PLAN_QUOTA_EXHAUSTED),
    1309 (PLAN_EXPIRED), 1310 (PERIODIC_QUOTA_EXHAUSTED)

### Removed

- `.github/workflows/verify-release.yml` deleted and the orphaned
  GitHub registration marked `disabled_manually`. Every run since
  creation was a 0-second failure: GitHub's parser never registered
  the YAML (registered `name` = filename path fallback, not the
  `name: Release Gate` declared in YAML — confirmed via
  `/repos/.../actions/workflows` diff against `ai-quality-gate.yml`
  and `pr-check.yml`). Coverage fully replaced by
  `check-release-ready.sh` + pre-push hook; no release-gate
  functionality lost.

### Hardened (post-adversarial-review, in-release)

GLM adversarial-review dogfood of the v0.4.6 branch surfaced 2
additional HIGH-severity gaps, both remediated before merge:

- **HTTP 502/503/504/500 now auto-retry** as a distinct
  `HTTP_ERROR_TRANSIENT` error code with `retry: immediate`. Previously
  the generic `HTTP_ERROR` fallback defaulted to `stop`, so BigModel
  gateway spikes would abort without retry. Terminal 5xx (e.g. 507)
  still stops to avoid amplifying persistent backend bugs.
- **totalBudgetMs now enforces wall-clock elapsed**, including call
  duration and not only cumulative backoff sleep. Previously a retry
  loop with 20-second calls could silently exceed a 30-second budget.
  Default budget raised from 30s to 90s to accommodate 3 × thinking-on
  calls plus backoff. `withRetry` now accepts a `now()` injector so
  tests can stub wall-clock advancement.
- `onAttempt` callback payload extended with `maxAttempts`, `elapsedMs`,
  `budgetMs` so the caller-visible progress string can render
  "attempt 2/3; elapsed 22000/90000 ms".
- pre-push hook gained an explanatory comment documenting the
  multi-ref push semantic (`git push origin main v0.4.6` loops each ref).

GLM findings #4 (1308 retry semantic) and #7 (unmapped-code logging)
were rebutted: 1308 is period-based per official docs (not concurrent
as GLM guessed), and silent conservative-stop on unknown codes is the
safer default for a plugin. GLM finding #6 (real-timer integration
test) accepted as a low-value gap — fake-timer tests give same logical
coverage at 10× speed.

### Tests

- 115 / 115 PASS (65 pre-existing + 20 new bigmodel-errors tests + 30
  new retry tests). Lock in the corrected error table, retry semantic
  dispatch, backoff math, wall-clock budget enforcement, HTTP 5xx
  transient classification, attemptHistory shape, network-error
  retryability, opt-out path, and onAttempt payload contract.

### Known non-issue (deferred)

- GLM-5.1 model-class hallucination on large (>5k line) diffs with
  structured output + `thinking: enabled` is documented in
  `~/Project/knowledge/agent-hallucination-patterns.md` (Appendix,
  2026-04-21). Two independent dogfood sessions observed it on the
  same day. Mitigations (scope-narrowing heuristic, schema-echo
  detector, optional citation sanity-check) are scoped for a future
  release — they are model-class mitigation, not a plugin bug.

## v0.4.5 — 2026-04-21

Add `--wait` / `--background` execution-mode flags to `/glm:review` and
`/glm:adversarial-review`. HTTP call shape, model catalog, config file,
and prompt templates unchanged.

### Added

- `/glm:review` and `/glm:adversarial-review` — the skill prompt now
  estimates review size (`git status --short --untracked-files=all` +
  `git diff --shortstat`) and asks once via `AskUserQuestion` whether
  to wait in the foreground or detach to a Claude Code background
  task. The recommended option is auto-selected: "Wait" for clearly
  tiny reviews (~1-2 files), "Run in background" otherwise. Background
  uses `Bash(..., run_in_background: true)`; user polls via
  `/glm:status` and `/glm:result <id>`.
- `--wait` / `--background` flags on both review commands bypass the
  `AskUserQuestion` prompt for scripted invocations. Both flags are
  no-ops at the companion layer — `scripts/glm-companion.mjs runReview`
  declares them in `booleanOptions` so `parseArgs` consumes them
  rather than leaking into focus text. Actual detach is owned by
  Claude Code's Bash invocation.

### Hardened (post-adversarial-review)

- Mutual-exclusion rule for `--wait` + `--background`: if both are
  passed to `/glm:review` or `/glm:adversarial-review`, `--wait` takes
  precedence (foreground). Previously the outcome depended on LLM
  bullet-read order.
- `git diff` failure fallback: if the size-estimation probes error
  (shallow clone, non-existent `--base`, detached HEAD), the skill now
  treats the size as unclear, recommends background, and surfaces the
  error to the user instead of silently classifying as empty or tiny.
- `/glm:setup` slash-command pivot guard on the "Key missing" and
  "Rotate API key" prompts: if the user's reply begins with `/`
  (e.g., `/glm:review`), the skill refuses and does not write it to
  `config.json`, preventing accidental `slash-command-as-API-key`
  corruption.
- UAT harness extended from 9 to 11 scenarios: Scenario I covers
  multi-word focus text + `--scope` + `--wait` flag combination;
  Scenario J is a source-level grep that fails UAT if any future
  change reads `options.wait` / `options.background` in the companion
  (locking in the no-op contract).

## v0.4.4 — 2026-04-21

UX polish + metadata cleanup. No public API changes. No config
migration. Explicit-flag `/glm:setup` invocations keep their v0.4.3
behavior.

### Fixed

- `commands/setup.md` — bare `/glm:setup` on a healthy configuration
  (both `preset_id` and `has_api_key` set, `$ARGUMENTS` empty) now
  surfaces an `AskUserQuestion` menu: *Keep current configuration*,
  *Rotate API key*, *Switch preset*, *Ping test*, *Toggle review
  gate*, *Cancel*. Previously the skill dumped the JSON report and
  exited silently, forcing users to memorize flags for rotation.
  Companion script unchanged — every menu entry maps to a flag
  combination already supported in v0.4.3.
- `package.json` `name` field — renamed from `@skylab/glm-plugin-cc`
  to `glm-plugin-cc` (unscoped), closing out the v0.4.3 marketplace
  cleanup. Zero functional impact: `"private": true`, no import or
  require referenced the scoped name.

## v0.4.3 — 2026-04-20

Bug-fix and hardening release. Multiple rounds of static + AI-assisted
code review over the v0.4.2 scaffold-parity work surfaced 22 issues;
all fixed in this release. Adds the first real CI pipeline and grows
the automated test suite from 0 to 65 tests.

The headline fix: pre-v0.4.3, every `/glm:review` and
`/glm:adversarial-review` call shipped an EMPTY repository context to
GLM. The prompt template used `{{REVIEW_INPUT}}` / `{{TARGET_LABEL}}`
/ `{{USER_FOCUS}}` / `{{REVIEW_COLLECTION_GUIDANCE}}`, while the
companion passed `FOCUS_INSTRUCTION` / `REVIEW_DIFF` / `REVIEW_BASE`
/ `REVIEW_SCOPE` / `ADVERSARIAL_MODE` — zero overlap, and
`interpolateTemplate` silently substitutes `""` for unmatched
placeholders. The review feature effectively never worked end-to-end.

### Fixed — review pipeline

- Review prompt pipeline — companion keys now align with template
  variables so diff, target label, focus, and collection guidance
  actually reach GLM (`scripts/glm-companion.mjs runReview`).
- Template dispatch — `/glm:review` (balanced) now loads
  `prompts/review.md`; `/glm:adversarial-review` continues to load
  `prompts/adversarial-review.md`. Pre-fix, both loaded the
  adversarial template regardless of mode, so balanced mode was
  adversarial in every substantive way.
- `prompts/review.md` (new) — balanced-tone counterpart to the
  adversarial template. Same structured-output contract, but an
  honest (not skeptical-by-default) operating stance.
- Shipped review schema fail-closed — `/glm:review` no longer
  silently falls back to a drifted verdict enum when the shipped
  schema can't load; surfaces a clear reinstall-the-plugin error
  instead.
- Finding `confidence` preserved — review-finding confidence score
  is shown inline (`[high · conf 0.95] ...`) with boundary +
  out-of-range guards.
- Target-label metadata — drifted `target.base` / `target.scope`
  fields removed; `target.label` is authoritative.

### Fixed — CLI + argument parsing

- `args.mjs` `--key=value` split — values containing `=` (URL query
  strings, base64, etc.) were silently truncated by
  `split("=", 2)`. Switched to `indexOf("=")` + slice. Example:
  `--base-url=https://open.bigmodel.cn/api/coding/paas/v4?foo=bar`
  pre-fix resolved to `...?foo` and dropped `=bar`.
- `args.mjs` `--cwd` / `-C` flag — silently ignored on every
  subcommand because `cwd` wasn't registered in `valueOptions`;
  the long-form token fell through to positionals and
  `resolveCommandCwd` always returned `process.cwd()`. Fixed in
  `parseCommandInput` alias wiring.

### Fixed — corrupt-state resilience

- `state.mjs loadState` fail-closed — pre-fix, a corrupt
  `state.json` silently returned an empty job list; the next
  `saveState` overwrote the file with `{ jobs: [] }`, wiping job
  history and leaking every on-disk job + log file as an orphan.
  Now throws with filename + recovery hint; missing file still
  returns defaults.
- `preset-config.mjs writeConfigFile` fail-closed on merge —
  pre-fix, rotating the API key on top of a corrupt config silently
  dropped `preset_id` / `base_url` / `default_model` to null. Now
  uses `readConfigFile` directly (throws on corrupt, null only on
  missing).
- `/glm:setup` survives corrupt `state.json` — unwrapped config
  read in `buildSetupReport` crashed the exact command the user
  would run to recover. Now wraps the read, exposes
  `report.state.error`, and adds a fix-state-file step to
  `nextSteps`.
- `/glm:status` survives corrupt `state.json` — symmetric fix in
  `buildStatusSnapshot`; wraps `getConfig` / `listJobs`, surfaces
  `snapshot.stateError`, emits a State file block in the rendered
  report.
- `/glm:result` surfaces a clean corrupt-job-file error —
  `readJobFile` now throws with the file path and a "Delete or fix
  the file to recover" hint, replacing a bare `SyntaxError`
  stacktrace.
- Generic JSON fail-closed helper — new `readJsonFile` in
  `scripts/lib/fs.mjs`; all on-disk JSON reads (state, config, job
  files, shipped schema) now throw with the file path on corrupt
  content. `readStoredJobOrNull` in `tracked-jobs.mjs` inherits
  the improved message through delegation.

### Fixed — error surface

- Error-message consistency — all user-facing error emissions go
  through `formatUserFacingError` in `fs.mjs`, which pulls
  `.message` from `Error` instances, falls back to `String()` for
  non-Error throws, and redacts the user's home directory prefix
  (`/Users/<name>/...` → `~/...`) before output. Local debug still
  sees full paths (redaction runs at emission, not at throw).
- Primary-error preservation in job runner — a secondary
  "could not parse job file" error no longer shadows the primary
  runner failure; both are surfaced with the primary leading.
- Stale `GLM_MODEL` environment-variable references in `README.md`
  and `commands/review.md` replaced with `default_model` config
  pointer (env override was removed in v0.3.0).

### Fixed — dead scaffolding removed

GLM is stateless HTTP — there is no thread / session / turn concept
to model. This release removes the dead codex-plugin-cc carryovers
that pretended otherwise:

- `findLatestTaskThread`, `interruptAppServerTurn`,
  `terminateProcessTree` — always returned null / no-op shapes on
  GLM; ~70 LOC with zero call sites. Deleted.
- `formatResumeCommand` / `"Resume thread: null"` output branch —
  literal null leaked into user-visible output when a legacy job
  record happened to carry a non-null `threadId`. Deleted. A
  stale caller in `pushJobDetails` would have thrown
  `ReferenceError: formatResumeCommand is not defined` on any
  active-job `/glm:status`; caught in the final cleanup pass +
  covered by new renderer tests.
- `threadId` / `turnId` fields — removed from
  `normalizeProgressEvent`, `createJobProgressUpdater`,
  `runTrackedJob`, and three `glm-client.mjs` response shapes.
- `appendActiveJobsTable` "GLM Session ID" column — always empty
  on GLM. Table trimmed 7 → 6 columns.
- `buildPersistentTaskThreadName` renamed to `buildTaskTitle` (it
  never built a thread name — it built a short job title from the
  first line of the prompt).
- `scripts/glm-companion.mjs` — removed two unused imports
  (`listJobs`, `appendLogLine`) and dead `session_id` option
  plumbing that the receiving functions never read.
- `scripts/lib/state.mjs resolveStateDir` — dead catch branch
  that re-assigned a value it already held replaced with a no-op
  comment; behavior identical.
- `safeReadConfigOrNull` helper — unreferenced after the
  corrupt-merge fix; deleted with a structural test guard.

### Added — test suite (0 → 65 tests)

The v0.4.2 baseline had 0 automated tests; this release ships 65,
all passing under `node --test`. Coverage areas:

- `tests/args.test.mjs` — flag parsing regression guards (incl.
  `split("=", 2)` truncation + inline-empty-value edge case).
- `tests/state.test.mjs` — corrupt / missing / valid state
  round-trips + corrupt job file path.
- `tests/preset-config.test.mjs` — first-run, valid-merge (key
  rotation preserves other fields), corrupt-config throw.
- `tests/template-contract.test.mjs` — structural test pinning
  the review prompt contract; catches template / companion drift
  at `npm test` time, not runtime. Includes guards for no drifted
  verdict-enum strings and no lingering `safeReadConfigOrNull`
  definition.
- `tests/render.test.mjs` — review-result rendering with
  confidence boundary + out-of-range + omission + target-label
  contract guards.
- `tests/setup-resilience.test.mjs` /
  `tests/status-resilience.test.mjs` /
  `tests/result-propagation.test.mjs` — subprocess integration
  tests for corrupt-state resilience on the three main commands.
- `tests/fs.test.mjs` — `readJsonFile` + `redactHomePath` +
  `formatUserFacingError` helper suite, including the boundary
  case where a path like `/Users/<name>foo/bar` without a path
  separator stays untouched.
- `tests/schema-load.test.mjs` — shipped schema load + corrupt
  fixture + missing fixture.
- `tests/target-label.test.mjs` — target-label contract + drift
  guards.
- `tests/job-render.test.mjs` — job-status renderers walking
  running / finished / stored / cancelled job records; exercises
  the exact `pushJobDetails` path that a missed call site almost
  shipped a `ReferenceError` into.

### Added — CI pipeline

First real CI for this repo. Gates every PR and release against the
regression patterns found during this release's review passes.

- `.github/workflows/pr-check.yml` — syntax check, full test suite,
  path-leak guard, plugin manifest validation, CHANGELOG +
  Co-Authored-By checks on PRs.
- `.github/workflows/ai-quality-gate.yml` — `static-invariants`
  job encodes each class of bug fixed in this release as a grep
  invariant; a `cross-ai-review-advisory` job probes the PR
  comment thread when an AI identity authors a PR and prints an
  advisory if no counterpart AI has reviewed.
- `.github/workflows/verify-release.yml` — tag-triggered; verifies
  `package.json` / `plugin.json` / `marketplace.json` version
  parity with the tag, CHANGELOG entry present, release card
  `Status: READY`. Does NOT publish.
- `scripts/ci/check-*.sh` / `scripts/ci/check-cross-ai-review.mjs`
  — the individual gates; identical locally
  (`npm run ci:local`) and in workflow.
- `scripts/hooks/pre-push` + `scripts/install-hooks.sh` — local
  pre-push hook that mirrors the server gate.
  `npm run hooks:install` to wire up.
- Branch-protection setup helper —
  `scripts/setup/configure-gitea-protection.sh` (idempotent).
- Governance: `.github/PULL_REQUEST_TEMPLATE.md`,
  `.github/dependabot.yml` (weekly GitHub Actions bumps on the
  mirror), `CONTRIBUTING.md`, `docs/ci.md`.

### Fixed — metadata hygiene

- `.claude-plugin/plugin.json` + `marketplace.json` — `homepage`
  now points at the public GitHub mirror.
- `README.md` — install example uses the public URL; references
  to an internal orchestrator repo were removed (the harness that
  consumes this plugin is not open-source).
- Marketplace description trimmed of organization-specific framing.

### Changed — behavior

- Users with an already-corrupt `~/.config/glm-plugin-cc/config.json`
  or `state.json` who previously enjoyed silent masking will now
  see a clear error ("Could not parse …: delete or fix the file").
  Recovery: delete the file. Intended behavior change.

### Not changed

- Command surfaces (`/glm:setup` / `/glm:review` /
  `/glm:adversarial-review` / `/glm:task` / `/glm:rescue` /
  `/glm:status` / `/glm:result` / `/glm:cancel`) are unchanged on
  Claude-Code-invoked paths.

### Scaffold alignment note

Three of the root-cause bugs are inherited directly from the
`openai/codex-plugin-cc` v1.0.4 scaffold and may still affect that
plugin:

- `args.mjs` identical `split("=", 2)` pattern.
- `state.mjs loadState` / `saveState` identical fail-open + orphan.
- Single-template-for-both-review-modes — codex ships only
  `prompts/adversarial-review.md`, no balanced counterpart.

GLM has diverged on these toward fail-closed behavior. The other
fixes (template key mismatch in `runReview`, corrupt
`writeConfigFile` merge) are GLM-specific regressions introduced
during the `--base` / `--scope` flag adaptation and the
`preset-config` feature.

## v0.4.2 — 2026-04-20

Sync with upstream codex-plugin-cc v1.0.4 (released 2026-04-18). Of the
six commits between v1.0.3 and v1.0.4, five are not applicable to this
fork (GLM has no session runtime / no `xhigh` effort level / the
`$ARGUMENTS`-quoting and agent-frontmatter `model:` fixes already
landed here in v0.3.4 / v0.1.x). One — [codex-plugin-cc
#235](https://github.com/openai/codex-plugin-cc/pull/235) "route
/codex:rescue through the Agent tool to stop Skill recursion" — is a
direct structural parallel and is ported here.

### Changed

- `commands/rescue.md`:
  - Dropped `context: fork` frontmatter so the command runs inline in
    the parent session where the `Agent` tool is in scope.
  - Added `Agent` to `allowed-tools`.
  - Rewrote the routing prose to explicitly invoke
    `Agent(subagent_type: "glm:glm-rescue")` and warn against
    `Skill(glm:glm-rescue)` / `Skill(glm:rescue)` — the latter
    re-enters this command and hangs the session.

### Not changed

- Companion scripts, config shape, preset URLs, model defaults, auth
  — all unchanged. Existing `~/.config/glm-plugin-cc/config.json`
  keeps working without re-setup.

## v0.4.1 — 2026-04-20

Command-UX fix: `/glm:setup` and `/glm:status` were producing verbose
Chinese-prose wrappers around the companion JSON output (the model
added pre-picker narration, post-persist bulleted summaries, and
reformatted Case-D state as a Markdown list). Codex-plugin-cc's
equivalents just render stdout and move on. This release aligns with
that: the command markdown now explicitly instructs the model to
present stdout verbatim and adds no commentary.

Also fixed the `.claude-plugin/marketplace.json` schema error that
made `/plugin marketplace add https://github.com/sky-zhang01/glm-plugin-cc`
fail on Claude Code 2.1.x: `"source": "."` was rejected as `Invalid
input`; now uses `"./"` (matches `planning-with-files` and
`everything-claude-code` conventions).

### Changed

- `commands/setup.md`: rewritten codex-parity terse (~35 lines vs 133).
  Explicit "present stdout verbatim — no commentary / bullet summary /
  Chinese restatement" rule so the model stops wrapping the JSON
  report in extra prose.
- `commands/status.md`: removed the "GLM calls are stateless HTTP
  foreground …" preamble that codex `/codex:status` doesn't have.
- `.claude-plugin/marketplace.json`: `source: "."` → `source: "./"`.

### Not changed

- No companion script changes; no auth / config shape changes; no
  endpoint URL changes. Existing `~/.config/glm-plugin-cc/config.json`
  keeps working without re-setup.

## v0.4.0 — 2026-04-20

**Breaking auth change**: API key now persists to
`~/.config/glm-plugin-cc/config.json` (mode 0600) via `/glm:setup`
instead of reading from the `ZAI_API_KEY` environment variable.
Mirrors codex CLI's `~/.codex/auth.json` pattern (confirmed by [Issue
openai/codex#5212](https://github.com/openai/codex/issues/5212) closed
as "not planned" — codex rejected env-var-only mode, keeps auth.json
the single source).

Earlier releases (v0.1.0 → v0.3.4) advertised "API key never on disk"
as a red line. That rule was stricter than codex itself and created a
worse UX: users had to export `ZAI_API_KEY` in their shell rc before
anything worked. v0.4.0 accepts the same trade-off codex does —
on-disk + 0600 + user-home dir — for a one-step install experience.

### Changed

- `scripts/lib/preset-config.mjs`:
  - Config schema gains an `api_key` string field (max 512 chars,
    trimmed). `sanitizeConfig` validates length; arrays / non-objects
    still rejected.
  - New `resolveApiKeyFromConfig()` — separate function so the raw
    key only enters memory when the HTTP client explicitly needs it
    (keeps it out of `resolveEffectiveConfig` returns, which feeds
    setup reports and job records).
  - New `persistApiKey(key)` — writes `api_key` only, preserves
    preset / base_url / default_model.
  - Removed `api_key_env` from built-in preset definitions (was
    unused cosmetic metadata pointing at `ZAI_API_KEY`).
- `scripts/lib/glm-client.mjs`:
  - `resolveApiKey()` now reads from config file only; the env-var
    chain (`ZAI_API_KEY` / `Z_AI_API_KEY` / `GLM_API_KEY`) is
    **removed**.
  - `resolveBaseUrl()` no longer honors `ZAI_BASE_URL` override;
    base URL comes from the preset or its overrides in config.json.
  - `resolveModel()` no longer honors `GLM_MODEL` override; use
    `--model` or update `default_model` in config.json.
  - `GLM_TIMEOUT_MS` is retained (operational, not credential).
  - Auth-failure error messages now point users at `/glm:setup
    --api-key <key>` for key rotation.
- `scripts/glm-companion.mjs`:
  - `runSetup` accepts `--api-key <key>`; persists via
    `persistApiKey()`. Report says "stored api_key to ... (0600)" —
    never echoes the key value.
  - Setup report exposes `config.has_api_key: boolean` (not the key
    itself) so `--json` consumers can check without risking leaks.
- `scripts/lib/render.mjs`:
  - Setup report now shows `api_key: stored` or `api_key: (not set
    — run /glm:setup --api-key <key>)` in the human-readable block.
- `commands/setup.md`: Fully rewritten for the Claude-native paste
  flow — preset via `AskUserQuestion`, then natural-language prompt
  for the key. Extraction / anti-echo rules explicit. Shell-only
  path documented as alternative for users who want the key out of
  Claude session logs.
- `commands/rescue.md`, `agents/glm-rescue.md`: "no API key" guidance
  updated from env-var to `/glm:setup`.
- `README.md`: Auth section rewritten. Env override table trimmed
  (only `GLM_TIMEOUT_MS` remains).

### Migration for v0.3.x users

1. Upgrade the plugin to v0.4.0.
2. Run `/glm:setup --api-key <your-existing-key>` (you can copy the
   value from your `$ZAI_API_KEY` env var: `echo $ZAI_API_KEY` in a
   terminal, then paste).
3. `unset ZAI_API_KEY` in your shell rc (optional — it's now ignored).

No config auto-migration. The preset IDs / URLs / model defaults are
unchanged, so an existing `config.json` keeps working for
preset+base_url+default_model; only the key is now read from there.

### Security notes

- File mode 0600 on the config file (already in place since v0.3.4).
- `api_key` never appears in setup report output, job records,
  rendered review output, or error messages. Only a boolean
  `has_api_key` indicates presence.
- Length-validated to 1–512 chars to avoid oversized strings drifting
  into memory.
- Raw key still never transits through HTTPS logs — the sanitizer on
  endpoint URLs remains in place, and the `Authorization: Bearer`
  header is set at fetch time only.

## v0.3.4 — 2026-04-20

Install-path enablement + independent code review fixes. An
independent adversarial review over the full v0.3.3 repo surfaced 11
findings; 9 were verified and landed here (2 deferred with rationale).
All findings treated this as a pre-install bar, not polish.

### Added (marketplace-load path)

- `.claude-plugin/marketplace.json` — root-as-marketplace entry that
  exposes `glm` as a single plugin with `source: "."` so
  `/plugin marketplace add` can load the repo.
- `scripts/check-imports.mjs` — ESM import-resolution check for all 13
  lib modules. Wired into `npm run check` so v0.3.3-class broken imports
  fail loudly instead of passing `node --check`.

### Fixed (HIGH — pre-install blockers)

- **H1 / shell injection**: `$ARGUMENTS` now quoted as `"$ARGUMENTS"` in
  `commands/{adversarial-review,cancel,review,setup,status}.md`. Previously
  shell metachars in slash-command arguments could escape the `node` call
  and execute arbitrary shell.
- **H2 / broken SessionStart/End hook**: `scripts/session-lifecycle-hook.mjs`
  was importing `./lib/app-server.mjs` and `./lib/broker-lifecycle.mjs` —
  codex-plugin-cc scaffold residue that doesn't exist in this fork. Every
  Claude Code session start/end crashed the hook. Rewrote the hook as a
  stateless bookkeeping shim: append `GLM_COMPANION_SESSION_ID` env on
  start, prune this session's local job records on end. No broker /
  process-tree teardown needed (GLM is stateless HTTP; jobs run
  synchronously in the companion process).
- **H3 / silent fail-open on corrupt config**: v0.3.3 `resolveEffectiveConfig`
  delegated to `safeReadConfigOrNull` which swallowed JSON parse errors,
  unknown preset_id errors, and non-`https://` base_url errors — falling
  back to the built-in BigModel endpoint. A corrupt `custom` preset config
  would silently route review prompts + diffs to the default endpoint
  instead of failing. Now `resolveEffectiveConfig` calls `readConfigFile`
  directly (throws on corrupt config); missing file still returns null.
  `sanitizeConfig` now rejects arrays (`typeof [] === "object"` used to
  slip through).

### Fixed (MEDIUM)

- **M1 / URL echo in errors**: all error / status paths that mention the
  base URL now pass it through `sanitizeUrlForDisplay` to strip
  `user:pass@`, query string, and fragment before display. Defends
  against accidentally pasted credentials in `ZAI_BASE_URL` or
  `--base-url` being echoed to stdout / stored in job records.
- **M2 / state/job/log file perms**: `ensureStateDir` now creates dirs
  with mode 0700 (with defensive `chmodSync` for pre-existing dirs);
  `writeJobFile`, `saveState`, `createJobLogFile`, `appendLogLine`, and
  `appendLogBlock` now set mode 0600 + defensive chmod. Review prompts,
  git diffs, and GLM outputs live in these files and should not be
  world-readable on shared hosts.
- **M4 / log write failure mis-reported as NETWORK_ERROR**: `createProgressReporter`
  now isolates `appendLogLine` / `appendLogBlock` / `onEvent` exceptions
  so a read-only log dir or full disk can't bubble up into the fetch
  lifecycle and get mapped to NETWORK_ERROR.
- **M5 / custom URL with query string**: `normalizeBaseUrl` rewritten
  using `new URL()` so pathname stripping (`/chat/completions`) and
  query / fragment preservation are structural instead of regex-based.
  `applyPreset` similarly hardened.

### Fixed (LOW)

- **L1 / reasoningSummary dropped in success render**: `renderReviewResult`
  success path now reads `meta.reasoningSummary ?? parsedResult.reasoningSummary`
  (previously only the failure paths had the fallback).
- **L2 / job kind mislabel**: `getJobTypeLabel` was mapping `kind === "task"`
  and `jobClass === "task"` to `"rescue"`. Now the four real kinds
  (review / adversarial-review / task / rescue) map to themselves; legacy
  `jobClass` fallback preserved.

### Added (defensive)

- `failureShape` now uses `CONFIG_ERROR` when `resolveEndpoint` / `resolveModel`
  throws due to a bad config file; `MODEL_REJECTED` is reserved for vision
  deny-list rejections only.

### Deferred (low-impact under current design)

- **M3** (cancel not atomic vs later completion write): current cancel is
  bookkeeping-only per the README / stateless-HTTP semantics. Worth
  revisiting when / if background jobs or TeamCreate routing arrives.
- Nothing else from the review was suppressed.

### Install

```
/plugin marketplace add https://github.com/sky-zhang01/glm-plugin-cc
/plugin install glm@glm-plugin-cc
```

## v0.3.3 — 2026-04-20

Simplify thinking default: v0.3.2's per-command split was
over-engineered. Codex CLI itself doesn't split `model_reasoning_effort`
per task — it just uses a single `medium` default across all calls.
Match that: thinking defaults `on` globally; user can pass
`--thinking off` on any command for light calls.

### Changed

- `scripts/glm-companion.mjs`:
  - `runReview` still passes default `true` (unchanged behavior).
  - `runTask` now passes default `true` uniformly (was `rescueMode` in
    v0.3.2, meaning `task` defaulted `off`). Both `rescue` and `task`
    are now default `on`.
- `commands/task.md`: description updated — thinking defaults ON, not
  OFF.
- `commands/review.md`, `adversarial-review.md`, `rescue.md`,
  `agents/glm-rescue.md`: wording updated from "default on for this
  command" to "default on across all commands".
- `README.md` "Thinking / reasoning" section collapsed from per-command
  table to a single-sentence explanation.

### Non-breaking for most callers

- Users explicitly passing `--thinking on|off` keep exact prior
  behavior.
- Users calling `/glm:review`, `/glm:adversarial-review`, or
  `/glm:rescue` without `--thinking` keep exact v0.3.2 behavior
  (already defaulted `on`).
- Only change: `/glm:task` without `--thinking` now defaults `on`
  (was `off` in v0.3.2). Pass `--thinking off` to restore v0.3.2
  behavior on that command.

## v0.3.2 — 2026-04-20

Corrections to two v0.3.1 claims that were based on incomplete research.
Functional behavior changes: thinking defaults now split per command.
Non-breaking for configured endpoints / API keys / model names.

### Corrections

- **GLM generation ordering in README was wrong.** Listed `glm-4.6` as
  "previous-generation mid-tier" and `glm-4.7` as "previous-generation
  flagship" in the same tier. Official docs.bigmodel.cn confirms
  `glm-4.7` strictly succeeds `glm-4.6` ("surpassing GLM-4.6 across
  multiple dimensions"). Corrected ordering: `glm-5.1 > glm-5 >
  glm-5-turbo (current gen) > glm-4.7 (previous-gen flagship) > glm-4.6
  (older gen, aligned with Claude Sonnet 4)`.
- **Codex CLI default behavior claim was wrong.** v0.3.0 / v0.3.1 said
  "codex `--effort` defaults to unset → equivalent off". Actual codex
  CLI default per `developers.openai.com/codex/config-reference` is
  `model_reasoning_effort = "medium"` — reasoning ON by default. Our
  "thinking default off" was mis-aligned with codex, not aligned.

### Changed

- `scripts/glm-companion.mjs`: `parseThinkingFlag` now accepts a
  per-command default. Call sites pass task-appropriate defaults:
  - `runReview` (review + adversarial-review): default **on**
  - `runTask` with `rescueMode=true`: default **on**
  - `runTask` with `rescueMode=false` (plain `/glm:task`): default **off**
- `commands/review.md`, `commands/adversarial-review.md`,
  `commands/rescue.md`, `commands/task.md`, `agents/glm-rescue.md`:
  wording updated to reflect per-command defaults + codex-`medium`
  alignment.
- `README.md`: generation table rewritten with explicit `Tier` column
  and newest-first ordering. "Thinking / reasoning" section rewritten
  with per-command default table.

### Non-breaking

- `--thinking on|off` still overrides on every command.
- No config file changes; no preset URL changes; no API shape changes.
- Users with `--thinking` explicitly in their invocations keep exact
  prior behavior. Users who never pass `--thinking` will now get `on`
  for review/adversarial-review/rescue (previously `off`).

## v0.3.1 — 2026-04-20

Benchmark-informed default model correction. Functional API unchanged
from v0.3.0; only the default model changes.

### Changed

- `scripts/lib/model-catalog.mjs`: `DEFAULT_MODEL` `glm-4.6` → `glm-5.1`.
- `scripts/lib/preset-config.mjs`: all three preset `default_model`
  fields updated `glm-4.6` → `glm-5.1`.
- `README.md`: rewrote "Model configuration" section with the benchmark
  rationale + re-sorted the commonly-useful table.
- `commands/review.md`, `commands/rescue.md`, `agents/glm-rescue.md`:
  updated default model reference + guidance.

### Why

v0.3.0 defaulted to `glm-4.6` without actually cross-checking against
codex's CLI default. Codex CLI default = `gpt-5.4` (flagship), not
`gpt-5.4-mini` (subagent tier). Picking `glm-4.6` as our default left us
two generations below codex's default tier.

Benchmark check:

| Model | AA Intelligence Index | SWE-Bench Pro |
|---|---|---|
| `gpt-5.4` (codex default) | 57 | — |
| `glm-5.1` | 51 | **58.4** (beats gpt-5.4, Claude Opus 4.6, Gemini 3.1 Pro) |
| `glm-5` | 50 | — |
| `glm-4.6` (previous default) | (older tier) | — |

`glm-5.1` is the closest open-weights tier to `gpt-5.4` on general
intelligence and *leads* on the SWE-Bench Pro coding axis. It's included
in all 智谱 Coding Plan subscription tiers (Max/Pro/Lite) since
2026-03-28. BenchLM aggregate: `glm-5.1` (84) vs `gpt-5.4-mini` (73),
confirming the direction.

### Notes

- Users whose v0.3.0 `~/.config/glm-plugin-cc/config.json` already has
  `default_model: "glm-4.6"` keep that — config-file value wins over the
  built-in default. Re-run `/glm:setup --preset <id>` to refresh to the
  new default, or pass `--default-model glm-5.1` explicitly.
- Thinking still defaults off. Turning on `--thinking on` with `glm-5.1`
  is the strongest mode; it costs latency and token budget.

## v0.3.0 — 2026-04-20

**Breaking**: API format switched from Anthropic-compatible to
**OpenAI-compatible**. This plugin never was meant to replace GLM as a
Claude Code CLI provider; it calls GLM from inside a session over
OpenAI-compatible HTTP. Preset URLs updated accordingly. Users on v0.2.0
must re-run `/glm:setup` (no auto-migration — the previous Anthropic
URLs would 404 against the new client).

### Changed

- `scripts/lib/glm-client.mjs` rewritten:
  - Endpoint now `${base_url}/chat/completions` (was `/v1/messages`).
  - Auth now `Authorization: Bearer <key>` (was `x-api-key`).
  - Request body uses OpenAI `messages[]` schema; `system` promoted to a
    first-role message (was top-level `system`).
  - Response parses `choices[0].message.content` (was `content[].text`).
  - Extracts `choices[0].message.reasoning_content` when present, exposed
    to `render.mjs` as `reasoningSummary`.
- Preset URLs switched to 智谱 BigModel OpenAI-compatible endpoints:
  - `coding-plan` → `https://open.bigmodel.cn/api/coding/paas/v4`
    (was `https://api.z.ai/api/anthropic`)
  - `pay-as-you-go` → `https://open.bigmodel.cn/api/paas/v4`
    (was `https://open.bigmodel.cn/api/anthropic`)
  - `custom` unchanged in shape; now expects OpenAI-compatible URL.
- Fallback base URL when no preset/env is set: now
  `https://open.bigmodel.cn/api/paas/v4` (was `https://api.z.ai/api/anthropic`).
- Preset `display` text rebranded to 智谱 BigModel (国内 default); overseas
  Z.AI or self-hosted endpoints go through `custom`.
- `commands/setup.md` menu wording updated.
- `commands/review.md`, `adversarial-review.md`, `task.md`, `rescue.md`,
  `agents/glm-rescue.md`: documented `--thinking on|off` flag and text-only
  model constraint.

### Added

- `scripts/lib/model-catalog.mjs`:
  - `DEFAULT_MODEL` constant (`glm-4.6`).
  - `isVisionModel(model)` + `assertNonVisionModel(model)` — reject vision
    models (`glm-4v`, `glm-4.5v`, `glm-4.6v`, `glm-4.1v-thinking`, etc.)
    so text-review commands fail fast instead of silently wasting tokens.
- `--thinking on|off` CLI flag for `review`, `adversarial-review`, `task`,
  `rescue`. Default `off` matches codex `--effort unset`; GLM routes via
  `thinking: {"type": "enabled" | "disabled"}` request field.
- `resolveModel()` now validates the selected model against the vision
  deny-list before any HTTP call.

### Security

- Error message on non-https base URLs still truncates long inputs to
  avoid echoing accidentally-pasted credentials (carried from v0.2.0).
- API key still env-only, never persisted.
- `ZAI_BASE_URL` still rejected unless `https://`.

### Rationale

- Clarified architectural intent after confusion in v0.1/v0.2: this plugin
  calls GLM from *inside* a Claude session over OpenAI-compatible HTTP,
  it does not swap Claude for GLM at the CLI provider layer.
- 国内智谱 `open.bigmodel.cn` is the default; 海外 Z.AI is reachable via the
  `custom` preset. Users on v0.2.0 with an Anthropic-format Z.AI URL in
  their config.json need to re-run `/glm:setup` — the plugin will throw
  a clear 404 error if they don't, rather than silently failing.
- Single default model + `--thinking off` by default mirror the
  codex-plugin-cc pattern (no per-command splits; reasoning opt-in).

## v0.2.0 — 2026-04-20

Endpoint preset system + command-layer cleanup. Key UX change: `/glm:setup`
is now interactive (menu-driven via `AskUserQuestion`) for first-time
configuration; behavior for existing env-only users is unchanged.

### Added

- `scripts/lib/preset-config.mjs` with three built-in presets:
  - `coding-plan` → `https://api.z.ai/api/anthropic` (Z.AI subscription)
  - `pay-as-you-go` → `https://open.bigmodel.cn/api/anthropic` (BigModel metered)
  - `custom` → user-provided `https://` endpoint
- Endpoint config persists to `~/.config/glm-plugin-cc/config.json`
  (XDG_CONFIG_HOME honored). Dir 0700, file 0600. API key is **never**
  written to disk — always read from `ZAI_API_KEY` env.
- `glm-companion.mjs setup` accepts `--preset`, `--base-url`,
  `--default-model`.
- `renderSetupReport` shows current endpoint config, env overrides, and
  all available presets.

### Changed

- Endpoint priority now: `ZAI_BASE_URL` env > config file preset >
  built-in fallback (`api.z.ai`). Model priority: `--model` arg >
  `GLM_MODEL` env > config `default_model` > `glm-4.6`.
- `commands/setup.md` rewritten to use `AskUserQuestion` menu for
  first-time setup. Removes the copy-paste `npm install -g` block that
  was incorrect (GLM has no external CLI — plugin IS the runtime).
- `commands/review.md` + `commands/adversarial-review.md` drop the
  `--wait` / `--background` argument-hint lies. Companion is sync-only.
  Both commands now correctly document sync foreground execution.
- `commands/status.md` drops `--wait` / `--timeout-ms` (polling
  leftovers from codex scaffold).
- `commands/cancel.md` description clarified: marks local record only,
  no server-side abort (GLM is stateless HTTP).
- `review.md` removed incorrect claim that focus text is unsupported.

### Security

- Config file written with mode 0600 (owner-only read/write).
- Config dir created with mode 0700, with a follow-up `chmodSync` in case
  the dir pre-existed with looser perms (defense-in-depth).
- `writeConfigFile` writes to a `.tmp-<pid>-<epoch>` file then
  `renameSync` — atomic swap prevents half-written state from concurrent
  `/glm:setup` runs.
- `applyPreset` and `sanitizeConfig` reject non-`https://` base URLs.
  Error messages truncate over-long URLs to avoid echoing
  accidentally-pasted credentials.
- No API key ever written to disk; env-only by design.

## v0.1.1 — 2026-04-20

Post-review fixes from internal review passes.

- Add missing `commands/task.md`: `/glm:task` was documented +
  dispatched but no slash-command frontmatter existed; Claude Code
  wouldn't register it.
- Enforce `https://` on `ZAI_BASE_URL` env override: plaintext
  endpoint would leak API key. Override now throws if scheme is not
  https.
- Validate job IDs and enforce path containment in
  `scripts/lib/state.mjs:resolveJobFile` / `resolveJobLogFile`:
  defense-in-depth against path traversal via malicious
  `--job-id ../../etc/passwd`. Pattern:
  `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`, max 128 chars; resolved path must
  stay inside jobs dir.

## v0.1.0 — 2026-04-20

Initial release.

- Plugin manifest (`.claude-plugin/plugin.json`) with 7 commands:
  `/glm:setup`, `/glm:review`, `/glm:adversarial-review`, `/glm:task`,
  `/glm:rescue`, `/glm:status`, `/glm:result`, `/glm:cancel`.
- `glm-rescue` subagent for delegated rescue workflows.
- GLM HTTP client (`scripts/lib/glm-client.mjs`): stateless POST to
  `https://api.z.ai/api/anthropic/v1/messages` with `x-api-key` auth.
  Handles 429 / 401 / 403 / 400 / timeout / network errors explicitly.
- Session-lifecycle hook retained from codex-plugin-cc scaffold for
  job-state bookkeeping.
- Stop-review-gate hook **omitted** by design: the SEV `/verify`
  layer is the single Stop gate for the broader orchestration, not
  this plugin.
- Zero runtime npm dependencies. Node >=18.18 required (for global
  `fetch`).
- Derived scaffold from `openai/codex-plugin-cc` (Apache-2.0);
  backend-specific code is original.
