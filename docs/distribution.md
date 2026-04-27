# Distribution

`glm-plugin-cc` is distributed as a Claude Code plugin from the GitHub
repository and tagged GitHub releases.

## Current channel

Use the plugin marketplace flow:

```text
/plugin marketplace add https://github.com/sky-zhang01/glm-plugin-cc
/plugin install glm@glm-plugin-cc
```

The repository contains the Claude plugin manifest under `.claude-plugin/`.
The Node package metadata exists for local checks and scripts, not for npm
publication.

## Public tree workflow

Do not push the development tree directly to the public remote. Build a public
tree first:

```bash
npm run public:check
npm run public:build -- --ref <ref> --out /tmp/glm-plugin-cc-public
```

The public tree builder removes paths listed in `public-surface.json` and runs
the public-surface gate on the generated tree. Review the generated tree before
pushing it.

## Package policy

`package.json` intentionally keeps `"private": true`.

Reasons:

- The runtime is a Claude Code plugin, not a reusable npm library.
- The install surface is the plugin manifest plus repository source.
- Publishing an npm package now would create a second distribution contract
  before the review prompts and GLM-specific grounding behaviour settle.

## Future options

Possible future distribution work:

- attach a source archive or packed plugin artifact to GitHub releases
- add a reproducible packaging check that verifies the plugin manifest,
  command files, prompts, schemas, and scripts included in the release
- publish to a broader plugin marketplace if a stable public marketplace
  flow exists

Do not publish to npm until there is a concrete consumer that needs npm as
the install channel.
