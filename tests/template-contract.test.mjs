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

// Regression guard for MED-3 / m-2: buildReviewSystemPrompt previously
// had a fallback branch that emitted "verdict (ready|needs_fixes|blocked)"
// when `safeReadSchema` returned null. That enum does not match the
// shipped schema (`approve` | `needs-attention`) — a corrupt shipped
// schema would silently produce reviews with a drifted vocabulary. Fix:
// always load via readOutputSchema and drop the fallback string.
test("no drifted verdict enum leaks from buildReviewSystemPrompt fallback (regression: MED-3)", () => {
  const companion = fs.readFileSync(
    path.join(repoRoot, "scripts", "glm-companion.mjs"),
    "utf8"
  );
  assert.ok(
    !companion.includes("ready|needs_fixes|blocked"),
    "drifted fallback verdict enum still present in glm-companion.mjs; shipped schema uses approve|needs-attention"
  );
  assert.ok(
    !/function\s+safeReadSchema\b/.test(companion),
    "safeReadSchema wrapper still present — should have been removed so readOutputSchema can fail-closed on a corrupt shipped schema"
  );
});

// Regression guard for MED-1: writeConfigFile previously merged through
// `safeReadConfigOrNull` which swallowed corruption. The function itself
// was left defined (dead) even after the fix, inviting accidental reuse.
// Delete keeps the "dead code -> regression vector" door shut.
test("no dead safeReadConfigOrNull lingering in preset-config.mjs (regression: MED-1)", () => {
  const presetConfig = fs.readFileSync(
    path.join(repoRoot, "scripts", "lib", "preset-config.mjs"),
    "utf8"
  );
  assert.ok(
    !/function\s+safeReadConfigOrNull\b/.test(presetConfig),
    "safeReadConfigOrNull still defined — delete it so no future caller silently reintroduces M-A"
  );
});

test("runReview stores explicit reviewMode for renderer policy split", () => {
  const companion = fs.readFileSync(
    path.join(repoRoot, "scripts", "glm-companion.mjs"),
    "utf8"
  );
  const runReviewIdx = companion.indexOf("async function runReview(");
  assert.ok(runReviewIdx >= 0, "runReview not found in glm-companion.mjs");
  const metaIdx = companion.indexOf("const meta = {", runReviewIdx);
  assert.ok(metaIdx > runReviewIdx, "runReview meta object not found");
  const endOfMeta = companion.indexOf("};", metaIdx);
  const metaBlock = companion.slice(metaIdx, endOfMeta);
  assert.match(metaBlock, /reviewMode:\s*adversarial\s*\?\s*"adversarial-review"\s*:\s*"review"/);
});

test("adversarial prompt declares bounded challenge surfaces without becoming a pentest platform", () => {
  const prompt = fs.readFileSync(
    path.join(repoRoot, "prompts", "adversarial-review.md"),
    "utf8"
  );
  assert.match(prompt, /<challenge_surfaces>/);
  assert.match(prompt, /correctness under stress/);
  assert.match(prompt, /state and data integrity/);
  assert.match(prompt, /trust boundaries touched by the diff/);
  assert.match(prompt, /not a general pentest\/security platform/);
});

test("command docs declare the M2 renderer default split", () => {
  const reviewCommand = fs.readFileSync(path.join(repoRoot, "commands", "review.md"), "utf8");
  const adversarialCommand = fs.readFileSync(
    path.join(repoRoot, "commands", "adversarial-review.md"),
    "utf8"
  );

  assert.match(reviewCommand, /at least `medium` severity/);
  assert.match(reviewCommand, /at least `cross-checked`/);
  assert.match(reviewCommand, /capped at 5 visible findings/);
  assert.match(adversarialCommand, /from `low` severity upward/);
  assert.match(adversarialCommand, /from `proposed` tier upward/);
  assert.match(adversarialCommand, /capped at 15\s+visible findings/);
});
