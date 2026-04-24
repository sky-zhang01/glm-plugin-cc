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

import { classifyParseFailure, classifyReviewPayload, stripMarkdownFences } from "../scripts/lib/glm-client.mjs";

function validFinding(overrides = {}) {
  return {
    severity: "high",
    title: "Unsafe default",
    body: "The change weakens a guard.",
    file: "scripts/example.mjs",
    line_start: 1,
    line_end: 2,
    confidence: 0.9,
    recommendation: "Restore the guard.",
    ...overrides
  };
}

function validPayload(overrides = {}) {
  return {
    verdict: "approve",
    summary: "Looks good.",
    findings: [],
    next_steps: [],
    ...overrides
  };
}

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
    const payload = validPayload();
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "valid");
    assert.equal(result.errorCode, null);
  });

  it("accepts payload with findings array populated", () => {
    const payload = validPayload({
      verdict: "needs-attention",
      summary: "Two issues found.",
      findings: [validFinding()]
    });
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "valid");
  });

  it("accepts valid M0 confidence_tier and validation_signals fields", () => {
    const payload = validPayload({
      findings: [
        validFinding({
          confidence_tier: "proposed",
          validation_signals: [
            { kind: "file_in_target", result: "pass", artifact: "scripts/example.mjs" }
          ]
        })
      ]
    });
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
      findings: [],
      next_steps: []
    };
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "valid");
  });
});

describe("classifyReviewPayload — INVALID_SHAPE detection", () => {
  it("flags missing verdict", () => {
    const payload = { summary: "ok", findings: [], next_steps: [] };
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "invalid_shape");
    assert.equal(result.errorCode, "INVALID_SHAPE");
    assert.match(result.message, /verdict/);
  });

  it("flags missing summary", () => {
    const payload = { verdict: "approve", findings: [], next_steps: [] };
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "invalid_shape");
    assert.match(result.message, /summary/);
  });

  it("flags findings not being an array", () => {
    const payload = { verdict: "approve", summary: "ok", findings: "nope", next_steps: [] };
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

  it("flags missing next_steps from the shipped top-level schema", () => {
    const payload = { verdict: "approve", summary: "ok", findings: [] };
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "invalid_shape");
    assert.match(result.message, /next_steps/);
  });

  it("flags finding objects missing required fields from the shipped schema", () => {
    const payload = validPayload({
      findings: [{ severity: "high", title: "t", body: "b", file: "f", line_start: 1, line_end: 1 }]
    });
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "invalid_shape");
    assert.match(result.message, /confidence/);
    assert.match(result.message, /recommendation/);
  });

  it("flags malformed confidence_tier instead of accepting model-owned tier claims", () => {
    const payload = validPayload({
      findings: [validFinding({ confidence_tier: "not-a-tier" })]
    });
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "invalid_shape");
    assert.match(result.message, /confidence_tier/);
  });

  it("flags validation_signals when the field is not an array", () => {
    const payload = validPayload({
      findings: [validFinding({ validation_signals: {} })]
    });
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "invalid_shape");
    assert.match(result.message, /validation_signals/);
  });

  it("flags malformed validation_signals entries", () => {
    const payload = validPayload({
      findings: [validFinding({ validation_signals: [{ kind: "file_in_target", result: "maybe" }] })]
    });
    const result = classifyReviewPayload(payload);
    assert.equal(result.kind, "invalid_shape");
    assert.match(result.message, /result/);
  });
});

// v0.4.7 expanded-sweep follow-ups: half-fence handling + parse-failure
// classification. Derived from sidecar evidence at
// test-automation/review-eval/results/v0.4.7/payloads/*.json that showed
// 5 distinct ways parsed=null can happen; the old harness silently masked
// them all as "schema=0 with errorCode=''".
describe("stripMarkdownFences — half-fence fallbacks", () => {
  it("strips open-only fence (truncated before closing ```)", () => {
    // Observed at C3 temp=1 run 2: model started with ```json\n then
    // produced valid-looking JSON but ran out of budget before emitting
    // the closing ```.
    const openOnly = '```json\n{"verdict": "approve", "findings": []}';
    const stripped = stripMarkdownFences(openOnly);
    assert.equal(stripped, '{"verdict": "approve", "findings": []}');
  });

  it("strips open-only fence without json tag", () => {
    const openOnly = '```\n{"ok": true}';
    assert.equal(stripMarkdownFences(openOnly), '{"ok": true}');
  });

  it("strips close-only fence (rare: model forgot opening ```)", () => {
    const closeOnly = '{"verdict": "approve"}\n```';
    const stripped = stripMarkdownFences(closeOnly);
    assert.equal(stripped, '{"verdict": "approve"}');
  });

  it("prefers full-fence match over half-fence fallback", () => {
    // Ensure the full-fence regex wins so existing behavior is preserved
    // when the response is well-formed.
    const full = '```json\n{"a":1}\n```';
    assert.equal(stripMarkdownFences(full), '{"a":1}');
  });

  it("does not false-positive on plain prose containing triple backticks mid-line", () => {
    // A response like "The code ``` inside ``` is wrong" should not
    // accidentally get stripped. Our open-only regex anchors at start
    // with `^```(?:json)?\s*\n` so mid-line backticks are safe.
    const prose = 'Error: prose ``` inside ``` text';
    assert.equal(stripMarkdownFences(prose), prose);
  });
});

describe("classifyParseFailure — 5 typed modes", () => {
  it("EMPTY_RESPONSE: blank rawOutput", () => {
    const result = classifyParseFailure("", "", null);
    assert.equal(result.errorCode, "EMPTY_RESPONSE");
    assert.match(result.message, /empty response/i);
  });

  it("EMPTY_RESPONSE: whitespace-only rawOutput", () => {
    const result = classifyParseFailure("   \n\n  ", "", null);
    assert.equal(result.errorCode, "EMPTY_RESPONSE");
  });

  it("REASONING_LEAK: <thinking> tag with no JSON (observed C2 t0 s1337 r3)", () => {
    const raw = "<thinking>\nLet me examine the actual code changes...\n</thinking>";
    const result = classifyParseFailure(raw, raw, "Unexpected token <");
    assert.equal(result.errorCode, "REASONING_LEAK");
    assert.match(result.message, /internal reasoning/i);
  });

  it("REASONING_LEAK: <thinking> block even when followed by prose, as long as no verdict", () => {
    const raw = "<thinking>reasoning here</thinking>\nI need to look at the files first.";
    const result = classifyParseFailure(raw, raw, "Unexpected token <");
    assert.equal(result.errorCode, "REASONING_LEAK");
  });

  it("REASONING_LEAK does NOT fire when the response happens to start with <thinking> but also contains verdict", () => {
    // Edge case: GLM might put <thinking>, then still produce the JSON.
    // In that case we don't want to misclassify — a subsequent JSON
    // attempt should extract the JSON, not be branded REASONING_LEAK.
    const raw = '<thinking>thinking</thinking>\n{"verdict":"approve","summary":"ok","findings":[]}';
    const result = classifyParseFailure(raw, raw, "Unexpected token <");
    assert.notEqual(result.errorCode, "REASONING_LEAK");
  });

  it("MARKDOWN_FENCE_UNTERMINATED: starts with ```json but no closing ```", () => {
    const raw = '```json\n{"verdict":"approve","summary":"ok","findings":[';
    // After stripMarkdownFences half-fence fallback:
    const cleaned = '{"verdict":"approve","summary":"ok","findings":[';
    const result = classifyParseFailure(raw, cleaned, "Unexpected end");
    assert.equal(result.errorCode, "MARKDOWN_FENCE_UNTERMINATED");
    assert.match(result.message, /unterminated markdown fence/i);
  });

  it("TRUNCATED_JSON: cleaned starts with { but JSON.parse failed", () => {
    // No fence at all, just raw JSON that got cut off.
    const raw = '{"verdict":"approve","summary":"midway';
    const cleaned = raw;  // no fence to strip
    const result = classifyParseFailure(raw, cleaned, "Unexpected end of JSON input");
    assert.equal(result.errorCode, "TRUNCATED_JSON");
    assert.match(result.message, /truncation/i);
  });

  it("PARSE_FAILURE: catchall for unclassified parse errors", () => {
    // Content doesn't look like JSON, not thinking-tagged, no fence.
    const raw = "I cannot review this code as I don't have the necessary context.";
    const result = classifyParseFailure(raw, raw, "Unexpected token I");
    assert.equal(result.errorCode, "PARSE_FAILURE");
  });

  it("priority: EMPTY_RESPONSE over other checks", () => {
    // If rawOutput is empty, we return EMPTY_RESPONSE regardless of
    // parseError value.
    const result = classifyParseFailure("", "", "some parse error");
    assert.equal(result.errorCode, "EMPTY_RESPONSE");
  });

  it("priority: REASONING_LEAK before MARKDOWN_FENCE (thinking tag takes precedence)", () => {
    // Edge case: response starts with <thinking>...</thinking>```json\n
    // — ambiguous. We prefer REASONING_LEAK since the thinking leak is
    // the upstream root cause.
    const raw = '<thinking>reasoning</thinking>\n```json\n{partial';
    const result = classifyParseFailure(raw, raw, "Unexpected token");
    assert.equal(result.errorCode, "REASONING_LEAK");
  });
});
