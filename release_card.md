# Release Card — glm-plugin-cc v0.4.7 (beta1 cut 2026-04-22)

Status: READY — beta1 prerelease scope

Approval Mode: maintainer direct-approval (solo-maintainer repo; same
pattern as v0.4.4 / v0.4.5 / v0.4.6). Gitea CI green → maintainer
auto-merge per standing one-off-per-release shortcut. Not promoted
into CONTRIBUTING.md. Beta1 cut mid-release because Phase 7d power-up
sweep is long-running (~8-10h wall time) and the rest of v0.4.7
content — code, docs, 149-run data — is already locked; cutting
beta1 now lets the interim snapshot be audited against a stable ref.

Intended Ref (beta1)
- Feature branch: `fix/v047-review-reliability-mvp` off `develop`
- PR: `fix/v047-review-reliability-mvp` → `develop` (Gitea)
- PR: `develop` → `main` (Gitea)
- Tag: `v0.4.7-beta1` annotated, on the `develop → main` merge commit
- **Gitea release**: marked `Prerelease`, **NOT Latest**
- **GitHub release**: marked `Prerelease`, **NOT Latest** (v0.4.6 stays Latest)

Intended Ref (v0.4.7 final — after Phase 7d)
- Follow-up commit that writes Phase 7d effective-N and Fisher-exact
  numbers into CHANGELOG tables + bumps manifest versions from
  `0.4.7-beta1` → `0.4.7`
- Tag: `v0.4.7` annotated
- Gitea + GitHub release: marked `Latest`
- Gitea issue #7: close at this point, not at beta1

---

## Requested Scope

Tracked under Gitea issue #7. Three aligned additions motivated by the
v0.4.5 SCHEMA_ECHO dogfood observation + the 2026-04-21
workflow-governor cross-review hallucination session:

1. **Parse-layer defenses** that run unconditionally on every review
   response, independent of model version or sampling parameters. These
   are pure JSON-processing code — cheap, idempotent, and they do not
   change the GLM request shape.

   - `stripMarkdownFences` removes `` ```json ... ``` `` wrappers that
     GLM-5.1 occasionally emits around structured output despite the
     prompt instruction.
   - `classifyReviewPayload` reproduces the two observed semantic
     failures (SCHEMA_ECHO = returned schema definition instead of
     findings; INVALID_SHAPE = missing required fields) with typed
     `errorCode` values the companion + caller can branch on.
   - `runChatRequestWithCorrectionRetry` adds a single-shot targeted
     re-prompt when the above are detected. Separate mechanism from
     the v0.4.6 transient-error backoff layer (different failure
     class; no attempt-budget overlap).

2. **Sampling-parameter CLI flags** (`--temperature`, `--top-p`,
   `--seed`, `--frequency-penalty`, `--presence-penalty`) on `/glm:review`
   and `/glm:adversarial-review`, forwarded to the BigModel POST body
   only when provided. Unset = server default = no behavior change.
   Out-of-range values are silently skipped so sweep automation never
   crashes mid-run.

3. **Three-fixture evaluation harness** (`test-automation/review-eval/`)
   — pinned fixtures at three scales (C1 small ~440 lines / C2 medium
   ~1550 lines / C3 large ~8336 lines), automated citation scoring via
   file-existence + distinctive-token grep, CSV results format stable
   across releases, per-run sidecar payload capture for offline audit.
   Ships with both the initial 9-call sanity-sweep data
   (`sanity-sweep.csv`) and the 149-run four-phase expanded-sweep
   data (`expanded-sweep.csv`) so future sweeps can diff against
   either baseline.

4. **Extended parse-failure classifier** added post-expanded-sweep.
   The initial 9-run sweep (medium diff) produced a schema=0 cell
   that user push-back correctly identified as possibly underpowered.
   The 54-run expanded sweep on C1/C2/C3 surfaced five distinct
   parse-failure modes that the initial `classifyReviewPayload` did
   not cover — all now typed and correction-hinted:
   - `EMPTY_RESPONSE`, `REASONING_LEAK`, `MARKDOWN_FENCE_UNTERMINATED`,
     `TRUNCATED_JSON`, `PARSE_FAILURE`.
   - `stripMarkdownFences` also extended with open-only and close-only
     half-fence fallbacks.
   - 15 new unit tests, total suite 149/149 passing (then expanded
     to 156/156 in post-phase-7a with 7 new bigmodel-errors tests).

## Out of Scope

- **No default sampling parameter change.** Sweep expanded in four
  phases to 149 total runs, reaching effective N=14-17 per cell on
  C1 and C3 (Phase 7c N≥14 fill). At that sample size, every pairwise
  Fisher exact test on C3 schema compliance returns p > 0.3, and the
  observed ordering is non-monotonic (t=0.5 worst, t=0 best, t=1
  middle); C1 is 49/49 across temperatures. Design power at this N
  for a ~15pct per-step effect is approximately 16%, so the result
  is "no detected effect at this sample size", not "no effect
  exists". The plugin ships no default temperature change because
  there is no detected effect to justify one; server default (unset)
  is preserved. Issue #7 is closed with the current picture
  documented; a future powered test would need ~80+ runs per cell.
- **~~No BigModel error-code table update~~** — CANCELED. The sweep
  across 149 runs surfaced 6 × `1234` and 3 × `500` (combining
  raw-code and typed-code variants) plus 3 × EMPTY_RESPONSE.
  Cross-checking https://docs.bigmodel.cn/cn/faq/api-code confirmed
  both codes are documented (1234 = upstream network error, 500 =
  upstream internal error), plus 3 more codes the v0.4.6 snapshot
  missed (1311, 1312, 1313). Table expansion now ships in v0.4.7 —
  see "Added" in CHANGELOG.
- **~~No C1 (small) / C3 (large) fixtures~~ — SUPERSEDED.** The
  original v0.4.7 sanity-sweep scope was C2 only; when the 9-call
  sanity data proved too thin, the scope expanded to add C1 (440
  lines, 6 files) and C3 (8336 lines, 84 files) in commit 7a971a7
  so the 149-run sweep could cover small/medium/large. v0.4.7 now
  ships all three fixtures.
- **No RAG / fine-tuning / context-packing variant.** Out-of-scope per
  user pushback — those are not review-workflow solutions, they're
  different product surfaces.
- **No changes to** GLM HTTP call shape (except conditional POST body
  sampling fields), model catalog, schema, prompts, `/glm:setup`,
  `/glm:status`, `/glm:result`, `/glm:cancel`, `/glm:task`.

## Planned Actions

1. Branch `fix/v047-review-reliability-mvp` off `develop` ✓
2. Add `stripMarkdownFences` / `classifyReviewPayload` /
   `buildCorrectionHint` / `runChatRequestWithCorrectionRetry` /
   `assignOptionalSamplingParam` to `scripts/lib/glm-client.mjs` ✓
3. Wire sampling flags through `scripts/glm-companion.mjs runReview` ✓
4. Extend `commands/review.md` + `commands/adversarial-review.md`
   argument hints + scope flags section ✓
5. Add `tests/review-payload.test.mjs` (19 tests) ✓
6. Build `test-automation/review-eval/` harness (fixture, ground truth,
   run-experiment.mjs, summarize.mjs) ✓
7. Open Gitea issue #7 with full investigation scope + hypotheses ✓
8. Commit infra checkpoint (60c7a1a) pre-sweep ✓
9. Run 9-call sanity sweep: temp ∈ {0.0, 0.5, 1.0} × N=3 on C2 ✓
10. Record result CSV in `test-automation/review-eval/results/v0.4.7/` ✓
11. Add `--base` flag to run-experiment.mjs so future fixtures can
    pin arbitrary base refs ✓
12. Bump 0.4.6 → 0.4.7 (package.json + plugin.json + marketplace.json) ✓
13. CHANGELOG v0.4.7 section with sweep outcome table ✓
14. **(Added post-user-pushback)** Harness strictness realignment +
    raw-payload sidecar capture (commit 66ba99c) ✓
15. **(Added)** C1 (small) + C3 (large) fixtures + path-leak exclusion
    (commit 7a971a7) ✓
16. **(Added)** 54-run B+D+E expanded sweep on 3 fixtures ✓
17. **(Added)** `classifyParseFailure` for 5 parse-failure modes +
    `stripMarkdownFences` half-fence fallbacks + 15 new unit tests ✓
18. **(Added)** CHANGELOG v0.4.7 rewrite with expanded-sweep outcome
    table + C3 scale-effect flag for v0.4.8 ✓
19. **(Added post-phase-7a)** Adaptive sampling — 15 targeted runs
    consolidating 5 signal-of-interest cells to N=6 rather than
    uniform re-sampling. Revealed vendor-error clustering (3/3 at C3
    t=0.5 were VENDOR_ERROR:1234/500), which explained the N=3
    "temperature signal" illusion. ✓
20. **(Added post-phase-7a)** BigModel error-code table expansion:
    500, 1234, 1311, 1312, 1313 added per official docs recheck.
    Table grew from 7 to 12 known codes. ✓
21. **(Added post-phase-7a)** 7 new unit tests for the 5 new vendor
    codes + retry-semantic partitioning. Total suite: 156/156. ✓
22. **(Added post-phase-7a)** CHANGELOG update: vendor-error
    expansion added to Added section, Changed section notes the
    table growth, outcome table expanded to include N=6 cells +
    error_code distribution histogram. ✓
22b. **(Added post-phase-7b)** Effective-N fill: +16 targeted runs
    on 5 cells previously polluted by Phase 7a upstream failures,
    so every cell has ≥5 effective model-behavior samples. Zero
    upstream errors in Phase 7b confirms vendor errors are
    time-correlated BigModel transient instability. C1 100%/100%/100%
    schema on effective N; C3 temperature chain refined to
    83%/71%/67% (Fisher p ≈ 0.5, not significant at N=6-7). CHANGELOG
    + release_card updated to replace earlier "unambiguous C3
    temperature signal" narrative with "mild, inconclusive at N=6". ✓
22c. **(Added post-phase-7c, per user directive "all open questions
    resolved in this version, not v0.4.8")** N≥14 fill: +64
    targeted runs in parallel from two detached worktrees (C3 from
    `/tmp/glm-eval-A` at d5fa754: +30; C1 from `/tmp/glm-eval-B` at
    7766943: +34). Every C1 and C3 cell now has effective N≥14.
    [Phase 7d N=80 power-up sweep kicked off subsequently — in
    flight at time of commit; see Local Verification.]
    Results: C1 schema 16/16, 16/16, 17/17 (100% across temps); C3
    schema 13/14 (93%), 13/17 (76%), 12/14 (86%) — pairwise Fisher
    exact p = 0.344 / 1.000 / 0.664 (all non-significant), ordering
    non-monotonic. Design power at this N for a ~15pct per-step
    effect is ~16%, so the C3 temperature finding is "no detected
    effect at this sample size", not "no effect exists". Per-finding
    C1 citation audit (93 findings from 49 sidecars): 0 out-of-
    allowed files, 0 known-false files. 41.9% are IN_ALLOWED with
    line-range tokens not found; a post-audit spot-check surfaced at
    least one line-level content fabrication (e.g. fictional
    `@anthropics → @anthropic-ai` rename claim) that the scoring
    rubric's token-in-window check does not catch, so the claim is
    narrowed to "0 wrong-file citations" rather than "0 fabrication".
    CHANGELOG rewritten to reflect underpowered-null framing;
    `commands/review.md` gains "Diff size guidance" section;
    `commands/adversarial-review.md` sampling bullet aligned. No
    prompt or default-sampling change ships in v0.4.7. ✓
23. `Skill(simplify)` on N=149 doc diff — **DONE** (3-agent parallel
    + Python factual audit; caught 134-vs-127 success-count mismatch
    + 47/48-vs-40/42 C2 mismatch + stale `7/85`/`91.3%` numbers, all
    corrected pre-commit).
24. `npm run ci:local` — **DONE** (156/156 green); re-run after
    Codex F-1..F-5 fixes — pending
25. Adversarial review (Codex primary) — **DONE**. Verdict:
    REQUEST_CHANGES with 5 findings:
      - F-1 HIGH: success count 134→127 (schema_compliance, not blank
        error_code). Fixed in CHANGELOG outcome table.
      - F-2 HIGH: "0 fabrication" narrowed to "0 out-of-allowed
        files"; line-level content fabrication observed (fictional
        `@anthropics → @anthropic-ai` rename claim) and documented
        as scoring-rubric limitation.
      - F-3 HIGH: "decisive null" rephrased to "not detected at this
        N (~16% power)" across CHANGELOG / release_card /
        commands/review.md / commands/adversarial-review.md.
      - F-4 MEDIUM: raw vs typed 1234/500 attribution clarified —
        every raw code is pre-Phase-7c; Phase 7c worktrees correctly
        emitted typed codes.
      - F-5 MEDIUM: stale "No C1/C3 fixtures" bullet in release_card
        and test-automation/review-eval/README.md marked SUPERSEDED.
    Optional step 25b: re-query Codex with the fixes applied.25b. Optional Codex re-verify after F-1..F-5 fixes — pending user
    decision (can ship citing REQUEST_CHANGES→addressed in PR body
    instead).
25c. **(Added post-Codex-review-round-2, per user directive "这块
    很重要 社区到底在怎么解决这块的问题")** Codex community research
    pass on anti-hallucination solutions (CoVe, Self-Consistency,
    SelfCheckGPT, RAG grounding, Guardrails/NeMo, Pydantic AI,
    constrained decoding, attribution-faithfulness). Output:
    `docs/anti-hallucination-roadmap.md` with Tier 1/2/3 landing
    plan + literature citations (Dhuliawala 2023, Wang 2023,
    Manakul 2023, Farquhar 2024, Wallat 2024). v0.4.7 ships Tier 1
    #3 only (`response_format: json_object` on every review call,
    confirmed supported by GLM-5.x via `docs.z.ai`); #1 content
    verifier + #2 schema anchors deferred to v0.4.8 under proper
    design gate. Rationale: #1/#2 change production review output
    and need design-gate discussion before rushing into release
    tail. ✓
25d. **(Added with 25c)** Extracted `buildChatRequestBody` as pure
    exported helper in `glm-client.mjs` so response_format + sampling
    + thinking-mode body shape is unit-testable. 14 new tests in
    `tests/chat-request-body.test.mjs`. Total suite: 170/170 green. ✓
25e. **(Pending — in flight)** Phase 7d N=80 power-up sweep (C3 +225
    runs for ~80% Fisher exact power, C1 +83 runs to effective
    N=40 for confirmation). Wall time ~8-10 hours single-threaded
    on C3; parallel-worktree pattern halves to ~max(A,B). In flight
    on 2 detached worktrees at time of commit. Results will update
    § Expanded-sweep outcome + § Effective-N analysis post-sweep
    via an amendment commit or separate v0.4.7-post-sweep rev.
26. Push to Gitea only. Open PR → `develop`. Paste adversarial verdict
    in PR body. — pending
27. Gitea CI green → auto-merge PR to develop — pending
28. Open Gitea PR: develop → main. Merge. — pending
29. Tag v0.4.7 annotated on main merge commit. Pre-push hook runs
    `check-release-ready.sh v0.4.7`. — pending
30. Publish Gitea release v0.4.7 (Latest auto-set) — pending
31. Sync main + develop + tag to GitHub. Confirm PR Check + AI Quality
    Gate green — pending
32. Publish GitHub release v0.4.7, mark Latest — pending
33. Fast-forward develop → main on both remotes (GitFlow cleanup) —
    pending
34. Upgrade local plugin cache to v0.4.7 — pending
35. Close Gitea issue #7 with link to CHANGELOG entry + final 149-run
    CSV. No v0.4.8 follow-up issue — all in-flight questions resolved
    in this release. — pending

## Scope Completion: will reach COMPLETE at step 35
## Outstanding In-Scope Work: step 23 (simplify pass done for N=149 doc diff — clean), step 24 re-run after Codex F-1..F-5 fixes, step 25 adversarial (Codex returned REQUEST_CHANGES; 5 findings addressed, optional re-verify), steps 26-35 pending

## Major Upgrade Review: N/A

No dependency bumps, Action SHA changes, Node version bumps, or
runtime/platform changes. Pure additive parse-layer code + CLI-flag
forwarding + evaluation harness. No change to the GLM endpoint, model,
prompt, or request shape (except conditional sampling-param fields in
the POST body when the caller explicitly passes a flag).

## Breaking Changes: none

- `classifyReviewPayload` runs after successful JSON parse and only
  affects requests with `expectJson: true` (review calls). Non-review
  calls (`/glm:task`) are untouched.
- `runChatRequestWithCorrectionRetry` intercepts `retry: "correction"`
  failures between `withRetry` iterations; it does not consume the
  transient-backoff attempt budget, does not change v0.4.6 behavior on
  HTTP/network errors, and opts out automatically for non-review calls.
- Markdown fence stripping is idempotent on already-clean JSON (no
  change if no fence present).
- Sampling CLI flags are optional. Unset = server default = v0.4.6
  behavior.
- New CSV under `test-automation/review-eval/results/v0.4.7/` is
  data-only; no CI or runtime consumes it.

## Repo Usage Audit

- Modified: `scripts/lib/glm-client.mjs` (+223 lines: parse helpers,
  classifier, correction-retry wrapper, sampling-param dispatcher;
  existing functions unchanged in signature).
- Modified: `scripts/glm-companion.mjs` (+43 lines: CLI flag parsing,
  forwarding into `runGlmReview` options, updated printUsage).
- Modified: `commands/review.md`, `commands/adversarial-review.md`
  (argument-hint extension + scope-flags doc pointer to issue #7).
- New: `tests/review-payload.test.mjs` (initial 19 tests + 15 added
  post-expanded-sweep for half-fences + 5-mode parse-failure classifier
  = 34 total).
- New: `test-automation/review-eval/` directory
  - `corpus/C1-v044-setup-menu/` (small fixture, 440 lines, 6 files)
  - `corpus/C2-v046-aftercare/` (medium fixture, 1550 lines, 11 files)
  - `corpus/C3-v04x-cumulative/` (large fixture, 8336 lines, 84 files)
  - `scripts/{run-experiment,summarize}.mjs` — run-experiment extended
    with raw-payload sidecar capture + `--base` flag + schema-check
    alignment to classifyReviewPayload
  - `results/v0.4.7/sanity-sweep.csv` (initial 9 runs, v1 strictness)
  - `results/v0.4.7/expanded-sweep.csv` (149 runs: 54 Phase 4/5 +
    15 Phase 7a + 16 Phase 7b + 64 Phase 7c N≥14 fill)
  - `results/v0.4.7/payloads/` (149 sidecar JSON files spanning all
    four phases)
- Modified: `scripts/ci/check-no-local-paths.sh` (exclude
  review-eval corpus + results paths from path-leak scanner).
- Version bump in 3 manifest files + CHANGELOG v0.4.7 rewrite with
  expanded-sweep outcome table.
- Gitea issue #7 opened + commented with scope reduction (β) +
  expanded (B+D+E mix).

## Verification Plan

| Layer | Tool | Pass criterion |
|---|---|---|
| Static | `npm run check` | All modules parse; import graph resolves |
| Unit | `npm test` | 156/156 pass (115 baseline + 34 review-payload + 7 bigmodel-errors new) |
| Manifest | `check-plugin-manifest.sh` | Version 0.4.7 consistent across 3 JSON files |
| CHANGELOG | `check-changelog-updated.sh` | `## v0.4.7` section present |
| Leak guard | `check-no-local-paths.sh` | No internal paths leaked (corpus/results excluded) |
| Cross-AI | `check-cross-ai-review.mjs` | adversarial review referenced |
| Companion UAT | reuse v0.4.5 scenarios | Still PASS — v0.4.7 additive only |
| Adversarial | `/codex:adversarial-review` preferred, else `/glm:adversarial-review` | No unresolved CRITICAL/HIGH |
| Gitea CI | `ai-quality-gate.yml` + `pr-check.yml` | both green |
| GitHub CI | same 2 workflows | both green |
| **Release gate** | `bash scripts/ci/check-release-ready.sh v0.4.7` | All 4 checks pass (runs automatically in pre-push on tag push) |
| **Expanded sweep data** | `node test-automation/review-eval/scripts/summarize.mjs results/v0.4.7/expanded-sweep.csv` | 149 rows, 0 SCHEMA_ECHO, 0 known_false_files hits across all 149 runs, 0 out-of-allowed citations on C1. Effective-N: C1=100%/100%/100% (N=16-17), C2=95% (40/42 across 12 cells), C3=93%/76%/86% (N=14-17). Fisher exact on C3 all pairwise p>0.3. Upstream failures 13/149 (8.7%) time-correlated across phases. |

## Local Verification

- `npm test` green (156/156) at commit prior to Phase 7c doc updates.
- Phase 7c sweep executed 2026-04-21 across ~82 minutes wall time: 30
  C3 runs from `/tmp/glm-eval-A` (detached at d5fa754) + 34 C1 runs
  from `/tmp/glm-eval-B` (detached at 7766943), all appended cleanly
  to `expanded-sweep.csv` (149 unique timestamps, zero parallel-append
  collisions). 4 upstream errors out of 64 Phase 7c runs; all other
  60 runs produced valid schema payloads with typed correction-retry
  paths exercised where needed.
- To be appended after step 24 re-run + step 25 adversarial review:
  final `npm run ci:local` result post-doc-updates + Codex/GLM
  adversarial verdict.

## CI Evidence

To be populated after Gitea feature PR + main PR CI runs complete.

## Rollback

Extremely low risk.

- **Immediate**: `git revert` the feature PR merge commit on main. The
  parse-layer defenses + sampling CLI flags stop running; v0.4.6
  behavior restored. Evaluation harness files remain (they're
  self-contained under `test-automation/` and do not execute at
  runtime).
- **Full**: revert to v0.4.6 tag, delete tag v0.4.7, unmark GitHub
  release Latest, re-mark v0.4.6 Latest.
- Zero config-file mutations by this release; users never need to
  re-run `/glm:setup`.
- Sanity-sweep CSV is informational only; deleting it would have no
  functional effect.
