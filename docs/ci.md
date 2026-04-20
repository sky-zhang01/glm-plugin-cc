# CI System

> Source of truth for what runs on every PR and tag, and why.
> Last updated: 2026-04-21 (Bundle G rollout).

## Runtime

Two hosts share the same workflow files under `.github/workflows/`.

| Host | Role | Runner |
|------|------|--------|
| gitea — `SkyLab/glm-plugin-cc` | primary repo | self-hosted `act_runner` on TrueNAS; reads `.github/workflows/` directly |
| GitHub — `sky-zhang01/glm-plugin-cc` | public mirror | GitHub-hosted `ubuntu-latest` |

There is no duplication. `act_runner` on gitea consumes the same
YAML, so the PR-check / AI-quality-gate / release gates stay in
parity across both hosts.

## Workflow files

### `pr-check.yml`

Runs on `pull_request` and `push` to `main`. The full pre-merge gate.
Mirrors `scripts/ci/check-all.sh`:

1. `npm run check` — JS syntax + static import graph
2. `npm test` — unit + integration (`node --test`)
3. `bash scripts/ci/check-no-local-paths.sh` — path / IP / MAC / private-domain leak guard
4. `bash scripts/ci/check-plugin-manifest.sh` — `.claude-plugin/*` schema + version parity
5. `bash scripts/ci/check-changelog-updated.sh` *(PR only)* — require CHANGELOG diff when substantive source files change
6. `bash scripts/ci/check-coauthored-by.sh` *(PR only)* — AI-authored commits must carry a `Co-Authored-By:` trailer

### `ai-quality-gate.yml`

1. **static-invariants** — `bash scripts/ci/check-ai-quality-gate.sh`.
   Each bug fixed during Bundles C / D3+ / E+ / F is encoded as a grep
   invariant so a future AI pass cannot silently re-introduce it.
2. **cross-ai-review-advisory** *(PR only, `continue-on-error`)* — node
   script `scripts/ci/check-cross-ai-review.mjs` pulls the PR comment
   thread via API; if the PR author is `claude-code` / `codex` and no
   independent comment from the counterpart AI is present, the job
   prints an `ADVISORY` line. Advisory only — does not block merge.

### `release.yml`

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

`main` is protected on both gitea and GitHub:

- Require PR — direct push to `main` rejected
- Require `pr-check` + `ai-quality-gate/static-invariants` to pass
- Require approval from `sky` (CODEOWNERS)
- Dismiss stale approvals on new commits

Configure / re-apply with:

```bash
bash scripts/setup/configure-gitea-protection.sh
```

(GitHub protection uses the same file; see the script header for the
GitHub variant.)

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
  (`sky`) retains the final call; the CI only surfaces when an AI PR
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
