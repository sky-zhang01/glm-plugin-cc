/**
 * Unit tests for the review-payload validator and markdown-fence stripper.
 *
 * Guards the parse-layer defenses added in v0.4.7:
 *   - `stripMarkdownFences` removes ```json ... ``` wrappers GLM-5.1 has
 *     been observed producing despite the explicit "do not wrap" rule.
 *   - `classifyReviewPayload` distinguishes a real review payload
 *     (verdict + summary + findings) from the two observed failure
 *     modes: schema-echo (`$schema` root, no content) and invalid-shape
 *     (missing required fields).
 *
 * These guards are INDEPENDENT of sampling parameters and GLM model
 * version — they sit on the parse side, not the generation side. So
 * these tests lock in behavior that should survive model updates.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { classifyReviewPayload, stripMarkdownFences } from "../scripts/lib/glm-client.mjs";

describe("stripMarkdownFences", () => {
  it("removes ```json ... ``` wrapper", () => {
    const wrapped = "```json\n{\"verdict\": \"approve\"}\n```";
    assert.equal(stripMarkdownFences(wrapped), '{"verdict": "approve"}');
  });

  it("removes bare ``` ... ``` wrapper with no language tag", () => {
    const wrapped = "```\n{\"verdict\": \"approve\"}\n```";
    assert.equal(stripMarkdownFences(wrapped), '{"verdict": "approve"}');
  });

  it("preserves inner newlines and whitespace", () => {
    const wrapped = '```json\n{\n  "verdict": "approve",\n  "findings": []\n}\n```';
    const stripped = stripMarkdownFences(wrapped);
    assert.ok(stripped.includes("\n"));
    assert.ok(stripped.startsWith("{"));
    assert.ok(stripped.endsWith("}"));
  });

  it("leaves un-fenced JSON untouched", () => {
    const plain = '{"verdict": "approve"}';
    assert.equal(stripMarkdownFences(plain), plain);
  });

  it("only strips outermost fence (does not recursively unwrap)", () => {
    const doubleFenced = '```json\n```nested\nstuff\n```\n```';
    const stripped = stripMarkdownFences(doubleFenced);
    assert.ok(stripped.includes("```nested"), "inner fence must be preserved verbatim");
  });

  it("returns non-string input unchanged", () => {
    assert.equal(stripMarkdownFences(null), null);
    assert.equal(stripMarkdownFences(undefined), undefined);
    assert.deepEqual(stripMarkdownFences(42), 42);
  });

  it("handles leading/trailing whitespace around fence", () => {
    const wrapped = '\n\n```json\n{"ok": true}\n```\n  \n';
    assert.equal(stripMarkdownFences(wrapped), '{"ok": true}');
  });
});

describe("classifyReviewPayload — valid payloads", () => {
  it("accepts a minimal valid review payload", () => {
    const payload = {
      verdict: "approve",
      summary: "Looks good.",
      findings: []
    };
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "valid");
    assert.equal(result.errorCode, null);
  });

  it("accepts payload with findings array populated", () => {
    const payload = {
      verdict: "needs-attention",
      summary: "Two issues found.",
      findings: [
        { severity: "high", title: "t", body: "b", file: "f", line_start: 1, line_end: 2 }
      ]
    };
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "valid");
  });
});

describe("classifyReviewPayload — SCHEMA_ECHO detection", () => {
  it("detects the exact failure shape observed in v0.4.5 dogfood", () => {
    // Reproduces the payload shape logged in
    // test-automation/uat-reports/v0.4.5 adversarial review first call:
    // GLM returned the schema definition itself with no review content.
    const payload = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["verdict", "summary", "findings", "next_steps"],
      properties: {
        verdict: { type: "string", enum: ["approve", "needs-attention"] },
        summary: { type: "string" },
        findings: { type: "array" }
      }
    };
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "schema_echo");
    assert.equal(result.errorCode, "SCHEMA_ECHO");
    assert.match(result.message, /schema definition instead of review findings/i);
  });

  it("detects schema-echo even without $schema key when type+properties are both present", () => {
    const payload = {
      type: "object",
      properties: {
        verdict: { type: "string" }
      },
      required: ["verdict"]
    };
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "schema_echo");
  });

  it("does NOT misclassify a valid payload that happens to include a $schema field alongside content", () => {
    // Defensive: a future schema revision could include $schema as a
    // metadata field. As long as verdict/summary/findings are present,
    // it's valid, not schema-echo.
    const payload = {
      $schema: "https://example.com/review-schema.json",
      verdict: "approve",
      summary: "ok",
      findings: []
    };
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "valid");
  });
});

describe("classifyReviewPayload — INVALID_SHAPE detection", () => {
  it("flags missing verdict", () => {
    const payload = { summary: "ok", findings: [] };
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "invalid_shape");
    assert.equal(result.errorCode, "INVALID_SHAPE");
    assert.match(result.message, /verdict/);
  });

  it("flags missing summary", () => {
    const payload = { verdict: "approve", findings: [] };
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "invalid_shape");
    assert.match(result.message, /summary/);
  });

  it("flags findings not being an array", () => {
    const payload = { verdict: "approve", summary: "ok", findings: "nope" };
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "invalid_shape");
    assert.match(result.message, /findings/);
  });

  it("flags null input", () => {
    const result = classifyReviewPayload(null);
    assert.equal(result.kind, "invalid_shape");
  });

  it("flags array input (payload must be an object)", () => {
    const result = classifyReviewPayload([{ verdict: "approve" }]);
    assert.equal(result.kind, "invalid_shape");
  });

  it("flags primitive input", () => {
    assert.equal(classifyReviewPayload("string").kind, "invalid_shape");
    assert.equal(classifyReviewPayload(42).kind, "invalid_shape");
    assert.equal(classifyReviewPayload(true).kind, "invalid_shape");
  });

  it("lists ALL missing fields in the message (not just the first)", () => {
    const payload = { findings: [] };  // missing verdict + summary
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "invalid_shape");
    assert.match(result.message, /verdict/);
    assert.match(result.message, /summary/);
  });
});
