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

3. **Evaluation harness** (`test-automation/review-eval/`) — pinned
   fixture (C2, the v0.4.5→v0.4.6 diff), automated citation scoring
   via file-existence + distinctive-token grep, CSV results format
   stable across releases. Ships with the v0.4.7 9-call sanity-sweep
   results so the next release can diff rather than re-instrument.

## Out of Scope

- **No default sampling parameter change.** The 9-call sanity sweep
  (issue #7 comment 2026-04-21, maintainer-approved β scope) did not
  surface signal strong enough to justify changing server-default
  temperature / top_p / seed. Per the maintainer directive ("model
  updates faster than experimental data stays valid"), scope was
  intentionally capped at 9 calls rather than the originally-proposed
  96-cell grid.
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
14. `Skill(simplify)` on changed files — pending
15. `npm run ci:local` — pending
16. Adversarial review (Codex primary if quota allows, else GLM
    fallback) — pending
17. Push to Gitea only. Open PR → `develop`. Paste adversarial verdict
    in PR body. — pending
18. Gitea CI green → auto-merge PR to develop — pending
19. Open Gitea PR: develop → main. Merge. — pending
20. Tag v0.4.7 annotated on main merge commit. Pre-push hook runs
    `check-release-ready.sh v0.4.7`. — pending
21. Publish Gitea release v0.4.7 (Latest auto-set) — pending
22. Sync main + develop + tag to GitHub. Confirm PR Check + AI Quality
    Gate green — pending
23. Publish GitHub release v0.4.7, mark Latest — pending
24. Fast-forward develop → main on both remotes (GitFlow cleanup) —
    pending
25. Upgrade local plugin cache to v0.4.7 — pending
26. Close Gitea issue #7 with link to CHANGELOG entry + final CSV —
    pending

## Scope Completion: will reach COMPLETE at step 26
## Outstanding In-Scope Work: steps 14-26 pending

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
- New: `tests/review-payload.test.mjs` (184 lines, 19 tests).
- New: `test-automation/review-eval/` directory
  (README + corpus/C2-v046-aftercare/{meta,ground-truth,diff.patch} +
  scripts/{run-experiment,summarize}.mjs + results/v0.4.7/sanity-sweep.csv).
- Version bump in 3 manifest files + CHANGELOG v0.4.7 section.
- Gitea issue #7 opened + commented with scope reduction (β).

## Verification Plan

| Layer | Tool | Pass criterion |
|---|---|---|
| Static | `npm run check` | All modules parse; import graph resolves |
| Unit | `npm test` | 134/134 pass (115 existing + 19 review-payload) |
| Manifest | `check-plugin-manifest.sh` | Version 0.4.7 consistent across 3 JSON files |
| CHANGELOG | `check-changelog-updated.sh` | `## v0.4.7` section present |
| Leak guard | `check-no-local-paths.sh` | No internal paths leaked |
| Cross-AI | `check-cross-ai-review.mjs` | adversarial review referenced |
| Companion UAT | reuse v0.4.5 scenarios | Still PASS — v0.4.7 additive only |
| Adversarial | `/codex:adversarial-review` preferred, else `/glm:adversarial-review` | No unresolved CRITICAL/HIGH |
| Gitea CI | `ai-quality-gate.yml` + `pr-check.yml` | both green |
| GitHub CI | same 2 workflows | both green |
| **Release gate** | `bash scripts/ci/check-release-ready.sh v0.4.7` | All 4 checks pass (runs automatically in pre-push on tag push) |
| **Sanity sweep data** | `node test-automation/review-eval/scripts/summarize.mjs results/v0.4.7/sanity-sweep.csv` | 9 rows, no SCHEMA_ECHO, no false_file_hits |

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
