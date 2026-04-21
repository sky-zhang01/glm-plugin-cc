# CI System

> Source of truth for what runs on every PR and tag, and why.

## Branch model

| Branch | Role | Protected? |
|---|---|---|
| `develop` | default branch; all day-to-day PRs target it | yes — PR required, 1 CODEOWNERS approval, status checks, dismiss stale reviews |
| `main` | release line; only receives merge from `develop` + a version tag | yes — same as develop + required linear history; admin may bypass in emergencies |
| feature branches (`feat/*`, `fix/*`, `chore/*`) | short-lived work branches | unprotected; opened off `develop`, PR back into `develop` |

Release flow:
1. Land all changes on `develop` via PR.
2. Open a PR `develop` → `main` when a release is ready.
3. After merge, tag the `main` commit with `vX.Y.Z` to trigger the
   release-gate workflow.

## Runtime

Two hosts share the same workflow files under `.github/workflows/`.

| Host | Role | Runner |
|------|------|--------|
| private primary | primary repo | self-hosted runner; reads `.github/workflows/` directly |
| GitHub — `sky-zhang01/glm-plugin-cc` | public mirror | GitHub-hosted `ubuntu-latest` |

There is no duplication. The self-hosted primary-repo runner consumes
the same YAML as GitHub Actions, so the PR-check / AI-quality-gate /
release gates stay in parity across both hosts.

## Workflow files

### `pr-check.yml`

Runs on `pull_request` and `push` to `develop` and `main`. The full pre-merge gate.
Mirrors `scripts/ci/check-all.sh`:

1. `npm run check` — JS syntax + static import graph
2. `npm test` — unit + integration (`node --test`)
3. `bash scripts/ci/check-no-local-paths.sh` — path / IP / MAC / private-domain leak guard
4. `bash scripts/ci/check-plugin-manifest.sh` — `.claude-plugin/*` schema + version parity
5. `bash scripts/ci/check-changelog-updated.sh` *(PR only)* — require CHANGELOG diff when substantive source files change
6. `bash scripts/ci/check-coauthored-by.sh` *(PR only)* — AI-authored commits must carry a `Co-Authored-By:` trailer

### `ai-quality-gate.yml`

1. **static-invariants** — `bash scripts/ci/check-ai-quality-gate.sh`.
   Each class of bug fixed during the v0.4.3 review passes is encoded
   as a grep invariant so a future AI pass cannot silently re-introduce
   it.
2. **cross-ai-review-advisory** *(PR only, `continue-on-error`)* — node
   script `scripts/ci/check-cross-ai-review.mjs` pulls the PR comment
   thread via API; if the PR author is `claude-code` / `codex` and no
   independent comment from the counterpart AI is present, the job
   prints an `ADVISORY` line. Advisory only — does not block merge.

### `release-gate.yml`

Triggered when a tag `v*.*.*` is pushed. Does not publish; gates
publication. Verifies:

- `package.json` version == tag
- `.claude-plugin/plugin.json` version == `marketplace.json` version == tag
- `CHANGELOG.md` has a `## vX.Y.Z` section for this tag
- `release_card.md` exists and is `Status: READY`

Once this job is green, use `scripts/github-release-create.sh` (or
equivalent gitea helper) to actually publish.

## Local commands

| Command | Effect |
|---------|--------|
| `npm run ci:local` | Run the full pre-merge gate exactly like `pr-check.yml` |
| `npm run ci:local:fast` | Syntax + tests + AI quality gate (for quick iteration) |
| `npm run hooks:install` | Symlink `scripts/hooks/pre-push` into `.git/hooks/` so every push runs `ci:local` first |
| `bash scripts/ci/check-ai-quality-gate.sh` | Just the regression-pattern grep invariants |

Emergency bypass of the pre-push hook: `git push --no-verify`. The
server pipeline still enforces; the bypass only shortens iteration
time when you are certain of what you are pushing.

## Branch protection (enforced server-side)

Both `develop` and `main` are protected on gitea and GitHub:

- Require PR — direct push rejected for non-admin identities
- Require `pr-check` + `static-invariants` status checks to pass
- Require 1 maintainer approval (CODEOWNERS), dismiss stale
  approvals on new commits
- `main` additionally requires **linear history** (no merge commits;
  fast-forward only from `develop`)
- Admin (`sky`) may bypass protection in emergencies — this is the
  tradeoff for solo-maintainer agility

Configure / re-apply gitea with:

```bash
GITEA_HOST=https://your-gitea-host \
GITEA_OWNER=your-org \
GITEA_APPROVER=your-username \
bash scripts/setup/configure-gitea-protection.sh
```

(GitHub protection was applied via `gh api ... /branches/<name>/protection`.
The script is gitea-specific; add a GitHub-equivalent helper if that
re-configuration becomes recurrent.)

## Scripts index

```text
scripts/ci/
├── check-all.sh                  # entry point for npm run ci:local
├── check-no-local-paths.sh       # leak guard
├── check-plugin-manifest.sh      # manifest + version parity
├── check-ai-quality-gate.sh      # regression-pattern invariants
├── check-changelog-updated.sh    # CHANGELOG diff requirement (PR)
├── check-coauthored-by.sh        # Co-Authored-By trailer (PR)
└── check-cross-ai-review.mjs     # cross-AI review advisory (PR)

scripts/hooks/
└── pre-push                      # calls check-all.sh

scripts/install-hooks.sh          # symlinks scripts/hooks/* → .git/hooks/

scripts/setup/
└── configure-gitea-protection.sh # one-shot branch-protection setup
```

## Why this shape

- **Fail-closed regression patterns** — every bug found by review is
  encoded as a grep invariant, so the same class of bug cannot come
  back silently. See `scripts/ci/check-ai-quality-gate.sh` for the
  current rule list.
- **Cross-AI review as advisory, not blocker** — the human approver
  retains the final call; the CI only surfaces when an AI PR
  lands without counterpart review.
- **Release gate separate from release action** — a release tag must
  pass the gate, but the publication itself stays manual to avoid
  accidental pushes to the public GitHub mirror.

## When CI fails

1. Read the failed step's output. Each check script prints a
   single-line `FAIL` banner with a concrete remediation suggestion.
2. Reproduce locally: `npm run ci:local`. If the server passed
   `check-all.sh` but the gate failed, the difference is usually
   CHANGELOG / Co-Authored-By (PR-only checks).
3. If a check is wrong (false positive), update the check script *and*
   add a test, then open a PR. Do not bypass.
