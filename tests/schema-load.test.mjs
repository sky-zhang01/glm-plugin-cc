import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOutputSchema } from "../scripts/lib/glm-client.mjs";

// GAP-1 regression guards: the structural template-contract tests
// check that the drifted `ready|needs_fixes|blocked` fallback enum
// is gone and that safeReadSchema() was removed — but they do NOT
// verify the positive path (shipped schema actually loads) nor the
// negative path (corrupt shipped schema fails closed with a useful
// error). Both gaps are closed here.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const REVIEW_SCHEMA_PATH = path.join(repoRoot, "schemas", "review-output.schema.json");

test("readOutputSchema loads the shipped review schema successfully", () => {
  const schema = readOutputSchema(REVIEW_SCHEMA_PATH);
  assert.equal(typeof schema, "object");
  assert.equal(schema.type, "object");
  // Pin the verdict enum the rest of the review pipeline depends on.
  assert.deepEqual(
    schema.properties.verdict.enum,
    ["approve", "needs-attention"],
    "shipped schema verdict enum drifted — companion prompt relies on this exact vocabulary"
  );
  // Pin that `confidence` is required on findings so the m-3 fix
  // (normalizeReviewFinding preserves confidence) stays aligned with
  // the schema contract.
  const finding = schema.properties.findings.items;
  assert.ok(
    finding.required.includes("confidence"),
    "schema no longer requires finding.confidence — normalizer must match"
  );
});

test("readOutputSchema fails closed with filename when schema file is corrupt", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-schema-test-"));
  const corruptPath = path.join(tmpDir, "review-output.schema.json");
  fs.writeFileSync(corruptPath, "{ not valid JSON", "utf8");

  // Pre-fix (safeReadSchema wrapper): error was swallowed and the
  // companion silently emitted a drifted verdict enum. Post-fix:
  // readOutputSchema → readJsonFile → throws with the file path so
  // the user knows to reinstall the plugin.
  assert.throws(
    () => readOutputSchema(corruptPath),
    (err) => err.message.includes(corruptPath) && /Could not parse/.test(err.message)
  );
});

test("readOutputSchema surfaces missing-file errors (ENOENT) clearly", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-schema-test-"));
  const missingPath = path.join(tmpDir, "does-not-exist.schema.json");
  assert.throws(
    () => readOutputSchema(missingPath),
    // fs.readFileSync ENOENT path. We don't redact here because the
    // plugin installation is usually under home, but this error only
    // fires in local-test scenarios where the path is /tmp.
    (err) => /ENOENT|no such file/i.test(err.message)
  );
});

// M8A AC1: review-output.schema.json must stay byte-identical to the
// v0.4.8 baseline. The model-output schema is the contract GLM is asked
// to satisfy — adding provenance/context fields here would launder
// unverifiable facts through the model. M8 keeps it frozen and ships a
// separate review-packet.schema.json instead. If this test fails, the
// fix is almost always to revert the schema change rather than update
// the hash. See docs/plans/2026-04-26-m8-review-quality-harness-design.md.
const FROZEN_REVIEW_OUTPUT_SCHEMA_SHA256 =
  "b98ee87463fd7fd6d3362901365de8d0d349bb16a13f6591c609994cc9385d02";

test("review-output.schema.json is byte-identical to v0.4.8 baseline (M8A AC1)", () => {
  const bytes = fs.readFileSync(REVIEW_SCHEMA_PATH);
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    sha,
    FROZEN_REVIEW_OUTPUT_SCHEMA_SHA256,
    "Model-output schema drifted from v0.4.8. M8 keeps the contract frozen; provenance belongs in review-packet.schema.json."
  );
});
