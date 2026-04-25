<!-- PR TEMPLATE — maintainer-owned release workflow. -->

## Summary
<!-- One sentence of *what* changed, one sentence of *why*. -->

## Changes
<!-- Bullet list of user-visible or code-structural changes. Link
     relevant bug / issue IDs. -->

-

## Risk / Impact
<!-- What surface area does this touch? What could regress? -->

-

## Test plan
<!-- Concrete checklist of what you actually ran. Prefer
     copy-pasteable commands. -->

- [ ] `npm run ci:local` passes locally
- [ ]

## CI / governance self-check

- [ ] `CHANGELOG.md` updated with a user-facing entry for this change
- [ ] Commit messages follow `<type>: <description>` and include
      `Co-Authored-By:` when the work was drafted by an AI (Claude Code
      / Codex)
- [ ] No local paths (`/Users/...`), internal IPs, MAC addresses, or
      private domains in tracked files
- [ ] `.claude-plugin/plugin.json` + `marketplace.json` version parity
      verified (if the version bumped)

## Cross-AI review (soft requirement when author is `claude-code` or `codex`)

When this PR is authored by one AI identity, it is expected that the
*other* AI identity has posted an independent, challenging review in
the comment thread before the maintainer merges. The
`ai-quality-gate` workflow surfaces this as advisory — the maintainer
may still merge without it, but should note the reason.

- [ ] Maintainer: cross-AI review present, or explicitly waived
