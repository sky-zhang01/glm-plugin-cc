# Release Card — glm-plugin-cc v0.4.8

Status: READY — manifests bumped 0.4.7 → 0.4.8 (3 files); CHANGELOG header de-`(unreleased)`; release_card finalized.

Approval Mode: `release/v0.4.8` is authored by claude-code and reviewed/merged by codex as the non-author reviewer. Later `develop` → `main`, tag, and release-object actions remain maintainer-controlled release actions. Cross-AI review (claude-code session reviewing codex-authored PRs and vice versa) is explicitly downgraded to **dual-token user-bypass** label per L0/L1 governance landed during this cycle (see `~/.claude/scripts/gitea_rest_common.sh` + Gitea issue #26). v0.4.8 is not promoted into CONTRIBUTING.md as standing policy; it is the current observed pattern.

## Intended Ref (v0.4.8)

- Pre-tag commit on `develop`: `2080924d7fdcc9e0fdace1ee0d070c9829ea5994` (= PR #36 merge by sky, post-mirror to GitHub)
- Manifest bump branch: `release/v0.4.8` off `develop`@`2080924` — bumps 3 manifests + CHANGELOG header. PR `release/v0.4.8` → `develop` (codex non-author review + merge).
- PR: `develop` → `main` (Gitea, admin-bypass merge).
- Tag: `v0.4.8` annotated, on the `develop → main` merge commit.
- **Gitea release**: marked `Latest` (promotes past v0.4.7).
- **GitHub release**: marked `Latest` (promotes past v0.4.7).
- Gitea issues to close at this point: **#18** (M5 entry condition resolved by #36 evidence; verdict: keep `--reflect` opt-in, evidence-backed; not promoted to default-on).
- Gitea issues that stay open as v0.4.9 follow-ups: **#32** (M2.1 stronger acceptance fixtures), **#12** (review design umbrella, not yet finished), **#26** (governance: pin Gitea actor identity — partially landed via helper hardening, but actor-isolation work continues).

---

## Requested Scope

Tracked under Gitea umbrella issue #12 plus per-milestone subissues. Six functional milestones (M0–M6) plus three measurement-infrastructure repairs (PA1–PA3) and one calibration experiment (M2.1).

### M0 — Review substrate

Confidence-tier and validation-signals fields added to the review schema. `/glm:review` now rejects trailing focus text (which previously interpolated to empty under the old shared template), forcing balanced review to use prompt-defined framing only. Pass-level metadata scaffolding (`passes.model`, `passes.validation`, `passes.rerank`) wired through `runReview` so downstream consumers can inspect each lane independently. Failure-path payloads now preserve rejected review structure instead of silently sanitising it.

### M1 — Structural validators and tier wiring

Validators in `scripts/lib/validators/review-structural.mjs` evaluate every parsed finding against four signals: `file_in_target`, `known_false_reference_absent`, `line_range_in_file`, and `anchor_literal_found` (token-boundary literal-match within the cited line range). Findings inherit one of four tiers — `proposed`, `cross-checked`, `deterministically_validated`, `rejected` — based on which signals pass. Render policy in `scripts/lib/render.mjs` applies per-mode tier filtering downstream.

### M2 — Real mode split for review vs adversarial-review

`/glm:review` and `/glm:adversarial-review` now load distinct prompt templates (`prompts/review.md` and `prompts/adversarial-review.md`). Render policy splits into a balanced default (`cross-checked+`, severity `medium+`, cap 5) and an adversarial default (`cross-checked+ OR proposed-with-fail-anchor`, severity `medium+`, cap 8). Pre-M2 both modes shipped the same template + render policy with empty interpolated keys, so balanced mode was effectively adversarial mode in disguise.

### M3 — Measurement parity and dogfood packets

Review-eval harness (`test-automation/review-eval/scripts/run-experiment.mjs`) gains `--mode review|adversarial-review`. CSV rows record `mode`, post-validation tier distribution, rejected count, and `passes.model.durationMs` / `passes.validation` status/timing. Dogfood summary output adds rerank-row support. **Note**: the v0.4.8/m3-measurement.csv was generated against the broken pre-PA1 review-context path; it is preserved as historical artifact only and is **not** cited as M5 entry-condition evidence (see PA1+PA3 below).

### M4 — Repo-owned checks v0.1

`.glm/checks/*.json|yaml` adds local policy via two check kinds: `grep-exists` and `grep-notpresent`. Hard-schema config; literal text matching only; scans only files in the reviewed target set; no shell, no test runners, no markdown-driven execution. Stored under `result.repo_checks`, rendered as a separate render section, never merged into model `findings`. Invalid check config is surfaced as configuration failure rather than silently ignored.

### M5 — Optional reflection / rerank lane (opt-in only)

`/glm:review --reflect` and `/glm:adversarial-review --reflect` add a single optional second pass that sees the first-pass parsed result, validation telemetry, and repo-check output, then prunes weak findings or sharpens evidence. Default review path remains one GLM call plus local validation + repo checks. Reflection metadata stored under `passes.rerank` and `result.rerank`. On reflection failure the first-pass result is preserved.

**ROI evidence** (`test-automation/review-eval/results/v0.4.8/m5-reflection-roi.csv` and `…m5-reflection-roi-dogfood.md`, captured under the corrected PA2 harness on C1/C2 adversarial review, N=3 each, temperature=0, seed=42, thinking=off): rerank completed 6/6 runs with no fallback failures. Citation/quality outcome was mixed — C1 cite 0.78 → 0.67, cross-checked 5 → 3, latency 37.7s → 62.3s; C2 cite stayed 1.00, cross-checked 3 → 4, but proposed 0 → 1, latency 38.6s → 69.2s. Net judgment: keep the lane available as an opt-in diagnostic, do not promote to default-on. Closes #18 (entry condition resolved).

### M6 — Challenge-surface graduation decision (no graduation)

`docs/plans/2026-04-25-m6-graduation-design.md` applies the roadmap §5.7 graduation rule (distinct context / deterministic validation hooks / distinct severity-report structure) to all six adversarial-review challenge surfaces: correctness-under-stress, state-and-data-integrity, trust-boundaries, compatibility-and-version-skew, operability, test-strategy. Result: zero surfaces graduate. Correctness-under-stress and test-strategy fail because deterministic validation would require shell or test execution (M4 explicitly excludes this). Operability and compatibility-and-version-skew are already covered by `.glm/checks/`. State/data-integrity, trust-boundaries, and test-strategy do not have ≥20% adoption-driving signal in the current evidence base. Trust-boundary graduation would also push toward "general security pipeline", which M5/M6 non-goals explicitly exclude. **Net effect**: no code change. All six surfaces stay as adversarial-mode prompt tags. Re-open conditions documented inline.

### PA1 — Production review-context fail-closed (root-cause repair)

`scripts/lib/git.mjs::collectReviewContext` previously fell back to a `self-collect` mode when the diff exceeded 2 files / 256 KB, shipping only commit log + diff stat + changed-file list to the BigModel runtime — which has no git access, so the model honestly refused to review (balanced mode, 0 findings) or fabricated whole-file findings (adversarial mode, `file:1` to `file:end-of-file` with `anchor_literal_found=fail`). PA1 raises the inline-diff budget to 50 files / 384 KB (≈110K tokens, ~18K headroom under 128K-token glm-4.6/5.1 input contexts), throws `ReviewContextDiffTooLargeError` (`errorCode=DIFF_TOO_LARGE`, `retry=never`) above that, and exposes `--max-diff-files` / `--max-diff-bytes` per-call overrides. The `self-collect` `inputMode` and `buildAdversarialCollectionGuidance` "inspect yourself" guidance are removed. Companion catches the error and emits a structured failure shape rather than a silent stat-only review.

### PA2 — Fixture-aware measurement harness checkout

`test-automation/review-eval/scripts/run-experiment.mjs` now reads each fixture's `meta.json`, checks out the `head_ref` in a temporary detached worktree, and runs the companion against that worktree with the fixture `base_ref`. CSV rows include `base_ref` and `head_ref`. Citation scoring inspects fixture-worktree files instead of the current repo state. New runs default to `m3-measurement-v2.csv` so they cannot append to the invalid pre-PA1 CSV. Without PA2, M3 measurement was reviewing whatever development branch the harness happened to run from, not the pinned fixture diff.

### PA3 — Fixture-aware M3 v2 baseline

`test-automation/review-eval/results/v0.4.8/m3-measurement-v2.csv` and `…m3-v2-dogfood.md` capture the C1/C2/C3 × review/adversarial-review × N=3 baseline under the corrected PA1+PA2 harness. This baseline supersedes the pre-PA1 m3-measurement.csv as the v0.4.8 evidence for review/adversarial behaviour. It is the input M5 ROI evidence (#36) was generated against.

### M2.1 — Balanced review calibration experiment (negative result)

`prompts/review.md` tightened: balanced review now requires a concrete failure-path trace before approving runtime files / hooks / scripts / schema migrations / config surfaces, and explicitly does not treat release cards / changelogs / plans / test-count summaries as proof of correctness. Rerun under the PA2 fixture-aware harness produced `P0/C0/D0/R0` and `0 findings` on both C1 and C2 (`test-automation/review-eval/results/v0.4.8/m21-review-calibration.csv`, `m21-review-calibration-dogfood.md`). The prompt change is shipped (it is also a correctness improvement on its own merits), but **#32 stays open**: M2.1 cannot be closed by prompt hardening alone; follow-up work must define stronger acceptance fixtures or compare against human-labeled expected findings. Deferred to v0.4.9.

## Out of Scope

- **#32 M2.1 stronger acceptance fixtures** — deferred to v0.4.9. Evidence shows balanced review still emits 0 findings on PA2-corrected C1/C2 even after prompt hardening; closing this requires a fixture authoring effort with human-labeled expected findings, not blind prompt tuning.
- **#12 review-design umbrella** — stays open as the rolling tracker for the review surface; v0.4.8 substantially advances it but does not close it.
- **#26 governance: pin Gitea actor identity** — partially landed (helper hardening with `GITEA_EXPECT_ACTOR` + actor assertion + audit log under `~/.claude/state/gitea-mutations/`), but the broader actor-isolation effort (true session-separated review across two physically distinct sessions / machines) is not solved within v0.4.8 scope. Stays open.
- **No cross-model verifier**. M5 explicitly excludes a default second model pass on every review. Codex/cross-AI review is governed by `Review-Mode: dual-token user-bypass` semantics, not as a productised feature.
- **No security platform expansion**. Adversarial review remains six bounded challenge surfaces (correctness, integrity, trust, compatibility, operability, test-strategy). M6 explicitly declined graduation to a general security pipeline.
- **No diff streaming / chunking** for diffs above the 384 KB inline budget. Above the budget, `/glm:review` fails-closed and asks the user to narrow scope (`--base <closer-ref>`) or split the change. Streaming is a future design (would require a multi-turn protocol).
- **No sampling-parameter default change**. v0.4.7 expanded sweep already showed no detectable temperature effect at the design power level. v0.4.8 leaves server-default sampling unchanged.
- **No KB / MB suffix parsing** for `--max-diff-bytes`. Plain bytes only; deferred.
- **No `--reflect` default-on**. ROI evidence (#36) does not support promotion to default-on for v0.4.8.

## Planned Actions

1. M0 substrate (#19 merged 2026-04-23). ✓
2. M1 structural validators (#20 merged 2026-04-23). ✓
3. M2 real mode split (#21 merged 2026-04-23). ✓
4. M3 measurement parity (#22 merged 2026-04-23). ✓
5. v0.4.8 review cleanup observations (#23 merged 2026-04-23). ✓
6. M4 repo-owned checks (#24 merged 2026-04-24). ✓
7. M3 measurement evidence (pre-PA1) (#25 merged 2026-04-24). ✓
8. M5 reflection lane (#27 merged 2026-04-25 by sky admin-bypass). ✓
9. PA1 production review-context fail-closed (#28 merged 2026-04-25). ✓
10. PA2 fixture-aware harness checkout (#29 merged 2026-04-25). ✓
11. PA3 fixture-aware M3 v2 baseline (#30 merged 2026-04-25). ✓
12. M5 ROI harness instrumentation (#35 merged 2026-04-25). ✓
13. M2.1 balanced review calibration experiment (#33 merged 2026-04-25). ✓
14. M6 challenge-surface graduation decision (#34 merged 2026-04-25). ✓
15. M5 ROI evidence (#36 merged 2026-04-25 by sky admin-bypass). ✓
16. **(pending)** Manifest bump: `package.json` + `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` 0.4.7 → 0.4.8.
17. **(pending)** CHANGELOG header change `## v0.4.8 (unreleased)` → `## v0.4.8` (release-day cut).
18. **(pending)** Open `release/v0.4.8` PR → `develop` (Gitea) with steps 16–17. Codex non-author review + merge.
19. **(pending)** Open `develop` → `main` PR (Gitea). Admin-bypass merge.
20. **(pending)** Tag `v0.4.8` annotated on the `develop → main` merge commit. Pre-push hook runs `bash scripts/ci/check-release-ready.sh v0.4.8`.
21. **(pending)** Publish Gitea release `v0.4.8`, mark `Latest` (promotes past v0.4.7).
22. **(pending)** Sync `main` + `develop` + tag to GitHub. Confirm AI Quality Gate + PR Check green.
23. **(pending)** Publish GitHub release `v0.4.8`, mark `Latest`.
24. **(pending)** Fast-forward `develop` → `main` on both remotes (GitFlow cleanup).
25. **(pending)** Upgrade local plugin cache to v0.4.8.
26. **(pending)** Close Gitea issue #18 with link to CHANGELOG entry + #36 evidence summary.

## Scope Completion: COMPLETE

Code, evidence, manifest bump, and CHANGELOG header are all on the `release/v0.4.8` branch off `develop`@`2080924`. Steps 18–26 below are mechanical release-chain actions (PR merges, tag, GitHub mirror, Gitea + GitHub release publish, plugin cache, issue close).

## Outstanding In-Scope Work: none

## Major Upgrade Review: N/A

No dependency bumps, GitHub/Gitea Action SHA changes, Node version bumps, or runtime/platform changes in v0.4.8. All work is additive plugin code + measurement infra + review-eval data + design docs. The review path now fail-closes on big diffs (PA1) — that is a behaviour change but not a dependency-version change. Companion HTTP call shape, BigModel endpoint, model catalog, schema, prompt templates' core structure, and `/glm:setup` / `/glm:status` / `/glm:result` / `/glm:cancel` / `/glm:task` all unchanged in protocol/contract; only review-mode prompts were tightened (M2.1).

## Repo Usage Audit

- Modified: `scripts/lib/git.mjs` (PA1: `+ReviewContextDiffTooLargeError` class, threshold raise, fail-closed semantics, removal of `self-collect` mode and `buildAdversarialCollectionGuidance`).
- Modified: `scripts/glm-companion.mjs` (PA1: `--max-diff-files` / `--max-diff-bytes`; M5: `--reflect` / `--reflect-model`; M0: focus-text rejection on `/glm:review`; M0/M1/M2: pass metadata + structural-validator wiring + mode-split prompt dispatch; M4: repo-checks integration).
- Modified: `scripts/lib/render.mjs` (M2: balanced vs adversarial render policy split; M4: `repo_checks` rendering section).
- New: `scripts/lib/validators/review-structural.mjs` (M1).
- New: `scripts/lib/repo-checks.mjs` (M4).
- New: `scripts/lib/review-rerank.mjs` (M5).
- Modified: `prompts/review.md` (M2 split; M2.1 failure-path-trace requirement) and `prompts/adversarial-review.md` (M2 split + bounded challenge surfaces).
- Modified: `commands/review.md`, `commands/adversarial-review.md` (argument hints).
- Modified: `schemas/review-output.schema.json` (M0 confidence_tier + validation_signals).
- Modified: `test-automation/review-eval/scripts/run-experiment.mjs` (M3 mode flag; PA2 fixture worktree checkout + v2 CSV; M5 rerank columns), `summarize.mjs`.
- New: `test-automation/review-eval/results/v0.4.8/` — `m3-measurement.csv` (pre-PA1, retained as historical artifact), `m3-measurement-v2.csv` (PA3 fixture-aware), `m21-review-calibration.csv` (M2.1), `m5-reflection-roi.csv` (#36), corresponding dogfood markdown packets, and ~50 sidecar payload JSONs.
- New: `tests/git.test.mjs`, `tests/repo-checks.test.mjs`, `tests/review-eval-harness.test.mjs`, `tests/review-focus-rejection.test.mjs`, `tests/review-rerank.test.mjs`, `tests/run-review-pass-metadata.test.mjs`, `tests/schema-m0.test.mjs`, `tests/structural-validators.test.mjs`, `tests/template-contract.test.mjs`, `tests/pass-metadata.test.mjs`. Modified: `tests/render.test.mjs`, `tests/review-payload.test.mjs`.
- New: `docs/plans/2026-04-22-review-fabrication-root-cause-design.md`, `…v2-archived.md`, `2026-04-24-review-architecture-v1.md`, `2026-04-24-review-design-external-baseline.md`, `2026-04-24-review-implementation-roadmap.md`, `2026-04-25-pa1-review-context-fix-design.md`, `2026-04-25-m6-graduation-design.md`. New: `docs/repo-checks.md`.

## Verification Plan

| Layer | Tool | Pass criterion |
|---|---|---|
| Static | `npm run check` | All modules parse; import graph resolves |
| Unit | `npm test` (= `node --test`) | 312/312 pass on `develop`@2080924 |
| Manifest | `bash scripts/ci/check-plugin-manifest.sh` | Version is **0.4.8** consistent across `package.json` / `.claude-plugin/plugin.json` / `.claude-plugin/marketplace.json` (after step 16). |
| CHANGELOG | `bash scripts/ci/check-changelog-updated.sh` | `## v0.4.8` section present (header de-`unreleased` after step 17). |
| Leak guard | `bash scripts/ci/check-no-local-paths.sh` | No internal paths leaked. |
| Cross-AI | `node scripts/ci/check-cross-ai-review.mjs` | Cross-AI review documented per PR. |
| Co-Authored-By | `bash scripts/ci/check-coauthored-by.sh` | All AI-authored commits carry the trailer. |
| Gitea CI | `AI Quality Gate` + `PR Check` workflows | Both green on `release/v0.4.8` PR + `develop → main` PR. |
| GitHub CI | Same | Both green after GitHub mirror push. |
| **Release gate** | `bash scripts/ci/check-release-ready.sh v0.4.8` | Manifests match tag; CHANGELOG section exists; release_card.md is `Status: READY` and `Scope Completion: COMPLETE` (after step 16+17). |
| Local exercise | Manual `/glm:review --base v0.4.7` on a small repo PR | Returns `inputMode=inline-diff` with real diff content (post-PA1). Optionally `--reflect` exercises the M5 lane. |

## Local Verification (current state, develop @ 2080924)

- `node --test` on `develop`@`2080924`: **312/312 pass** (12 new test files vs v0.4.7; 14543/-182 line delta across 102 files).
- `npm run ci:local` on `develop`@`2080924`: lint + tests + path-leak guard + plugin manifest + AI quality gate + CHANGELOG gate + Co-Authored-By gate **all green**.
- Independent claude-code review of #36 (M5 ROI evidence): all CSV averages and tier counts recomputed independently and matched dogfood/CHANGELOG claims; sidecar spot-check confirmed rerank pass executed (durationMs=12085 on the spot-checked run, model=glm-5.1, initial 3 → final 1 with the kept finding being a real cross-checked technical defect).
- Mirror to GitHub `develop` succeeded (FF-only, `20b9372 → 2080924`). GitHub side warns that 4 commits in this range are unsigned; the warning is admin-override-accepted on this repo, not a release blocker.

## CI Evidence

To be filled in after the `release/v0.4.8` PR + `develop → main` PR runs complete on Gitea, plus the corresponding mirror runs on GitHub. Per-merged-PR CI greens for v0.4.8 to date (already verified at merge time):

| PR | Title | CI status (at merge) |
|---|---|---|
| #19 | feat(m0) review substrate | 3/3 green |
| #20 | feat(m1) structural validators | 3/3 green |
| #21 | feat(m2) real mode split | 3/3 green |
| #22 | feat(m3) review-mode measurement | 3/3 green |
| #23 | fix(v0.4.8) review cleanup observations | 3/3 green |
| #24 | feat(m4) repo-owned checks | 3/3 green |
| #25 | test(m3) measurement evidence | 3/3 green |
| #27 | feat(m5) reflection rerank | 3/3 green |
| #28 | fix(pa1) review-context fail-closed | 3/3 green |
| #29 | fix(pa2) fixture worktree harness | 3/3 green |
| #30 | test(pa3) fixture-aware M3 v2 baseline | 3/3 green |
| #33 | fix(m2.1) failure-path tracing | 3/3 green |
| #34 | docs(m6) graduation decision | 3/3 green |
| #35 | test(m5) ROI harness instrumentation | 3/3 green |
| #36 | test(m5) ROI evidence | 3/3 green |

## Rollback

Low risk. v0.4.8 is additive plus measurement-infra repair; no dependency bumps, no schema migrations, no config-file format changes. Users do not need to re-run `/glm:setup`.

- **PA1 fail-closed**: if a user has a workflow that depends on `/glm:review` quietly skipping diff content above 2 files / 256 KB (which would have produced fabricated or refusal-style output anyway), they can override per call with `--max-diff-files <N>` and `--max-diff-bytes <BYTES>`. Full rollback would `git revert` PR #28 + #29 to restore the pre-PA1 self-collect path; not recommended given the fabrication evidence.
- **M5 reflection**: opt-in only; no default behaviour change. Disabling means simply not passing `--reflect`.
- **M2.1 prompt tightening**: the failure-path-trace requirement is a real prompt change shipped on review only. If it produces too many no-ship results in production, revert PR #33 alone (single-PR rollback path) or relax the failure-path-trace clause in `prompts/review.md` and recut.
- **Full rollback**: `git revert` the `develop → main` merge commit; delete tag `v0.4.8`; unmark `Latest` on Gitea + GitHub releases; re-mark `v0.4.7` `Latest` on both. This restores v0.4.7 entirely; the v0.4.8 review-eval data files remain on disk as historical artifacts but no runtime/CI consumes them.

## Approval ask (when ready)

This card moves from `DRAFT` → `READY` after the manifest bump + CHANGELOG header change land on `develop`. At that point the approval ask becomes:

```text
Release approval request — glm-plugin-cc v0.4.8
- Scope: M0–M6 + PA1–PA3 + M2.1 (negative result, prompt change shipped) +
  M5 ROI evidence (#36)
- Ref: develop@<post-manifest-bump-sha>
- Evidence: 312/312 + ci:local green at 2080924; per-PR CI 3/3 green for
  PRs #19–#36; M5 ROI evidence independently re-verified; PA1+PA2+PA3
  measurement-infra repair landed.
- Open in-scope work: none
- Ask: admin-bypass merge `release/v0.4.8` → `develop` → `main`, then tag
  v0.4.8, then publish Gitea + GitHub releases as `Latest`.
```
