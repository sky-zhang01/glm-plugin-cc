# Contributing

Thanks for taking the time to contribute.

This repo is a Claude Code plugin maintained by a solo maintainer
working with two AI identities (`claude-code` via Claude Code CLI,
`codex` via Codex CLI). The workflow below is tuned for that team
shape.

## Prerequisites

- Node.js ≥ 18.18
- A 智谱 BigModel API key is only required to actually *run* the
  plugin; the test suite is self-contained.

## Set up locally

```bash
git clone https://github.com/sky-zhang01/glm-plugin-cc.git
cd glm-plugin-cc
npm install   # no runtime deps, but installs dev tooling if any
npm run hooks:install   # symlinks the pre-push hook into .git/hooks
```

The pre-push hook runs the full local CI (`npm run ci:local`) before
any push. You can emergency-bypass with `git push --no-verify`, but
the gitea pipeline will still block on the same checks.

## Running tests

```bash
npm run check            # syntax + static imports
npm test                 # unit + integration (node --test)
npm run ci:local         # full local CI (what pre-push runs)
npm run ci:local:fast    # syntax + tests + AI quality gate only
```

## Coding style

- ESM, zero runtime dependencies.
- Fail-closed at trust boundaries: throw with filename + recovery
  hint when config/state/schema files are corrupt. Reuse
  `scripts/lib/fs.mjs formatUserFacingError` for consistent messaging.
- Test every pure helper. The test harness is `node --test`.

## Commit messages

```
<type>: <description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`,
`ci`.

When the commit was drafted by an AI, add a trailer — the `ci`
pipeline checks this:

```
Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Codex  <noreply@openai.com>
```

If a change touches `scripts/`, `commands/`, `schemas/`, `prompts/`,
or `.claude-plugin/`, the CI will require a matching `CHANGELOG.md`
entry in the same PR.

## Branch model (GitFlow-lite)

- **`develop`** is the default branch. All day-to-day PRs target
  `develop`.
- **`main`** is the release line. It only receives merges from
  `develop` (plus a version tag to trigger the release gate).
- Feature branches (`feat/*`, `fix/*`, `chore/*`, `ci/*`) are
  short-lived, opened off `develop`, and PRed back into `develop`.

### Release flow

1. Land changes on `develop` via PR (with CI + maintainer approval).
2. When a release is ready: open a PR `develop` → `main`.
3. After the merge, tag `main` with `vX.Y.Z`. The `release-pipeline.yml`
   workflow verifies `package.json` / `plugin.json` /
   `marketplace.json` version parity, the CHANGELOG entry, and
   `release_card.md Status: READY`.
4. Publish the GitHub release from the CHANGELOG section.

Admin (repo owner) may bypass branch protection in emergencies on
both gitea and GitHub.

## Pull requests

Every substantive change goes through a PR, even for the repo owner.
Use the template `.github/PULL_REQUEST_TEMPLATE.md`; it is the
checklist the CI replicates.

### Cross-AI review expectation

When a PR is authored by one AI (`claude-code`), the other AI
(`codex`) is expected to post an independent, challenging review in
the comment thread before the maintainer merges, and vice versa.
This is a *soft* requirement: the `ai-quality-gate` workflow
surfaces it as advisory, and the maintainer may still merge with an
explicit waiver in the PR comment. The goal is that two AI
identities always cross-check each other's work before it lands on
`main`.

### Approver

The repo maintainer is the only formal approver. See `CODEOWNERS`.

## Release process

See `release_card.md` for the current release and `docs/ci.md` for the
pipeline. Tags are never created until the release card is
`Status: READY`.

## Reporting security issues

See `SECURITY.md`.
