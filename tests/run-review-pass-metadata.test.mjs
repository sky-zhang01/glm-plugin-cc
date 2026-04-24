/**
 * M0 integration guard — runReview wiring for pass-level metadata (v0.4.8)
 *
 * sev-verifier caught a HIGH issue in the initial M0 pass:
 *   - `runTrackedJob` in tracked-jobs.mjs wrote `passes` correctly (unit
 *     tested in pass-metadata.test.mjs) but runReview in glm-companion.mjs
 *     had its own writeJobFile call that bypassed runTrackedJob entirely,
 *     so real /glm:review and /glm:adversarial-review stored jobs had
 *     NO passes metadata.
 *
 * This file guards the wiring via two complementary strategies:
 *   1. Unit tests on the exported `buildPassesField` helper so the
 *      compute path is correct (completed / failed / bad dates / clamping).
 *   2. Structural assertions against glm-companion.mjs source so the
 *      helper stays wired into runReview's writeJobFile call — catches
 *      the specific regression verifier flagged.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const companionSource = fs.readFileSync(
  path.join(repoRoot, "scripts/glm-companion.mjs"),
  "utf8"
);

async function importCompanion(suffix = "") {
  return import(
    `${repoRoot}/scripts/glm-companion.mjs?t=${Date.now()}-${suffix}-${Math.random()}`
  );
}

// ── Unit tests on buildPassesField ─────────────────────────────────────────

describe("buildPassesField — compute path", () => {
  it("completed status yields model.status='completed' + non-negative durationMs", async () => {
    const { buildPassesField } = await importCompanion("completed");
    const startedAt = "2026-04-24T10:00:00.000Z";
    const completedAt = "2026-04-24T10:00:01.500Z";
    const passes = buildPassesField(startedAt, completedAt, "completed");
    assert.equal(passes.model.status, "completed");
    assert.equal(passes.model.durationMs, 1500);
    assert.equal(passes.validation, null);
    assert.equal(passes.rerank, null);
  });

  it("failed status yields model.status='failed' with durationMs >= 0", async () => {
    const { buildPassesField } = await importCompanion("failed");
    const startedAt = "2026-04-24T10:00:00.000Z";
    const completedAt = "2026-04-24T10:00:00.250Z";
    const passes = buildPassesField(startedAt, completedAt, "failed");
    assert.equal(passes.model.status, "failed");
    assert.equal(passes.model.durationMs, 250);
  });

  it("non-'completed' finalStatus collapses to 'failed' (defensive)", async () => {
    const { buildPassesField } = await importCompanion("defensive");
    const passes = buildPassesField(
      "2026-04-24T10:00:00.000Z",
      "2026-04-24T10:00:00.001Z",
      "cancelled"
    );
    // M0 tier enum covers completed/failed only; anything non-'completed'
    // collapses to failed so downstream consumers do not see stray states.
    assert.equal(passes.model.status, "failed");
  });

  it("unparseable timestamps produce durationMs=0 (no NaN leak)", async () => {
    const { buildPassesField } = await importCompanion("unparseable");
    const passes = buildPassesField("not-a-date", "also-not-a-date", "completed");
    assert.equal(passes.model.durationMs, 0);
    assert.equal(Number.isNaN(passes.model.durationMs), false);
  });

  it("nullish startedAt or completedAt produces durationMs=0", async () => {
    const { buildPassesField } = await importCompanion("nullish");
    assert.equal(buildPassesField(null, "2026-04-24T10:00:00.000Z", "completed").model.durationMs, 0);
    assert.equal(buildPassesField("2026-04-24T10:00:00.000Z", undefined, "completed").model.durationMs, 0);
    assert.equal(buildPassesField(undefined, undefined, "completed").model.durationMs, 0);
  });

  it("reversed timestamps (completed before started) clamp to 0, not negative", async () => {
    const { buildPassesField } = await importCompanion("clamp");
    const passes = buildPassesField(
      "2026-04-24T10:00:01.000Z",
      "2026-04-24T10:00:00.000Z",
      "completed"
    );
    assert.equal(passes.model.durationMs, 0);
  });

  it("validation and rerank stay null as M1/M5 placeholders", async () => {
    const { buildPassesField } = await importCompanion("placeholders");
    const passes = buildPassesField(
      "2026-04-24T10:00:00.000Z",
      "2026-04-24T10:00:01.000Z",
      "completed"
    );
    assert.equal(passes.validation, null, "M1 placeholder must stay null in M0");
    assert.equal(passes.rerank, null, "M5 placeholder must stay null in M0");
  });
});

// ── Structural guards: runReview must wire the helper ───────────────────────
//
// These grep-style assertions catch the regression pattern verifier caught:
// a helper exists and passes unit tests, but no production caller invokes it.
// They protect the INTEGRATION in a way a pure unit test cannot.

describe("runReview wiring — glm-companion.mjs writeJobFile path", () => {
  it("exports buildPassesField as a top-level function", () => {
    assert.match(
      companionSource,
      /export\s+function\s+buildPassesField\s*\(/,
      "buildPassesField must be exported so tests and future callers can import it"
    );
  });

  it("runReview body invokes buildPassesField (helper is wired)", () => {
    // Extract the body of runReview so the assertion cannot false-pass on
    // a mere module-level reference — the call must live inside runReview.
    const runReviewStart = companionSource.indexOf("async function runReview(");
    assert.ok(runReviewStart !== -1, "runReview function must exist in companion source");
    // Slice until the next top-level 'async function ' or end of file; this
    // is a coarse upper bound but good enough to scope the grep.
    const afterRunReview = companionSource.slice(runReviewStart + 1);
    const nextTopLevel = afterRunReview.search(/\nasync function |\nfunction /);
    const runReviewBody =
      nextTopLevel === -1
        ? companionSource.slice(runReviewStart)
        : companionSource.slice(runReviewStart, runReviewStart + 1 + nextTopLevel);

    assert.match(
      runReviewBody,
      /buildPassesField\s*\(/,
      "runReview body must call buildPassesField — helper must be wired into the production path"
    );
  });

  it("runReview passes the computed field as `passes` in writeJobFile payload", () => {
    // Guard the exact contract: the payload object given to writeJobFile
    // inside runReview includes a `passes` key. This catches the narrower
    // regression where someone adds buildPassesField call but forgets to
    // thread the result into the stored job.
    const runReviewStart = companionSource.indexOf("async function runReview(");
    const afterRunReview = companionSource.slice(runReviewStart + 1);
    const nextTopLevel = afterRunReview.search(/\nasync function |\nfunction /);
    const runReviewBody =
      nextTopLevel === -1
        ? companionSource.slice(runReviewStart)
        : companionSource.slice(runReviewStart, runReviewStart + 1 + nextTopLevel);

    const writeJobFileStart = runReviewBody.indexOf("writeJobFile(");
    assert.ok(writeJobFileStart !== -1, "runReview must call writeJobFile");
    // Capture roughly the next ~400 chars — more than enough to cover the
    // payload object literal.
    const writeJobFileRegion = runReviewBody.slice(writeJobFileStart, writeJobFileStart + 400);
    assert.match(
      writeJobFileRegion,
      /\bpasses\b/,
      "runReview's writeJobFile payload must include a `passes` key"
    );
  });

  it("runReview sanitizes model-owned evidence fields before render/store", () => {
    const runReviewStart = companionSource.indexOf("async function runReview(");
    const afterRunReview = companionSource.slice(runReviewStart + 1);
    const nextTopLevel = afterRunReview.search(/\nasync function |\nfunction /);
    const runReviewBody =
      nextTopLevel === -1
        ? companionSource.slice(runReviewStart)
        : companionSource.slice(runReviewStart, runReviewStart + 1 + nextTopLevel);

    assert.match(
      runReviewBody,
      /sanitizeReviewResultForStorageM0\s*\(\s*result\s*\)/,
      "runReview must sanitize model-owned confidence_tier/validation_signals before storage"
    );
    assert.match(
      runReviewBody,
      /renderReviewResult\s*\(\s*storedResult\s*,/,
      "runReview must render the sanitized result, not the raw model result"
    );
    assert.match(
      runReviewBody,
      /result:\s*storedResult/,
      "runReview must store the sanitized result, not the raw model result"
    );
  });

  it("runReview --json output uses the sanitized result and includes passes", () => {
    const runReviewStart = companionSource.indexOf("async function runReview(");
    const afterRunReview = companionSource.slice(runReviewStart + 1);
    const nextTopLevel = afterRunReview.search(/\nasync function |\nfunction /);
    const runReviewBody =
      nextTopLevel === -1
        ? companionSource.slice(runReviewStart)
        : companionSource.slice(runReviewStart, runReviewStart + 1 + nextTopLevel);

    const outputStart = runReviewBody.indexOf("outputCommandResult(");
    assert.ok(outputStart !== -1, "runReview must call outputCommandResult");
    const outputRegion = runReviewBody.slice(outputStart, outputStart + 700);
    assert.match(
      outputRegion,
      /result:\s*storedResult/,
      "runReview JSON payload must expose the sanitized result, not the raw model result"
    );
    assert.match(
      outputRegion,
      /\bpasses\b/,
      "runReview JSON payload must include the same passes metadata as the stored job"
    );
  });
});
