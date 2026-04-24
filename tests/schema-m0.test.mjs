/**
 * M0 schema extension tests — v0.4.8
 *
 * Guards the two new optional finding fields introduced in M0:
 *   - `confidence_tier`: enum of trust levels
 *   - `validation_signals`: array of {kind, result, artifact?} objects
 *
 * All new fields are OPTIONAL — existing v0.4.7 findings must still
 * validate and render identically (backward-compat invariant).
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  normalizeReviewFindingM0,
  sanitizeReviewResultForStorageM0,
  validateFindingWithNewFields
} from "../scripts/lib/render.mjs";
import { renderReviewResult } from "../scripts/lib/render.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const schemaPath = path.join(repoRoot, "schemas", "review-output.schema.json");

function loadSchema() {
  return JSON.parse(readFileSync(schemaPath, "utf8"));
}

// Minimal v0.4.7-shape finding
const v047Finding = {
  severity: "high",
  title: "Unhandled null",
  body: "The helper can return null; caller does not guard.",
  file: "src/client.ts",
  line_start: 42,
  line_end: 42,
  confidence: 0.90,
  recommendation: "Return early with a typed error."
};

// Full M0-shape finding with all new optional fields
const m0Finding = {
  ...v047Finding,
  confidence_tier: "cross-checked",
  validation_signals: [
    { kind: "file_in_target", result: "pass" },
    { kind: "anchor_literal_found", result: "fail", artifact: "no literal 'null' found near line 42" }
  ]
};

// Minimal M0 result used by renderReviewResult tests
function makeResult(finding) {
  return {
    parsed: {
      verdict: "needs-attention",
      summary: "One finding.",
      findings: [finding],
      next_steps: []
    }
  };
}

const baseMeta = { reviewLabel: "Review", targetLabel: "working tree diff" };

// ── Schema structural tests ─────────────────────────────────────────────────

describe("review-output.schema.json — M0 additions", () => {
  it("schema has confidence_tier in finding properties", () => {
    const schema = loadSchema();
    const findingProps = schema.properties.findings.items.properties;
    assert.ok(
      findingProps.confidence_tier !== undefined,
      "confidence_tier missing from finding properties"
    );
  });

  it("confidence_tier is NOT in the required array", () => {
    const schema = loadSchema();
    const required = schema.properties.findings.items.required ?? [];
    assert.ok(
      !required.includes("confidence_tier"),
      "confidence_tier must be optional, not required"
    );
  });

  it("confidence_tier enum contains expected values", () => {
    const schema = loadSchema();
    const tierProp = schema.properties.findings.items.properties.confidence_tier;
    assert.deepEqual(
      tierProp.enum,
      ["proposed", "cross-checked", "deterministically-validated", "rejected"]
    );
  });

  it("schema has validation_signals in finding properties", () => {
    const schema = loadSchema();
    const findingProps = schema.properties.findings.items.properties;
    assert.ok(
      findingProps.validation_signals !== undefined,
      "validation_signals missing from finding properties"
    );
  });

  it("validation_signals is NOT in the required array", () => {
    const schema = loadSchema();
    const required = schema.properties.findings.items.required ?? [];
    assert.ok(
      !required.includes("validation_signals"),
      "validation_signals must be optional, not required"
    );
  });

  it("validation_signals is an array of objects with kind/result/artifact?", () => {
    const schema = loadSchema();
    const sigProp = schema.properties.findings.items.properties.validation_signals;
    assert.equal(sigProp.type, "array");
    const itemProps = sigProp.items.properties;
    assert.ok(itemProps.kind !== undefined, "kind missing from signal item");
    assert.ok(itemProps.result !== undefined, "result missing from signal item");
    assert.ok(itemProps.artifact !== undefined, "artifact missing from signal item");
  });

  it("signal kind enum contains all 8 expected values", () => {
    const schema = loadSchema();
    const sigProp = schema.properties.findings.items.properties.validation_signals;
    const kindEnum = sigProp.items.properties.kind.enum;
    const expected = [
      "initial_confidence_score",
      "file_in_target",
      "line_range_in_file",
      "anchor_literal_found",
      "known_false_reference_absent",
      "repo_check",
      "test_result",
      "command_result"
    ];
    assert.deepEqual(kindEnum, expected);
  });

  it("signal result enum is [pass, fail, skip]", () => {
    const schema = loadSchema();
    const sigProp = schema.properties.findings.items.properties.validation_signals;
    assert.deepEqual(sigProp.items.properties.result.enum, ["pass", "fail", "skip"]);
  });

  it("artifact is optional string in signal item", () => {
    const schema = loadSchema();
    const sigProp = schema.properties.findings.items.properties.validation_signals;
    const required = sigProp.items.required ?? [];
    assert.ok(!required.includes("artifact"), "artifact must be optional");
    assert.equal(sigProp.items.properties.artifact.type, "string");
  });

  it("finding still has additionalProperties: false (guard against unknown fields)", () => {
    const schema = loadSchema();
    assert.equal(
      schema.properties.findings.items.additionalProperties,
      false,
      "additionalProperties must remain false on finding item"
    );
  });
});

// ── Backward-compatibility: old-shape finding ───────────────────────────────

describe("renderReviewResult — backward compat (v0.4.7 finding, no new fields)", () => {
  it("old-shape finding validates without error", () => {
    // validateReviewResultShape should accept findings without the new optional fields
    const rendered = renderReviewResult(makeResult(v047Finding), baseMeta);
    // Should not contain "Validation error" heading
    assert.doesNotMatch(rendered, /Validation error/);
    assert.match(rendered, /Unhandled null/);
  });

  it("old-shape finding renders byte-identically to v0.4.7 baseline (no tier suffix)", () => {
    const rendered = renderReviewResult(makeResult(v047Finding), baseMeta);
    // tier should NOT appear when confidence_tier is absent
    assert.doesNotMatch(rendered, /tier /);
    // Standard confidence suffix must still be present
    assert.match(rendered, /\[high · conf 0\.90\] Unhandled null/);
  });
});

// ── New-shape finding: confidence_tier (M0 clamp semantics) ────────────────
//
// At M0 there is no validator pass; confidence_tier is a pipeline-assigned
// evidence state per architecture doc §6.2. Any model-claimed tier is
// untrusted and clamped to `proposed` by the normalizer so hallucinated
// `deterministically-validated` cannot render as if a validator approved it.
// M1 will land the post-normalization validator that assigns tiers from
// actual structural checks and replace these tests with real-tier cases.

describe("renderReviewResult — confidence_tier M0 clamp", () => {
  it("model-claimed tier='cross-checked' clamps to 'proposed' at M0", () => {
    // m0Finding carries confidence_tier: "cross-checked". With no validator
    // in M0, normalizer clamps to `proposed` — never to the unverified claim.
    const rendered = renderReviewResult(makeResult(m0Finding), baseMeta);
    assert.match(rendered, /\[high · conf 0\.90 · tier proposed\]/);
    assert.doesNotMatch(rendered, /tier cross-checked/);
  });

  it("model-claimed tier='rejected' clamps to 'proposed' at M0", () => {
    const rejFinding = { ...v047Finding, confidence_tier: "rejected" };
    const rendered = renderReviewResult(makeResult(rejFinding), baseMeta);
    assert.match(rendered, /tier proposed/);
    assert.doesNotMatch(rendered, /tier rejected/);
  });

  it("model-claimed tier='proposed' stays 'proposed' at M0", () => {
    const propFinding = { ...v047Finding, confidence_tier: "proposed" };
    const rendered = renderReviewResult(makeResult(propFinding), baseMeta);
    assert.match(rendered, /tier proposed/);
  });

  it("model-claimed tier='deterministically-validated' clamps to 'proposed' at M0", () => {
    // This is the specific Codex-external-review HIGH case: prevents a
    // hallucinated 'deterministically-validated' from rendering as if it
    // had been confirmed by a validator that doesn't exist yet.
    const dvFinding = { ...v047Finding, confidence_tier: "deterministically-validated" };
    const rendered = renderReviewResult(makeResult(dvFinding), baseMeta);
    assert.match(rendered, /tier proposed/);
    assert.doesNotMatch(rendered, /tier deterministically-validated/);
  });

  it("malformed tier (not in enum) is dropped, not rendered", () => {
    // Defensive: an invalid string or non-string must not leak into output.
    const malformedFinding = { ...v047Finding, confidence_tier: "super-validated" };
    const rendered = renderReviewResult(makeResult(malformedFinding), baseMeta);
    assert.doesNotMatch(rendered, /tier /, "invalid tier must not render at all");
  });

  it("normalizer drops model-supplied validation_signals while clamping tier", () => {
    // At M0 validation_signals are pipeline-owned, like confidence_tier.
    // Model-supplied signals must not be treated as audit evidence.
    const normalized = normalizeReviewFindingM0(m0Finding, 0);
    assert.equal(normalized.confidence_tier, "proposed", "tier must be clamped to proposed");
    assert.equal(normalized.validation_signals, undefined);
  });
});

// ── New-shape finding: validation_signals are pipeline-owned ────────────────

describe("normalizeReviewFinding — validation_signals M0 clamp", () => {
  it("validation_signals array is dropped by normalizeReviewFinding at M0", () => {
    const normalized = normalizeReviewFindingM0(m0Finding, 0);
    assert.equal(normalized.validation_signals, undefined);
  });

  it("finding without validation_signals has undefined/absent validation_signals after normalize", () => {
    const normalized = normalizeReviewFindingM0(v047Finding, 0);
    // When absent, the field should not be set (or be undefined/null) — not an empty array
    assert.ok(
      normalized.validation_signals === undefined || normalized.validation_signals === null,
      "validation_signals should be absent when not supplied"
    );
  });

  it("finding with mixed signal kinds is still schema-valid but ignored by M0 normalizer", () => {
    const mixed = {
      ...v047Finding,
      validation_signals: [
        { kind: "file_in_target", result: "pass" },
        { kind: "line_range_in_file", result: "fail" },
        { kind: "test_result", result: "skip" }
      ]
    };
    const normalized = normalizeReviewFindingM0(mixed, 0);
    assert.equal(normalized.validation_signals, undefined);
  });
});

describe("sanitizeReviewResultForStorageM0 — pipeline evidence fields", () => {
  it("stores model-claimed tier only as proposed and drops model-supplied signals", () => {
    const sanitized = sanitizeReviewResultForStorageM0(makeResult(m0Finding));
    const [finding] = sanitized.parsed.findings;
    assert.equal(finding.confidence_tier, "proposed");
    assert.equal(finding.validation_signals, undefined);
  });

  it("leaves parse-failure shaped results unchanged", () => {
    const failure = { parsed: null, parseError: "TRUNCATED_JSON", rawOutput: "{" };
    assert.equal(sanitizeReviewResultForStorageM0(failure), failure);
  });

  it("leaves rejected parsed payloads unchanged instead of normalizing them as successful reviews", () => {
    const rejected = {
      rawOutput: "{...}",
      failureMessage: "Review payload findings[0] missing required field(s): recommendation.",
      errorCode: "INVALID_SHAPE",
      parseError: null,
      parsed: {
        verdict: "needs-attention",
        summary: "One finding.",
        findings: [
          { severity: "high", title: "Bad", body: "oops", file: "a.js", line_start: 1, line_end: 1, confidence: 0.9 }
        ],
        next_steps: []
      }
    };
    assert.equal(sanitizeReviewResultForStorageM0(rejected), rejected);
  });

  it("renders rejected parsed payloads as schema failures, not normalized findings", () => {
    const rejected = {
      rawOutput: "{...}",
      failureMessage: "Review payload findings[0] missing required field(s): recommendation.",
      errorCode: "INVALID_SHAPE",
      parseError: null,
      parsed: {
        verdict: "needs-attention",
        summary: "One finding.",
        findings: [
          { severity: "high", title: "Bad", body: "oops", file: "a.js", line_start: 1, line_end: 1, confidence: 0.9 }
        ],
        next_steps: []
      }
    };
    const rendered = renderReviewResult(rejected, baseMeta);
    assert.match(rendered, /GLM did not return valid structured JSON/);
    assert.match(rendered, /missing required field/);
    assert.doesNotMatch(rendered, /Findings:/);
    assert.doesNotMatch(rendered, /Recommendation:/);
  });
});

// ── Schema additionalProperties guard ───────────────────────────────────────

describe("validateFindingWithNewFields — additionalProperties guard", () => {
  it("v0.4.7 finding passes validation", () => {
    const result = validateFindingWithNewFields(v047Finding);
    assert.equal(result, null, `expected null (no error), got: ${result}`);
  });

  it("M0 finding with confidence_tier + validation_signals passes validation", () => {
    const result = validateFindingWithNewFields(m0Finding);
    assert.equal(result, null, `expected null (no error), got: ${result}`);
  });

  it("finding with unknown fourth field fails validation (additionalProperties: false)", () => {
    const unknownField = { ...v047Finding, unknown_field: "should fail" };
    const result = validateFindingWithNewFields(unknownField);
    assert.ok(result !== null, "expected a validation error for unknown field");
    assert.match(result, /unknown_field/);
  });
});
