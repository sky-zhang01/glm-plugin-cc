# Release Card — glm-plugin-cc v0.4.3

Status: READY
Approval Mode: maintainer direct-approval (solo-maintainer repo; single
human approver is also the owner; release_card + CI gate enforce the
evidence chain rather than a peer approval step).

Intended Ref: tag `v0.4.3` on gitea primary, mirrored to GitHub public.

Requested Scope
- v0.4.3 bug-fix and hardening release consolidating all fixes on top
  of v0.4.2. Full detail in `CHANGELOG.md` under `## v0.4.3`.
- Adds the first real CI pipeline to the repo (`.github/workflows/`,
  `scripts/ci/**`, pre-push hook, branch-protection setup helper).
- Brings the automated test suite from 0 to 65 tests.
- Fixes pre-existing metadata leaks: plugin / marketplace homepage
  now points at the public GitHub mirror; README install example uses
  the public URL.

Out of Scope
- No public API surface changes (command set + flags unchanged on
  Claude-Code-invoked paths).
- No config file schema changes (existing
  `~/.config/glm-plugin-cc/config.json` keeps working without re-setup).
- No endpoint URL changes; no model default change.
- No publish automation — the `release-pipeline.yml` workflow gates tag quality
  but does NOT push to any registry or GitHub Release. Publication
  remains a manual operation.

Planned Actions
1. (For future releases under GitFlow) Land all changes on `develop`
   via PR + CI + maintainer approval. Merge `develop` → `main` via a
   release PR.
2. Tag the `main` commit `vX.Y.Z`; `.github/workflows/release-pipeline.yml`
   runs the release gate (version parity across `package.json` /
   `plugin.json` / `marketplace.json` / tag; CHANGELOG entry present;
   `release_card.md Status: READY`).
3. Push the tag to the GitHub public mirror.
4. Publish the GitHub release from the matching CHANGELOG section and
   mark it as **latest**.

Note: v0.4.3 itself was tagged before the GitFlow split and lives on
`main` directly. Subsequent releases follow the flow above.

Scope Completion: COMPLETE
Outstanding In-Scope Work: none

Major Upgrade Review: DONE (patch-level in substance — all fixes are
surgical and data-flow preserving; no API surface, config shape,
endpoint URL, or schema changes).

Breaking Changes: none for users with healthy state/config. Users with
an already-corrupt `~/.config/glm-plugin-cc/config.json` or
`state.json` who previously enjoyed silent masking will now see a
clear error ("Could not parse …: delete or fix the file"); they can
recover by deleting the file. Intended behavior change.

Repo Usage Audit
- `runReview` is the only caller of
  `loadPromptTemplate(_, "adversarial-review"|"review")`.
- `loadState` / `readConfigFile` / `readJobFile` callers propagate
  throw semantics cleanly up to the command boundary where they
  surface to the user.
- All user-facing error emissions go through `formatUserFacingError`
  (`scripts/lib/fs.mjs`); enforced by the AI quality gate invariant.

Verification Plan: executed
- `npm run ci:local` passes end-to-end: syntax check, full test suite
  (65/65), path-leak guard, plugin manifest validation, AI quality
  gate, CHANGELOG + Co-Authored-By checks.
- `.github/workflows/pr-check.yml` and
  `.github/workflows/ai-quality-gate.yml` ran green on the last push
  to `main`.
- Subprocess integration tests exercise the three main commands
  (`/glm:setup`, `/glm:status`, `/glm:result`) against a pre-seeded
  corrupt `state.json` and a corrupt job file — all propagate clean
  single-line errors with recovery hints.

Local Verification: all pass. `npm run check` validates 13 lib
modules + 3 top-level scripts + ESM import resolution.

CI Evidence: this release ships the first real CI pipeline — see
`CHANGELOG.md` under `## v0.4.3 › Added — CI pipeline`. `npm run
ci:local` mirrors the server gate exactly. `release-pipeline.yml` is
tag-triggered and verifies version parity + CHANGELOG entry +
`release_card.md Status: READY` before any future tag lands. Branch
protection on `main` is applied via
`scripts/setup/configure-gitea-protection.sh` (idempotent).

Rollback
- Full unwind of the v0.4.3 hotfix arc: revert to the v0.4.3 baseline
  commit. All 22 post-baseline issues reappear. Not expected to be
  needed.
- Partial rollbacks of individual fix passes are possible but bring
  back the specific classes of bug the fix addressed; see the
  CHANGELOG section's "Fixed" subheadings for the correspondence.
- Rolling back the CI pipeline itself removes the regression-pattern
  protection but doesn't change runtime behavior (the
  `formatUserFacingError` refactor is semantically identical to the
  previous call sites).
