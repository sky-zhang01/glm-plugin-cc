# PA1: Production review-context fix — fail-closed on big diff

Status: DRAFT
Approval: DESIGN_OK (auto-mode delegated; Codex root-cause review concurred 2026-04-25; Sky verbal authority "如何认可就直接开始往下推")
Lane: Architecture Path
Date: 2026-04-25
Blocks: v0.4.8 release; PA2 (measurement harness fix); PA3 (M3 v2 baseline)

## Problem (root cause)

`scripts/lib/git.mjs::collectReviewContext` silently falls back to a "self-collect"
content mode when the diff exceeds `DEFAULT_INLINE_DIFF_MAX_FILES=2` or
`DEFAULT_INLINE_DIFF_MAX_BYTES=256KB`. In that mode it sends the model:

- `git log --oneline` for the branch range
- `git diff --shortstat`
- A list of changed file paths

…plus this guidance string: *"The repository context below is a lightweight
summary. Inspect the target diff yourself with read-only git commands before
finalizing findings."*

The BigModel remote has no git access. The guidance is undeliverable. The model
either honestly refuses to review (review mode → 0 findings) or fabricates
findings against file paths and line counts it can guess from the metadata
(adversarial mode → all findings cite `file:1` to `file:end-of-file`,
`anchor_literal_found=fail`).

Empirical evidence:
- M3 measurement payload `C2-v046-aftercare_review_t0_..._r1.json` model
  self-report: *"only commit log, diff stat, list of changed files... no actual
  diff content was provided... a substantive review is impossible without the
  diff"*.
- M3 adversarial findings cite `validators/review-structural.mjs:1-381` and
  `repo-checks.mjs:1-282` — whole-file ranges with `anchor_literal_found=fail`.
- Current `main..develop` = 57 files, ~433KB → permanently above defaults.
- `tests/` has no `git.test.mjs` covering this code path.

## Decisions

### D1 — Threshold defaults
- File cap: `2` → **`50`** (sanity guard against pathological many-tiny-file
  inputs; not the primary safety; remove the file gate altogether is too
  permissive given OOM risk on companion side).
- Byte cap: `256 KB` → **`384 KB`** (≈110K tokens at 3.5 B/token, leaving
  ~18K-token headroom for system prompt + thinking + structured output within a
  128K-token GLM-4.6 / 5.1 input context window).
- Both are escape-hatch overridable per-call.

### D2 — Replace silent self-collect with fail-closed
When file count or byte size exceeds the (effective) threshold:
- `collectReviewContext` throws a typed error
  `ReviewContextDiffTooLargeError` with:
  - `kind: "DIFF_TOO_LARGE"`
  - `fileCount`, `diffBytes`, `maxInlineFiles`, `maxInlineDiffBytes`
  - actionable message naming the override flags / scope-narrowing options
- No more `inputMode: "self-collect"`. Every non-error return is `inline-diff`.
- The `buildAdversarialCollectionGuidance` "inspect yourself" branch is removed.
  Only the inline-diff guidance string remains.

### D3 — CLI escape hatch on `glm-companion.mjs`
Add to `review` and `adversarial-review` subcommands:
- `--max-diff-files <int>` — override file cap; default = 50
- `--max-diff-bytes <int>` — override byte cap; default = 393216 (384 KB)
- `--max-diff-bytes` accepts plain bytes; we don't add KB / MB suffix parsing
  in this PR (out of scope; KISS).

### D4 — Companion error handling
Catch `ReviewContextDiffTooLargeError` in companion review entry:
- Return failure shape with `errorCode: "DIFF_TOO_LARGE"`, `retry: "never"`,
  message including current size + the override flag suggestion + a
  scope-narrowing hint (`use --base <closer-ref>` or split the change).
- Companion exits non-zero on this path (real error, not a silent stub).

### D5 — Stat-only fallback dropped, not preserved as opt-in
We do NOT add `--stat-only` opt-in. Reasons:
- The whole stat-only behavior is what produced the fabricated findings.
  Keeping it as opt-in invites the same trap.
- If a user genuinely wants summary-only review, they can pass an empty
  `--base` ref or run an external diff process — out of scope.

## Acceptance Criteria

- [AC1] `collectReviewContext` never returns `inputMode: "self-collect"`. The
  property is either `"inline-diff"` or the function throws.
- [AC2] When file count > effective `maxInlineFiles` OR byte size > effective
  `maxInlineDiffBytes`, the function throws `ReviewContextDiffTooLargeError`
  with the documented fields populated.
- [AC3] When both budgets are within bounds, the returned `content` contains
  the actual `git diff --binary` output (verified by inspecting first ~200B for
  `diff --git a/` header).
- [AC4] Companion `review` / `adversarial-review` subcommands accept
  `--max-diff-files` and `--max-diff-bytes` flags; passing them threads through
  to `collectReviewContext` options.
- [AC5] Companion catches `ReviewContextDiffTooLargeError` and surfaces a
  failure shape (`errorCode=DIFF_TOO_LARGE`, `retry=never`) with override-flag
  guidance. Exit code is non-zero.
- [AC6] `tests/git.test.mjs` (new) covers: small-diff path returns inline-diff;
  over-file-cap throws; over-byte-cap throws; explicit override widens
  thresholds; thresholds are clamped to non-negative integers.
- [AC7] No existing test asserts `inputMode === "self-collect"` (or if it
  does, it is rewritten to assert the throw path).
- [AC8] Manual smoke (test-plan, not committed): on current `develop` branch,
  `node scripts/glm-companion.mjs review --base v0.4.7 --json --thinking off`
  either returns inline-diff content (if size fits) or fails-closed with the
  documented hint.

## Out of scope

- PA2 — `run-experiment.mjs` fixture-aware temp-worktree checkout (separate PR)
- PA3 — re-running M3 baseline on PA1+PA2-corrected harness (separate effort)
- M2.1 prompt recalibration (P1) — gated on PA3 baseline being valid
- M5 reflection re-evaluation — gated on PA3
- KB / MB suffix parsing for `--max-diff-bytes`
- Diff streaming / chunking for >context-window diffs (would require
  multi-turn protocol; defer until evidence shows real demand)
- v0.4.8 release tag (blocked until PA3 evidence)

## Verification plan

1. Unit: `node --test tests/git.test.mjs`
2. Unit regression: `node --test` (full suite — ensure nothing else assumed
   `self-collect` mode)
3. CI local: `npm run ci:local`
4. Manual smoke (post-merge, not pre-merge): trigger one `/glm:review` on a
   small in-house PR, confirm `inputMode=inline-diff`, model receives actual
   diff hunks.

## Rollback

`git revert <pr-merge-commit>` restores prior thresholds + self-collect path.
No data, no schema, no infra state changes — pure code.

## Risk register

| Risk | Mitigation |
|---|---|
| 384 KB still too small for some real-world PRs | `--max-diff-bytes` flag; user can raise per call |
| Fail-closed surprises users who relied on "stat-only" review | Clear error message naming both override flags + base/scope narrow path |
| Token / context-window calculation is heuristic, not exact | If GLM rejects too large input, model returns its own error (separate path); we don't pre-tokenize. Acceptable. |
| `tests/git.test.mjs` is brand-new; risk of skipping git binary cost in tests | Use temp `git init` repo fixtures with small staged content; only assert metadata + threshold logic, not heavyweight diff content |
