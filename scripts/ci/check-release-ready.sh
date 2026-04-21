#!/usr/bin/env bash
# Pre-tag release-readiness gate.
#
# Replaces the broken `.github/workflows/verify-release.yml` (GitHub
# stale-parser issue — see CHANGELOG v0.4.6). Does the same four checks,
# but locally + synchronously, so errors surface BEFORE `git push <tag>`
# rather than as a post-hoc CI red mark.
#
# Usage: bash scripts/ci/check-release-ready.sh vX.Y.Z
#
# Exits non-zero (with a specific message) if:
#   1. tag argument missing or malformed (expected vX.Y.Z)
#   2. package.json version != tag version
#   3. plugin manifest parity check fails (re-uses check-plugin-manifest.sh)
#   4. CHANGELOG.md has no `## vX.Y.Z` section
#   5. release_card.md missing OR not `Status: READY`
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
  echo "✗ Usage: bash scripts/ci/check-release-ready.sh vX.Y.Z" >&2
  exit 2
fi

if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "✗ Tag '$TAG' does not match vX.Y.Z pattern." >&2
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

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Release-ready gate PASSED for $TAG."
echo "  Safe to: git tag -a $TAG -m '...' && git push origin $TAG"
echo "════════════════════════════════════════════════════════════"
