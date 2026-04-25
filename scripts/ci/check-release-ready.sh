#!/usr/bin/env bash
# Pre-tag release-readiness gate.
#
# Replaces the broken `.github/workflows/verify-release.yml` (GitHub
# stale-parser issue — see CHANGELOG v0.4.6). Does the same core checks,
# but locally + synchronously, so errors surface BEFORE `git push <tag>`
# rather than as a post-hoc CI red mark.
#
# Usage: bash scripts/ci/check-release-ready.sh vX.Y.Z[-<prerelease>]
#
# Accepts semver prerelease suffixes (e.g. v0.4.7-beta1, v1.0.0-rc.2)
# per the SemVer 2.0 prerelease grammar. Prereleases intentionally
# use the same gate — they still need a matching CHANGELOG section,
# manifest parity, and a READY release_card. The caller is responsible
# for NOT marking a prerelease as Latest.
#
# Exits non-zero (with a specific message) if:
#   1. tag argument missing or malformed (expected vX.Y.Z or vX.Y.Z-<prerelease>)
#   2. package.json version != tag version
#   3. plugin manifest parity check fails (re-uses check-plugin-manifest.sh)
#   4. CHANGELOG.md has no `## vX.Y.Z[-<prerelease>]` section
#   5. release_card.md missing OR not `Status: READY`
#   6. non-prerelease tag but release_card.md is not `Scope Completion: COMPLETE`
#
# Intended invocation: called manually by the release driver immediately
# before `git tag -a vX.Y.Z ...`, and referenced from RELEASE-CARD-TEMPLATE.
# The pre-push hook also invokes this automatically when the refspec
# includes a `refs/tags/v*` ref.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  echo "✗ Usage: bash scripts/ci/check-release-ready.sh vX.Y.Z[-<prerelease>]" >&2
  exit 2
fi

# SemVer 2.0: prerelease is a dot-separated series of alphanumerics and
# hyphens following a `-`. We use a slightly loose but practical match:
# [A-Za-z0-9.-]+ after a single `-`. Stricter validation would reject
# things like `--` or empty prerelease segments, but the downstream
# `grep` and version-parity checks will fail-fast on those anyway.
if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
  echo "✗ Tag '$TAG' does not match vX.Y.Z or vX.Y.Z-<prerelease> pattern." >&2
  exit 2
fi

VERSION="${TAG#v}"
echo "=== Release-ready gate for $TAG (version $VERSION) ==="

# 1. package.json ↔ tag parity
PKG_VERSION=$(node -p "require('./package.json').version")
if [[ "$PKG_VERSION" != "$VERSION" ]]; then
  echo "✗ package.json version ($PKG_VERSION) ≠ tag version ($VERSION)" >&2
  echo "  Bump package.json to $VERSION before tagging." >&2
  exit 1
fi
echo "  ✓ package.json version = $VERSION"

# 2. Plugin manifest parity (existing shared check)
if ! bash scripts/ci/check-plugin-manifest.sh >/dev/null 2>&1; then
  echo "✗ Plugin manifest parity failed. Run 'bash scripts/ci/check-plugin-manifest.sh' for details." >&2
  exit 1
fi
echo "  ✓ plugin.json / marketplace.json parity"

# 3. CHANGELOG has a section for this version
if ! grep -qE "^## v${VERSION}([[:space:]]|$)" CHANGELOG.md; then
  echo "✗ CHANGELOG.md has no '## v${VERSION}' section." >&2
  echo "  Add the release notes before tagging." >&2
  exit 1
fi
echo "  ✓ CHANGELOG has '## v${VERSION}' section"

# 4. release_card.md exists and is Status: READY
if [[ ! -f release_card.md ]]; then
  echo "✗ release_card.md missing." >&2
  echo "  Create one from ~/Project/workflow/RELEASE-CARD-TEMPLATE.md before tagging." >&2
  exit 1
fi
if ! grep -qE "^Status: READY" release_card.md; then
  echo "✗ release_card.md not marked 'Status: READY'." >&2
  echo "  Current status line:" >&2
  grep -E "^Status:" release_card.md >&2 || echo "  (no Status line found)" >&2
  exit 1
fi
echo "  ✓ release_card.md is Status: READY"

if [[ ! "$VERSION" =~ -[A-Za-z0-9.-]+$ ]]; then
  if ! grep -qE "^## Scope Completion: COMPLETE([[:space:]]|$)" release_card.md; then
    echo "✗ release_card.md is not scope-complete for non-prerelease tag '$TAG'." >&2
    echo "  Expected line: ## Scope Completion: COMPLETE" >&2
    echo "  Current scope line:" >&2
    grep -E "^## Scope Completion:" release_card.md >&2 || echo "  (no Scope Completion line found)" >&2
    exit 1
  fi
  echo "  ✓ release_card.md Scope Completion: COMPLETE"
else
  echo "  ✓ prerelease tag: Scope Completion check skipped"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Release-ready gate PASSED for $TAG."
echo "  Safe to: git tag -a $TAG -m '...' && git push origin $TAG"
echo "════════════════════════════════════════════════════════════"
