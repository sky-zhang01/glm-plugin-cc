# Release Card — glm-plugin-cc v0.4.6

Status: READY

Approval Mode: maintainer direct-approval (solo-maintainer repo; same
pattern as v0.4.4 and v0.4.5). Gitea CI green → maintainer auto-merge
per standing one-off-per-release shortcut. Not promoted into
CONTRIBUTING.md.

Intended Ref
- Feature branch: `fix/v046-hardening-aftercare` off `develop`
- PR #5: `fix/v046-hardening-aftercare` → `develop` (Gitea)
- PR #6: `develop` → `main` (Gitea)
- Tag: `v0.4.6` annotated, on the `develop → main` merge commit
- Mirrored: GitHub public repo (main + tag + release, marked Latest)

---

## Requested Scope

Three aligned aftercare changes identified post-v0.4.5 release, driven
by v0.4.5 dogfood observations + user pushback on the initial v0.4.6
scope ("classifier alone is not enough — we need actual recovery"):

1. **BigModel error-code handling, corrected against official docs**
   (https://docs.bigmodel.cn/cn/faq/api-code). Initial v0.4.6 draft
   had memory-derived mappings with wrong entries (1303 doesn't exist
   officially; 1304 is daily-call-count, not balance). Rewrote the
   table with 1301/1302/1304/1305/1308/1309/1310 per the authoritative
   source. Each code now maps to a distinct internal `errorCode` +
   retry semantic + user recovery hint.

2. **Programmatic retry/backoff for transient codes** — classifier
   alone doesn't solve the user's observed pain ("I just want the
   plugin to retry past a 1305, not tell me what 1305 means and make
   me retry by hand"). `scripts/lib/retry.mjs` wraps every BigModel
   HTTP call with bounded exponential backoff + jitter. For
   `retry: immediate` codes (1302, 1305) and network failures
   (TIMEOUT, NETWORK_ERROR): auto-retry up to 3 attempts with
   2s → 5s → 12.5s (cap 15s) + ±20 % jitter, total budget 30s. For
   `retry: after-cooldown` or `never`: return on first call (no wasted
   retries). Opt-out via `retry: false`. Matches ZhipuAI SDK's own
   `max_retries=3` industry norm.

3. **Retire chronically-broken `verify-release.yml`**. Workflow never
   successfully ran since creation — GitHub Actions parser never
   registered the YAML. Every push produced a 0-second failure
   polluting the run list. User directive: fix or delete before next
   release. Delete is equivalent: all 4 checks (package.json parity,
   manifest parity, CHANGELOG section, release_card READY) are
   re-implemented in `scripts/ci/check-release-ready.sh` invoked by
   pre-push hook on tag pushes — catching issues BEFORE `git push`
   reaches GitHub rather than after.

## Out of Scope

- **Hallucination guard for GLM-5.1 on large diffs**. Observed in both
  v0.4.5 dogfood + workflow-governor session (same day). Mitigations
  (scope-narrowing heuristic, schema-echo detector, citation sanity-
  check) are documented in
  `~/Project/knowledge/agent-hallucination-patterns.md` Appendix
  2026-04-21 and deferred to a later release. Underlying cause is
  model-class (not plugin bug); mitigation is not the same as fix.
- No changes to GLM HTTP call shape, model catalog, schema, prompts,
  `/glm:review`, `/glm:adversarial-review`, `/glm:setup`,
  `/glm:status`, `/glm:result`, `/glm:cancel`, `/glm:task`.

## Planned Actions

1. `git checkout -b fix/v046-hardening-aftercare` off `develop` ✓
2. Create `scripts/lib/bigmodel-errors.mjs` with frozen dispatch table
   + `classifyBigModelError` + `extractBigModelErrorCode` ✓
3. Wire into `scripts/lib/glm-client.mjs runChatRequest` — vendor code
   classification runs before HTTP-status fallbacks ✓
4. Add `tests/bigmodel-errors.test.mjs` (17 tests covering extract /
   classify / table integrity) ✓
5. Create `scripts/ci/check-release-ready.sh` (local replacement for
   verify-release.yml) ✓
6. Extend `scripts/hooks/pre-push` to invoke check-release-ready.sh
   when a `refs/tags/v*.*.*` ref is being pushed ✓
7. Delete `.github/workflows/verify-release.yml` + disable orphaned
   GitHub registration via API ✓
8. Bump 0.4.5 → 0.4.6 (package.json + plugin.json + marketplace.json) ✓
9. CHANGELOG v0.4.6 section ✓
10. `Skill(simplify)` on changed files
11. `npm run ci:local`
12. Adversarial review (Codex primary if quota allows, else GLM fallback
    with explicit waiver acknowledging limitations)
13. Push to Gitea only. Open PR #5 → `develop`. Paste adversarial
    verdict in PR body.
14. Gitea CI green → auto-merge PR #5 to develop
15. Open Gitea PR #6: develop → main. Merge.
16. Tag v0.4.6 annotated on main merge commit (pre-push will run
    check-release-ready.sh automatically). Push tag.
17. Publish Gitea release v0.4.6 (Latest auto-set)
18. Sync main + develop + tag to GitHub. Confirm PR Check + AI Quality
    Gate green (verify-release.yml should NO LONGER be in the run list)
19. Publish GitHub release v0.4.6, mark Latest
20. Fast-forward develop → main on both remotes (GitFlow cleanup)
21. Upgrade local plugin cache to v0.4.6

## Scope Completion: will reach COMPLETE at step 21
## Outstanding In-Scope Work: steps 10-21 pending

## Major Upgrade Review: N/A

No dependency bumps, Action SHA changes, or Node version bumps. Pure
additive error-classification module + CI replacement.

## Breaking Changes: none

- All existing companion error paths still work. The new vendor-code
  classifier runs before (not instead of) the HTTP status fallbacks,
  so unknown / non-BigModel errors still get the existing HTTP_ERROR /
  RATE_LIMITED / AUTH_FAILED / BAD_REQUEST / NOT_FOUND surfaces.
- Consumers that read `errorCode` get richer values when BigModel
  returns a recognized vendor code, but the field remains a string
  and none of the existing values are removed.
- New `retry` field on failure shapes (`immediate` / `after-cooldown` /
  `never` / `unknown`) is additive. Existing consumers ignoring it
  still work.
- `verify-release.yml` removal: since the workflow never successfully
  ran, zero behavior change for users. Tag-time validation coverage
  shifts from GitHub (never worked) to local pre-push (actually works).

## Repo Usage Audit

- New module: `scripts/lib/bigmodel-errors.mjs` (119 lines, no external
  imports beyond standard library).
- Modified: `scripts/lib/glm-client.mjs` (imports new module + adds
  vendor-classification branch in runChatRequest + adds `retry` field
  to each existing failureShape call).
- New test file: `tests/bigmodel-errors.test.mjs` (140 lines, 17 tests).
- New CI script: `scripts/ci/check-release-ready.sh` (exec +x, 60
  lines).
- Modified: `scripts/hooks/pre-push` (adds tag-detection loop invoking
  check-release-ready.sh).
- Deleted: `.github/workflows/verify-release.yml`.
- Version bump in 3 manifest files + CHANGELOG v0.4.6 section.
- `~/Project/knowledge/agent-hallucination-patterns.md` appendix
  updated (tracked in personal knowledge dir, not repo).

## Verification Plan

| Layer | Tool | Pass criterion |
|---|---|---|
| Static | `npm run check` | All modules parse; import graph resolves |
| Unit | `npm test` | 111/111 pass (65 existing + 20 bigmodel-errors + 26 retry) |
| Manifest | `check-plugin-manifest.sh` | Version 0.4.6 consistent across 3 JSON files |
| CHANGELOG | `check-changelog-updated.sh` | `## v0.4.6` section present |
| Leak guard | `check-no-local-paths.sh` | No internal paths leaked |
| Cross-AI | `check-cross-ai-review.mjs` | adversarial review referenced |
| Companion UAT | `test-automation/uat-reports/v0.4.5/run-uat.sh` | All scenarios (A-J) still PASS — v0.4.6 additive-only so v0.4.5 UAT still valid |
| Adversarial | `/codex:adversarial-review` preferred, else `/glm:adversarial-review` with waiver | No unresolved CRITICAL/HIGH |
| Gitea CI | `.github/workflows/ai-quality-gate.yml` + `pr-check.yml` | both green (verify-release.yml no longer exists) |
| GitHub CI | same 2 workflows | both green (verify-release.yml disabled on GitHub) |
| **Release gate** | `bash scripts/ci/check-release-ready.sh v0.4.6` | All 4 checks pass (runs automatically in pre-push on tag push) |
| **Post-release live** | Simulated 1305 error path | classifier surfaces SERVICE_OVERLOADED with correct message referencing model name |

## Local Verification

To be populated after `ci:local` + adversarial review complete.

## CI Evidence

To be populated after Gitea PR #5 + PR #6 CI runs complete.

## Rollback

Extremely low risk.

- **Immediate**: `git revert` the feature PR merge commit on main.
  Companion falls back to v0.4.5 error handling (generic
  RATE_LIMITED). Workflows stay where they are (verify-release.yml
  still deleted + disabled; no regression there).
- **Full**: revert to v0.4.5 tag, delete tag v0.4.6, unmark GitHub
  release Latest, re-mark v0.4.5 Latest. Re-add verify-release.yml
  from v0.4.5 tree IF anyone actually wants the broken workflow back
  (they don't).
- Zero config-file mutations by this release; users never need to
  re-run `/glm:setup`.
