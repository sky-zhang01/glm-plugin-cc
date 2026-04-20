import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression guard for H-1 / H-3 / H-4: the set of {{VARS}} in each prompt
// template must exactly match the keys the companion passes at the
// interpolateTemplate call site. Pre-fix, the sets had ZERO overlap —
// every /glm:review and /glm:adversarial-review call shipped empty
// repository context to GLM because interpolateTemplate silently
// replaces unmatched {{VAR}} with "".

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function extractTemplateVars(templatePath) {
  const raw = fs.readFileSync(templatePath, "utf8");
  const vars = new Set();
  const regex = /\{\{([A-Z_]+)\}\}/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    vars.add(match[1]);
  }
  return vars;
}

// Keep in sync with runReview in scripts/glm-companion.mjs. These are
// the keys the companion passes to interpolateTemplate. If you add a
// new template variable, add it here AND in runReview.
const EXPECTED_REVIEW_KEYS = new Set([
  "REVIEW_KIND",
  "TARGET_LABEL",
  "USER_FOCUS",
  "REVIEW_COLLECTION_GUIDANCE",
  "REVIEW_INPUT"
]);

function diffSet(a, b) {
  const onlyA = [...a].filter((x) => !b.has(x));
  const onlyB = [...b].filter((x) => !a.has(x));
  return { onlyA, onlyB };
}

test("prompts/adversarial-review.md template vars ⊆ companion keys", () => {
  const vars = extractTemplateVars(
    path.join(repoRoot, "prompts", "adversarial-review.md")
  );
  const { onlyA } = diffSet(vars, EXPECTED_REVIEW_KEYS);
  assert.deepEqual(
    onlyA,
    [],
    `Template references undeclared variables: ${onlyA.join(", ")}`
  );
});

test("prompts/review.md template vars ⊆ companion keys", () => {
  const vars = extractTemplateVars(path.join(repoRoot, "prompts", "review.md"));
  const { onlyA } = diffSet(vars, EXPECTED_REVIEW_KEYS);
  assert.deepEqual(
    onlyA,
    [],
    `Template references undeclared variables: ${onlyA.join(", ")}`
  );
});

test("companion keys are all actually used by at least one template", () => {
  const adv = extractTemplateVars(
    path.join(repoRoot, "prompts", "adversarial-review.md")
  );
  const bal = extractTemplateVars(
    path.join(repoRoot, "prompts", "review.md")
  );
  const allTemplateVars = new Set([...adv, ...bal]);
  const orphanKeys = [...EXPECTED_REVIEW_KEYS].filter(
    (k) => !allTemplateVars.has(k)
  );
  // REVIEW_KIND is currently passed but neither template uses it as a
  // placeholder (mode differentiation lives in mode-specific prose).
  // That's acceptable — pass is a no-op. But warn by asserting the
  // orphan list stays short and explicit.
  assert.ok(
    orphanKeys.length <= 1,
    `Too many companion keys unused by any template: ${orphanKeys.join(", ")}`
  );
});

test("runReview source actually passes EXPECTED_REVIEW_KEYS (regression guard)", () => {
  const companion = fs.readFileSync(
    path.join(repoRoot, "scripts", "glm-companion.mjs"),
    "utf8"
  );
  // Locate the runReview interpolateTemplate call site.
  const runReviewIdx = companion.indexOf("async function runReview(");
  assert.ok(runReviewIdx >= 0, "runReview not found in glm-companion.mjs");
  const interpolateIdx = companion.indexOf(
    "interpolateTemplate(promptTemplate",
    runReviewIdx
  );
  assert.ok(interpolateIdx > runReviewIdx, "interpolateTemplate call not found inside runReview");
  const endOfCall = companion.indexOf("});", interpolateIdx);
  const block = companion.slice(interpolateIdx, endOfCall);

  for (const key of EXPECTED_REVIEW_KEYS) {
    assert.ok(
      block.includes(`${key}:`),
      `runReview's interpolateTemplate call is missing key "${key}"`
    );
  }
});
