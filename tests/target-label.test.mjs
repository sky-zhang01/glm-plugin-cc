import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildTargetLabel } from "../scripts/glm-companion.mjs";

// GAP-4 regression guard: buildTargetLabel previously read
// target.base / target.scope (always undefined — resolveReviewTarget
// returns { mode, label, baseRef, explicit }), so the label silently
// fell through to "working tree". The fix uses target.label directly.
// These tests pin the new behaviour so any future regression back
// toward the old field reading would fail at test time.

test("buildTargetLabel uses target.label when no focus is provided", () => {
  const target = { mode: "branch", label: "branch diff against main", baseRef: "main", explicit: true };
  assert.equal(buildTargetLabel(target, ""), "branch diff against main");
});

test("buildTargetLabel appends focus text when present", () => {
  const target = { mode: "working-tree", label: "working tree diff", explicit: true };
  assert.equal(
    buildTargetLabel(target, "auth flow"),
    "working tree diff · focus=auth flow"
  );
});

test("buildTargetLabel shortens very long focus text", () => {
  const target = { mode: "working-tree", label: "working tree diff" };
  const longFocus = "a".repeat(200);
  const result = buildTargetLabel(target, longFocus);
  // shorten() uses a 60-char cap; label should still start with the target label.
  assert.ok(result.startsWith("working tree diff · focus="));
  assert.ok(result.length < longFocus.length);
});

test("buildTargetLabel falls through to 'working tree' when both label and focus are empty", () => {
  assert.equal(buildTargetLabel({}, ""), "working tree");
  assert.equal(buildTargetLabel(null, ""), "working tree");
  assert.equal(buildTargetLabel(undefined, null), "working tree");
});

test("buildTargetLabel never reads target.base / target.scope (pre-fix drift guard)", () => {
  // If somebody reintroduces the pre-fix behaviour, this test will
  // silently fail because the label will come back as "working tree"
  // despite a real target.label being provided.
  const target = {
    mode: "branch",
    label: "branch diff against origin/develop",
    baseRef: "origin/develop",
    // Deliberately include the old field names as "noise" to make sure
    // the function does NOT use them.
    base: "IGNORED_IF_PRE_FIX",
    scope: "IGNORED_IF_PRE_FIX"
  };
  assert.equal(buildTargetLabel(target, ""), "branch diff against origin/develop");
});
