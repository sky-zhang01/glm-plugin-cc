# Release Card — glm-plugin-cc v0.4.8

Status: READY — v0.4.8 released.

## Scope Completion: COMPLETE

v0.4.8 delivers the grounded review substrate:

- structural review validators and confidence tiers
- distinct balanced/adversarial review prompts and render policies
- fail-closed review context handling for oversized diffs
- repo-owned literal checks under `.glm/checks/`
- fixture-aware review-eval harness baselines
- opt-in `--reflect` rerank lane with ROI evidence, kept off by default

## Release Ref

- Version: `0.4.8`
- Tag: `v0.4.8`
- Release commit: `50932456af720df385647c58614b1b2fba99b6ae`
- Public releases: published on both primary public mirrors.

## Verification

- `node --test`: 312/312 pass
- `npm run ci:local`: pass
- `bash scripts/ci/check-release-ready.sh v0.4.8`: pass
- Manifests: `package.json`, `.claude-plugin/plugin.json`, and
  `.claude-plugin/marketplace.json` all report `0.4.8`

## Deferred

- stronger balanced-review acceptance fixtures
- rolling review-design follow-up
- broader actor-isolation/governance hardening

## Rollback

- Do not pass `--reflect` to keep the v0.4.8 rerank lane disabled.
- For oversized diffs, narrow the reviewed scope or explicitly raise
  `--max-diff-files` / `--max-diff-bytes`.
- Full rollback means reverting the v0.4.8 release commit, moving the public
  release pointer back to the previous version, and publishing a corrective
  follow-up release.
