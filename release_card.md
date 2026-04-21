# Release Card — glm-plugin-cc v0.4.7

Status: READY

Approval Mode: maintainer direct-approval (solo-maintainer repo; same
pattern as v0.4.4 / v0.4.5 / v0.4.6). Gitea CI green → maintainer
auto-merge per standing one-off-per-release shortcut. Not promoted
into CONTRIBUTING.md.

Intended Ref
- Feature branch: `fix/v047-review-reliability-mvp` off `develop`
- PR: `fix/v047-review-reliability-mvp` → `develop` (Gitea)
- PR: `develop` → `main` (Gitea)
- Tag: `v0.4.7` annotated, on the `develop → main` merge commit
- Mirrored: GitHub public repo (main + tag + release, marked Latest)

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
   (`sanity-sweep.csv`) and the expanded 54-run B+D+E matrix data
   (`expanded-sweep.csv`) so v0.4.8+ can diff against either baseline.

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

- **No default sampling parameter change.** The initial 9-call sanity
  sweep was followed up with a 54-run B+D+E expanded matrix (3 fixtures
  × up to 4 seeds × 3 temps × N=3). Even at the expanded scope, N=3
  per cell is too thin to justify a release-wide default shift. The
  data surfaces a clear C3 large-diff scale effect
  (schema_compliance 0.67 / 0.33 / 0.00 at temp 0 / 0.5 / 1) that is
  the v0.4.8 investigation priority — a focused C3 sweep with N ≥ 10
  per temperature would determine whether `temperature=0.2` should
  become the review-specific default.
- **~~No BigModel error-code table update~~** — CANCELED. Phase 7a
  consolidated the vendor-error observation to 5×1234 + 2×500 across
  85 runs (69 + 16 from Phase 7b effective-N fill). Cross-checking https://docs.bigmodel.cn/cn/faq/api-code
  confirmed both codes are documented (1234 = upstream network error,
  500 = upstream internal error), plus 3 more codes the v0.4.6
  snapshot missed (1311, 1312, 1313). Table expansion now ships in
  v0.4.7 — see "Added" in CHANGELOG.
- **No C1 (small) / C3 (large) fixtures.** v0.4.7 ships only the C2
  medium fixture. Adding smaller or larger fixtures is deferred until
  a regression actually motivates them.
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
23. `Skill(simplify)` on changed files — pending
24. `npm run ci:local` — **DONE** (156/156 green)
25. Adversarial review (Codex primary if quota allows, else GLM
    fallback) — pending
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
35. Close Gitea issue #7 with link to CHANGELOG entry + final CSV,
    and open v0.4.8 follow-up issue for focused C3 sweep — pending

## Scope Completion: will reach COMPLETE at step 35
## Outstanding In-Scope Work: steps 23, 25-35 pending (24 DONE)

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
  - `results/v0.4.7/expanded-sweep.csv` (85 runs: 54 Phase 4/5 +
    15 Phase 7a + 16 Phase 7b effective-N fill)
  - `results/v0.4.7/payloads/` (85 sidecar JSON files: 54 Phase 4/5
    + 15 Phase 7a + 16 Phase 7b)
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
| **Expanded sweep data** | `node test-automation/review-eval/scripts/summarize.mjs results/v0.4.7/expanded-sweep.csv` | 85 rows, 0 SCHEMA_ECHO, 0 false_file_hits, 8/18 cells PASS raw; after effective-N filter C1=100%/100%/100%, C2=97%, C3=83%/71%/67%. Upstream failures 9/85 (10.6%) all in Phase 7a time window; Phase 7b zero upstream failures. |

## Local Verification

To be populated after `ci:local` + adversarial review complete. Sanity
sweep already executed (9 calls on 2026-04-21, all from detached
worktree at d5fa754 to match fixture baseline; CSV committed).

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
