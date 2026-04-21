# Release Card — glm-plugin-cc v0.4.4

Status: READY

Approval Mode: maintainer direct-approval (solo-maintainer repo; single
human approver is also the owner). Repo-local shortcut in effect for
this release: **if Gitea CI is green and adversarial-review is posted
on the PR, the maintainer may auto-merge without a separate approval
event.** This shortcut is one-off for v0.4.4 by maintainer decision and
is intentionally NOT being promoted into `CONTRIBUTING.md` this cycle
(recorded here only per `git-workflow.md` rule: repo-local auto-flow
must be explicit). Future releases revert to the standard "CI +
maintainer approval" flow unless/until documented otherwise.

Intended Ref
- Feature branch: `fix/setup-interactive-menu` off `develop`
- PR #1: `fix/setup-interactive-menu` → `develop` (Gitea)
- PR #2: `develop` → `main` (Gitea)
- Tag: `v0.4.4` annotated, on the `develop → main` merge commit
- Mirrored: GitHub public repo (main + tag + release)

---

## Requested Scope

Two items, both surgical:

**Item 1: UX fix in the `/glm:setup` skill command.**

- When both `preset_id` and `has_api_key` are already set, the skill
  currently outputs the companion JSON report verbatim and exits with
  no interactive surface. Users who want to **rotate their API key**,
  **switch preset**, **ping-test connectivity**, or **toggle the stop
  review gate** must know the exact CLI flags in advance. This is a
  UX dead-end in an API-key-based plugin where in-skill rotation is
  the *only* rotation path (no OAuth fallback, unlike
  `codex:setup`).

- Fix: in the "Both set" branch, use `AskUserQuestion` exactly once to
  surface a menu of actions:

  | Option | Action |
  |---|---|
  | Keep current configuration (done) | exit — preserves current "闭嘴退出" semantics |
  | Rotate API key | one-line paste prompt → `setup --api-key <token>` |
  | Switch preset | four-choice preset menu (Coding Plan / Pay-as-you-go / Custom / Cancel) |
  | Ping test (validate connectivity) | rerun `setup --ping --json` |
  | Toggle review gate (enable/disable) | rerun with `--enable-review-gate` or `--disable-review-gate` |
  | Cancel | exit |

- "Keep current" stays the default-equivalent option so the idempotent
  probe use case (e.g. automated runs, CI smoke checks) is preserved.

**Item 2: Remove `@skylab/` scope from `package.json` name.**

- Current: `"name": "@skylab/glm-plugin-cc"` (npm scope prefix;
  leftover from internal scaffolding; visible on GitHub public repo
  viewer).
- New: `"name": "glm-plugin-cc"` (unscoped; matches the public
  marketplace identifier + repo name).
- Zero functional impact: `"private": true` means the package is
  never published to npm; no `import` / `require` references the old
  name (grep confirmed: only `package.json` L2 carries it).
- This is the last residual `SkyLab` identifier in the tracked repo
  after the v0.4.3 cleanup sweep. The earlier grep pattern
  (`skylab-glm`) missed the bare `@skylab` npm-scope form. This fix
  closes that gap.

## Out of Scope

- No changes to `scripts/glm-companion.mjs` — every menu option maps
  to an already-supported flag combination.
- No changes to `scripts/lib/**` — all secret handling, config I/O,
  formatUserFacingError behavior unchanged.
- No endpoint / model default / config schema changes.
- No `codex:setup` parity work — codex's already-ready branch is
  minimal by design (OAuth rotation is external); the asymmetry is
  intentional, not a bug.
- No new tests for companion behavior (all flags already covered by
  `setup-resilience.test.mjs`).
- No publish automation changes — release is still manual.

## Planned Actions

1. `git checkout develop && git pull && git checkout -b fix/setup-interactive-menu`
2. Edit `commands/setup.md` — replace the single-line "Both set: stop"
   clause with the `AskUserQuestion` branch spec (option labels,
   mapping to companion flags, secret-handling inheritance for the
   "Rotate API key" path).
3. Bump version `0.4.3 → 0.4.4` in:
   - `package.json`
   - `.claude-plugin/plugin.json`
   - `.claude-plugin/marketplace.json` (two places: metadata.version
     + plugins[0].version)
4. Append `## v0.4.4` section to `CHANGELOG.md` under a `### Fixed`
   subheading:
   > `fix(setup): add interactive menu when already configured —
   > users can now rotate the API key, switch preset, run a ping
   > test, or toggle the review gate without memorizing flags. Bare
   > /glm:setup no longer exits silently when config is healthy.`
5. Run `Skill(simplify)` on changed files (expected to be low-surface:
   `commands/setup.md` + version bumps + CHANGELOG entry).
6. Run `npm run ci:local` — must pass end-to-end:
   - `npm run check` (syntax + static import graph)
   - `npm test` (65 tests — no new tests needed; skill change is
     prompt-layer, not Node-layer)
   - `check-plugin-manifest.sh` (version parity across JSON files)
   - `check-changelog-updated.sh` (v0.4.4 entry present)
   - `check-no-local-paths.sh` (leak guard)
   - `check-coauthored-by.sh` (commit trailer)
   - `check-cross-ai-review.mjs` (advisory — codex independent review)
   - `check-ai-quality-gate.sh` (invariant patterns)
7. **Manual UAT (6 scenarios)** — unit tests cannot exercise the
   Claude-side `AskUserQuestion` flow. Must run live in a Claude Code
   session against the local cache at
   `~/.claude/plugins/cache/glm-plugin-cc/glm/0.4.4/` (built from
   feature branch, pre-merge). Scenarios:

   | ID | Precondition | Command | Expected |
   |---|---|---|---|
   | A | Empty config | `/glm:setup` | preset menu → paste key → ready |
   | B | Both set (healthy) | `/glm:setup` | **NEW menu appears**, select "Keep current" → exit |
   | C | Both set (healthy) | `/glm:setup` | select "Rotate API key" → paste → config updated (old key overwritten) |
   | D | Both set (healthy) | `/glm:setup` | select "Switch preset" → Pay-as-you-go → `base_url` switched |
   | E | Both set (healthy) | `/glm:setup` | select "Ping test" → real HTTP probe returns OK |
   | F | Both set (healthy) | `/glm:setup` | select "Toggle review gate" → enable → `reviewGateEnabled: true` |

   Each scenario requires screenshot or JSON evidence captured to
   `test-automation/uat-reports/v0.4.4/`. Scenarios C, D, F must leave
   config in a recoverable state (restore after).

8. Run `/codex:adversarial-review` against **the full feature branch
   context** (not diff-only) — maintainer decision for v0.4.4. Post
   the verdict summary as a comment on the Gitea PR (satisfies
   `check-cross-ai-review.mjs`).
9. Push `fix/setup-interactive-menu` to Gitea + GitHub.
10. Open Gitea PR → `develop`. Paste codex adversarial-review verdict
    in the PR description.
11. **Gate: Gitea CI green + adversarial-review posted** → maintainer
    auto-merges to `develop`. No separate approval event required
    (repo-local shortcut, see Approval Mode).
12. Open Gitea PR `develop` → `main`, merge with linear history.
13. Tag `v0.4.4` annotated on the main merge commit with release
    notes lifted from CHANGELOG.
14. Push `main` and tag to GitHub mirror.
15. **Verify GitHub Actions**: `pr-check.yml`, `ai-quality-gate.yml`,
    `verify-release.yml` all green. If GitHub CI diverges from Gitea,
    block release until reconciled.
16. Publish Gitea release v0.4.4 + GitHub release v0.4.4, both linked
    to CHANGELOG section, GitHub marked `latest`.
17. Upgrade local plugin cache to v0.4.4 at
    `~/.claude/plugins/cache/glm-plugin-cc/glm/0.4.4/` + update
    `installed_plugins.json`. User restarts session.

## Scope Completion: COMPLETE (planned — reaches COMPLETE after step 17)
## Outstanding In-Scope Work: none (as drafted)

## Major Upgrade Review: N/A

No dependency bumps, no Node version bump, no Action SHA changes, no
runtime major upgrade. Change is a documentation-layer skill prompt
edit + version-bump metadata + CHANGELOG entry.

## Breaking Changes: none

- Automated / scripted callers of `/glm:setup` with explicit flags
  (e.g. `--api-key …`, `--ping`) are unaffected — the menu only
  appears when the skill is invoked bare AND both preset + key are
  already set. Any explicit flag short-circuits the menu, same as
  today.
- Users who relied on the "silent success" exit can still get it by
  selecting "Keep current configuration (done)" as option 1.

## Repo Usage Audit

- `commands/setup.md` is the only skill command file touched.
- Companion `handleSetup` in `scripts/glm-companion.mjs` already
  accepts `--preset`, `--base-url`, `--default-model`, `--api-key`,
  `--ping`, `--enable-review-gate`, `--disable-review-gate`. No
  signature change.
- `AskUserQuestion` is already an `allowed-tools` entry in the
  command frontmatter (L4). No permission additions needed.
- Version bump surfaces: `check-plugin-manifest.sh` enforces parity
  across `package.json`, `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json`.

## Verification Plan

| Layer | Tool | Pass criterion |
|---|---|---|
| Static | `npm run check` | All 16 modules parse; import graph resolves |
| Unit | `npm test` | 65/65 pass (no new tests; no regression) |
| Manifest | `check-plugin-manifest.sh` | Version 0.4.4 consistent across 3 JSON files |
| CHANGELOG | `check-changelog-updated.sh` | `## v0.4.4` section present |
| Leak guard | `check-no-local-paths.sh` | No internal paths leaked |
| Cross-AI | `check-cross-ai-review.mjs` | codex review referenced in commit/PR trailer |
| **UAT** | **Manual live /glm:setup in Claude Code** | **All 6 scenarios (A-F) pass** |
| Adversarial | `/codex:adversarial-review` | No CRITICAL or HIGH findings |
| CI Gitea | `.gitea/workflows/*` (if present) or mirror | all green |
| CI GitHub | `.github/workflows/pr-check.yml`, `ai-quality-gate.yml`, `verify-release.yml` | all green |

## Local Verification: not yet run (DRAFT state)

## CI Evidence: not yet run (DRAFT state)

## Rollback

Low-risk — worst case the new menu has bugs.

- **Immediate**: revert the `commands/setup.md` edit. Skill reverts to
  v0.4.3 silent-exit behavior. Companion and lib code are unchanged
  so no data migration needed.
- **Full**: `git revert` the PR merge commit on `main`, delete tag
  `v0.4.4`, unmark GitHub release latest, mark v0.4.3 latest again.
  Publish an immediate v0.4.5 revert tag if Gitea public release
  record needs to stay monotonic.
- Config files in `~/.config/glm-plugin-cc/config.json` are never
  mutated by the skill edit itself — only by user-chosen menu actions
  (which are the same actions available via explicit flags in
  v0.4.3). No state corruption risk.

---

## Maintainer decisions (locked before READY)

1. **Repo-local shortcut documentation**: one-off for v0.4.4.
   `CONTRIBUTING.md` is NOT updated this cycle. (Q1 = b)
2. **UAT evidence location**: new directory `test-automation/uat-reports/v0.4.4/`
   committed inside the repo. Secrets in Scenario C (Rotate API key)
   output MUST be scrubbed before commit. (Q2 = a)
3. **`codex:adversarial-review` scope**: full feature branch context,
   not diff-only. (Q3 = b)
