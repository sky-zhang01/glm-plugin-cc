---
Status: DECIDED
Approval: DESIGN_OK — codex non-author review, 2026-04-25
Authority: roadmap §5.7 M6 — Challenge-surface graduation
Evidence: PA3 v2 baseline (post-PA2 fixture-worktree harness)
Verdict: NO graduation. Keep all six challenge surfaces as adversarial-mode tags.
---

# M6 — Challenge-surface graduation decision

## Goal

Apply the roadmap §5.7 graduation rule to the six adversarial-review challenge
surfaces shipped in M2 and decide, for each, whether to keep it as a tag in
`prompts/adversarial-review.md` or graduate it to a distinct feature with its
own context collection / validators / report shape.

## Roadmap rule (verbatim from `2026-04-24-review-implementation-roadmap.md`)

> Only graduate a challenge surface if it implies at least one of:
>
> 1. distinct context collection
> 2. distinct deterministic validation hooks
> 3. distinct severity/report structure
>
> If none of these are true, keep it as a tag.

> This is where cargo-cult risk is highest. If we move too early, we will just
> build "prompt switch cases with more nouns."

## Method

1. Use **PA3 v2 baseline only** as evidence (post-PA2 fixture-worktree
   harness). The pre-PA2 v1 measurement was reviewing `develop` instead of
   each fixture's pinned diff and is not citable.
2. Read every adversarial-mode finding sidecar at
   `test-automation/review-eval/results/v0.4.8/payloads/*adversarial-review*2026-04-25*`.
3. Tag each finding to one of the six surfaces from
   `prompts/adversarial-review.md`.
4. For each surface, evaluate the three graduation rule clauses against
   what we already deliver in M0–M5.

## Evidence

PA3 v2 baseline produced 16 adversarial findings (C3 large diff
`DIFF_TOO_LARGE` fail-closed via PA1, no findings):

| Surface | Findings | Per-fixture | Notes |
|---|---|---|---|
| correctness under stress | 5 | C2×4, C1×1 | retry classification, vendor error bypass, transient/terminal sequencing |
| operability | 4 | C1×2, C2×2 | doc/runtime drift, audit-evidence accuracy |
| state/data integrity | 3 | C1×3 | unenforced state coverage, irreversible repeat ops |
| test strategy | 3 | C1×2, C2×1 | missing automated coverage for risky transitions |
| trust boundaries | 1 | C1×1 | URL input-validation constraint |
| compatibility / version skew | 1 | C1×1 | fragile command-syntax (ellipsis) |

Tagging is one author's call on a small sample. Recount by another reviewer
may shift counts ±1 per surface; the qualitative outcome below is robust to
that.

## Per-surface graduation analysis

### 1. Correctness under stress (5 findings, ~31%)

- **Distinct context**: would require a retry/timeout/state-machine view of
  the changed code. Adversarial prompt already nudges the model toward this;
  no separate collection step adds new signal that the model cannot already
  derive from the diff.
- **Distinct deterministic validation hooks**: the only deterministic check
  for "retry classifier is correct" is **executing the retry path**. M4
  explicitly excluded shell/test execution as a non-goal (roadmap §5.5
  "no shell/test execution surface"). Graduating here would push us across
  that line.
- **Distinct severity/report structure**: findings already use the standard
  `severity` + `confidence_tier` + `validation_signals` shape. Nothing
  surface-specific needed.
- **Verdict**: **no graduation**. Keep as tag.

### 2. Operability (4 findings, ~25%)

- The findings here are doc/runtime alignment — exactly the kind of
  invariant `.glm/checks/` already targets (M4: `grep-exists`,
  `grep-notpresent`).
- Repos that care about this can encode the specific patterns they already
  drift on (e.g. "CHANGELOG must list every test count cited in the verification
  plan") as repo-owned checks.
- **Verdict**: **no graduation**. M4 covers this.

### 3. State / data integrity (3 findings, ~19%)

- Findings are about user-flow state consistency in `commands/setup.md`,
  not data-store schema/migration. The current prompt language captures
  this; repo-owned checks can encode specific known invariants.
- A "schema/migration validator" would graduate, but nothing in v0.4.8
  scope touches schema migrations, so there is no concrete validator to
  ship now.
- **Verdict**: **no graduation**. Tag is sufficient until a migration-bearing
  PR shows the gap.

### 4. Test strategy (3 findings, ~19%)

- Distinct context would mean reading test files that *should* have been
  updated. Building this requires either:
  - executing tests (excluded by M4 non-goal), or
  - static heuristic ("file X changed but no test under tests/ matches" — a
    `.glm/checks/` candidate the repo can own).
- Either route is already accessible without a new graduated surface.
- **Verdict**: **no graduation**. Either keep as tag or encode as repo-owned
  check (M4 surface).

### 5. Trust boundaries (1 finding, ~6%)

- A graduated security surface is exactly what roadmap §5.7 warns against:
  "no expansion into a general security pipeline" (M5 non-goal, applies
  here too).
- One sample finding is too thin to draw scope from, and graduating into
  security would change product identity.
- If real security work is needed, it should be its own pipeline (not a
  graduated surface inside `/glm:adversarial-review`).
- **Verdict**: **no graduation**. Tag stays; security work, if pursued,
  goes in a separate command/skill.

### 6. Compatibility / version skew (1 finding, ~6%)

- Distinct deterministic check is plausible (e.g. "if `feat!:` commit, must
  bump major in CHANGELOG/manifest"), but that is a single
  `grep-exists`/`grep-notpresent` style invariant — already expressible as a
  repo-owned check on M4.
- **Verdict**: **no graduation**. Encode specifics as M4 checks per repo.

## Decision

**No surface graduates.** All six remain as adversarial-mode tags in
`prompts/adversarial-review.md`. M0-M5 + M4 repo-owned checks cover what
each surface needs without introducing surface-specific code paths.

The conservative outcome is consistent with the roadmap warning ("cargo-cult
risk is highest"). It also explains why review-mode-on-real-fixture-diff
keeps producing zero findings (M2.1 negative result, issue #32): the
problem is not surface coverage gaps; it is balanced-mode prompt /
render-policy calibration, which is its own track.

## Re-open conditions

The roadmap left M6 as the last v0.4.8 milestone with the explicit
instruction to wait for evidence. Re-open this decision if any of the
following becomes true on a future measurement run:

1. A future `/glm:review` or `/glm:adversarial-review` evaluation captures
   findings whose body language consistently cites a deterministic check
   the current pipeline cannot run (e.g. "this RLS policy is wrong"
   appearing in >20% of findings on a database-heavy fixture).
2. A real downstream user repo demonstrates a recurring class of finding
   that `.glm/checks/` cannot encode without a new validator kind beyond
   `grep-exists` / `grep-notpresent`.
3. Adversarial mode adoption shifts to security-sensitive workloads where
   trust-boundary findings dominate and warrant their own pipeline.

Without one of those, M6 stays closed.

## Acceptance criteria

- This document lands on `develop` as the M6 decision-of-record.
- `prompts/adversarial-review.md` keeps the six bounded surfaces as tags
  (no edits required by this milestone).
- M6 issue (if one is opened) closes with `closed-not-planned` linking to
  this document.
- CHANGELOG reflects the closure under v0.4.8.

## Out of scope

- Any new prompt surface, validator kind, or context-collection step.
- The balanced-mode 0-findings problem (issue #32 / M2.1 follow-up).
- M5 reflection ROI re-validation (issue #31).
- v0.4.8 release tag mechanics (release_card.md and GitHub mirror are
  separate workstreams).

## References

- Roadmap: `docs/plans/2026-04-24-review-implementation-roadmap.md` §5.7
- Architecture v1: `docs/plans/2026-04-24-review-architecture-v1.md`
- Adversarial prompt with surface tags: `prompts/adversarial-review.md`
- PA3 v2 evidence: `test-automation/review-eval/results/v0.4.8/m3-measurement-v2.csv`
  + sidecars at `test-automation/review-eval/results/v0.4.8/payloads/*adversarial-review*2026-04-25*`
