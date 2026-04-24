import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { renderReviewResult } from "../scripts/lib/render.mjs";
import {
  buildReviewValidationContext,
  validateReviewFinding,
  validateStructuralReviewResult
} from "../scripts/lib/validators/review-structural.mjs";

function makeRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glm-validator-"));
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "src/app.js"),
    [
      "export function loadUser(id) {",
      "  if (!id) return null;",
      "  return fetchUser(id);",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  return repoRoot;
}

function baseFinding(overrides = {}) {
  return {
    severity: "high",
    title: "Missing null guard",
    body: "The `fetchUser` call can run with an invalid id.",
    file: "src/app.js",
    line_start: 3,
    line_end: 3,
    confidence: 0.9,
    recommendation: "Guard before calling `fetchUser`.",
    ...overrides
  };
}

function parsedResult(findings) {
  return {
    parsed: {
      verdict: "needs-attention",
      summary: "validator test",
      findings,
      next_steps: []
    }
  };
}

function context(repoRoot, changedFiles = ["src/app.js"]) {
  return buildReviewValidationContext({ repoRoot, changedFiles });
}

describe("review structural validators — finding tiers", () => {
  it("cross-checks a finding with target file, sane line range, and local anchor", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(baseFinding(), context(repoRoot));
    assert.equal(validated.confidence_tier, "cross-checked");
    assert.equal(validated.validation_signals.find((s) => s.kind === "file_in_target").result, "pass");
    assert.equal(validated.validation_signals.find((s) => s.kind === "line_range_in_file").result, "pass");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "pass");
    assert.equal(validated.validation_signals.find((s) => s.kind === "known_false_reference_absent").result, "pass");
  });

  it("rejects a finding whose file is outside the reviewed target set", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(baseFinding({ file: "src/other.js" }), context(repoRoot));
    assert.equal(validated.confidence_tier, "rejected");
    assert.equal(validated.validation_signals.find((s) => s.kind === "file_in_target").result, "fail");
    assert.equal(validated.validation_signals.find((s) => s.kind === "line_range_in_file").result, "skip");
  });

  it("rejects a finding whose line range is outside the cited file", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(baseFinding({ line_start: 99, line_end: 99 }), context(repoRoot));
    assert.equal(validated.confidence_tier, "rejected");
    assert.equal(validated.validation_signals.find((s) => s.kind === "line_range_in_file").result, "fail");
  });

  it("keeps an anchor miss as proposed instead of hard-rejecting the finding", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(
      baseFinding({
        body: "The `totallyMissingSymbol` claim is not present near the cited line.",
        recommendation: "Check `totallyMissingSymbol`."
      }),
      context(repoRoot)
    );
    assert.equal(validated.confidence_tier, "proposed");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "fail");
  });

  it("rejects known-false cross-project references", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(
      baseFinding({
        body: "This mentions workflow_governor, which is a known false reference for this plugin."
      }),
      context(repoRoot)
    );
    assert.equal(validated.confidence_tier, "rejected");
    assert.equal(validated.validation_signals.find((s) => s.kind === "known_false_reference_absent").result, "fail");
  });
});

describe("validateStructuralReviewResult — storage and render contract", () => {
  it("annotates stored findings with validation signals and pass telemetry", () => {
    const repoRoot = makeRepo();
    const { result, pass } = validateStructuralReviewResult(
      parsedResult([baseFinding(), baseFinding({ file: "src/other.js" })]),
      context(repoRoot)
    );

    assert.equal(result.validationApplied, true);
    assert.equal(result.parsed.findings[0].confidence_tier, "cross-checked");
    assert.equal(result.parsed.findings[1].confidence_tier, "rejected");
    assert.equal(result.parsed.findings[0].validation_signals.length, 4);
    assert.equal(pass.status, "completed");
    assert.equal(pass.totalFindings, 2);
    assert.equal(pass.tierCounts.cross_checked, 1);
    assert.equal(pass.tierCounts.rejected, 1);
  });

  it("skips validation without failing the whole job when the model payload failed parsing", () => {
    const repoRoot = makeRepo();
    const failure = { parsed: null, parseError: "TRUNCATED_JSON", rawOutput: "{" };
    const { result, pass } = validateStructuralReviewResult(failure, context(repoRoot));
    assert.equal(result, failure);
    assert.equal(pass.status, "skipped");
    assert.equal(pass.totalFindings, 0);
  });

  it("preserves pipeline-assigned cross-checked tier in human output", () => {
    const repoRoot = makeRepo();
    const { result } = validateStructuralReviewResult(parsedResult([baseFinding()]), context(repoRoot));
    const rendered = renderReviewResult(result, { reviewLabel: "Review", targetLabel: "test diff" });
    assert.match(rendered, /tier cross-checked/);
    assert.doesNotMatch(rendered, /tier proposed/);
  });

  it("hides rejected findings from default human output while retaining them in JSON/storage", () => {
    const repoRoot = makeRepo();
    const { result } = validateStructuralReviewResult(
      parsedResult([baseFinding({ file: "src/other.js", title: "Outside target" })]),
      context(repoRoot)
    );
    const rendered = renderReviewResult(result, { reviewLabel: "Review", targetLabel: "test diff" });
    assert.equal(result.parsed.findings[0].confidence_tier, "rejected");
    assert.doesNotMatch(rendered, /Outside target/);
    assert.match(rendered, /Rejected findings hidden from default output: 1/);
  });
});
