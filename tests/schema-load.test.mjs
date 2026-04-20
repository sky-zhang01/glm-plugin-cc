import { strict as assert } from "node:assert";
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
