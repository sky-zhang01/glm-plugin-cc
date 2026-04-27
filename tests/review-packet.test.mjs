import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  REVIEW_PACKET_SCHEMA_VERSION,
  REVIEW_PACKET_STATUS,
  CONTEXT_INPUT_MODES,
  CONTEXT_FAILURE_CODES,
  assertPacketShape,
  buildCompletedPacket,
  buildContextFailedPacket,
  sha256Hex
} from "../scripts/lib/review-packet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const PACKET_SCHEMA_PATH = path.join(repoRoot, "schemas", "review-packet.schema.json");

const SAMPLE_HASH = crypto.createHash("sha256").update("template", "utf8").digest("hex");

function baseProvenance(overrides = {}) {
  return {
    plugin_version: "0.4.8-test",
    review_mode: "review",
    job_id: "job-abc",
    generated_at: "2026-04-26T00:00:00.000Z",
    base_ref: "1111111111111111111111111111111111111111",
    head_ref: "2222222222222222222222222222222222222222",
    model_requested: "glm-4.6",
    model_responded: null,
    prompt_template_name: "review",
    prompt_template_sha256: SAMPLE_HASH,
    system_prompt_sha256: SAMPLE_HASH,
    final_prompt_sha256: SAMPLE_HASH,
    ...overrides
  };
}

function baseContext(overrides = {}) {
  return {
    input_mode: CONTEXT_INPUT_MODES.INLINE_DIFF,
    diff_bytes: 12345,
    file_count: 3,
    max_diff_files: 50,
    max_diff_bytes: 384 * 1024,
    diff_included_files: ["a.js", "b.js"],
    omitted_files: [],
    ...overrides
  };
}

function basePasses(overrides = {}) {
  return {
    model: { status: "completed", durationMs: 100 },
    validation: { status: "passed" },
    rerank: null,
    ...overrides
  };
}

function baseReviewOutput(overrides = {}) {
  return {
    verdict: "approve",
    summary: "Looks good.",
    findings: [],
    next_steps: ["Merge after CI."],
    ...overrides
  };
}

describe("sha256Hex", () => {
  it("returns a 64-char lowercase hex string", () => {
    const out = sha256Hex("hello");
    assert.equal(out.length, 64);
    assert.match(out, /^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    assert.equal(sha256Hex("abc"), sha256Hex("abc"));
  });

  it("differs for different inputs", () => {
    assert.notEqual(sha256Hex("a"), sha256Hex("b"));
  });

  it("handles UTF-8 characters consistently with crypto", () => {
    const utf8 = "评审包络 — 日本語混在";
    const expected = crypto.createHash("sha256").update(utf8, "utf8").digest("hex");
    assert.equal(sha256Hex(utf8), expected);
  });

  it("rejects non-string input", () => {
    assert.throws(() => sha256Hex(123), TypeError);
    assert.throws(() => sha256Hex(null), TypeError);
    assert.throws(() => sha256Hex(undefined), TypeError);
    assert.throws(() => sha256Hex({}), TypeError);
  });
});

describe("buildCompletedPacket", () => {
  it("returns a frozen packet with status completed", () => {
    const packet = buildCompletedPacket({
      reviewOutput: baseReviewOutput(),
      provenance: baseProvenance(),
      context: baseContext(),
      passes: basePasses(),
      repoChecks: []
    });

    assert.equal(packet.schema_version, REVIEW_PACKET_SCHEMA_VERSION);
    assert.equal(packet.status, REVIEW_PACKET_STATUS.COMPLETED);
    assert.equal(packet.review_output.verdict, "approve");
    assert.equal(packet.context.input_mode, "inline-diff");
    assert.equal(packet.provenance.plugin_version, "0.4.8-test");
    assert.equal(packet.provenance.prompt_template_sha256, SAMPLE_HASH);
    assert.ok(Object.isFrozen(packet));
    assert.ok(Object.isFrozen(packet.provenance));
    assert.ok(Object.isFrozen(packet.context));
    assert.ok(Object.isFrozen(packet.context.diff_included_files));
  });

  it("requires review_output to carry verdict/summary/findings/next_steps", () => {
    const incomplete = baseReviewOutput();
    delete incomplete.next_steps;
    assert.throws(
      () =>
        buildCompletedPacket({
          reviewOutput: incomplete,
          provenance: baseProvenance(),
          context: baseContext(),
          passes: basePasses()
        }),
      /missing required field "next_steps"/
    );
  });

  it("rejects empty plugin_version", () => {
    assert.throws(
      () =>
        buildCompletedPacket({
          reviewOutput: baseReviewOutput(),
          provenance: baseProvenance({ plugin_version: "" }),
          context: baseContext(),
          passes: basePasses()
        }),
      /plugin_version/
    );
  });

  it("rejects unknown review_mode", () => {
    assert.throws(
      () =>
        buildCompletedPacket({
          reviewOutput: baseReviewOutput(),
          provenance: baseProvenance({ review_mode: "council" }),
          context: baseContext(),
          passes: basePasses()
        }),
      /review_mode/
    );
  });

  it("rejects malformed sha256 hashes", () => {
    assert.throws(
      () =>
        buildCompletedPacket({
          reviewOutput: baseReviewOutput(),
          provenance: baseProvenance({ prompt_template_sha256: "not-a-hash" }),
          context: baseContext(),
          passes: basePasses()
        }),
      /prompt_template_sha256/
    );
  });

  it("accepts null sha256 fields", () => {
    const packet = buildCompletedPacket({
      reviewOutput: baseReviewOutput(),
      provenance: baseProvenance({
        prompt_template_sha256: null,
        system_prompt_sha256: null,
        final_prompt_sha256: null
      }),
      context: baseContext(),
      passes: basePasses()
    });
    assert.equal(packet.provenance.prompt_template_sha256, null);
  });

  it("rejects unsupported context.input_mode", () => {
    assert.throws(
      () =>
        buildCompletedPacket({
          reviewOutput: baseReviewOutput(),
          provenance: baseProvenance(),
          context: baseContext({ input_mode: "self-collect" }),
          passes: basePasses()
        }),
      /input_mode/
    );
  });

  it("rejects non-positive diff budgets", () => {
    assert.throws(
      () =>
        buildCompletedPacket({
          reviewOutput: baseReviewOutput(),
          provenance: baseProvenance(),
          context: baseContext({ max_diff_files: 0 }),
          passes: basePasses()
        }),
      /max_diff_files/
    );
    assert.throws(
      () =>
        buildCompletedPacket({
          reviewOutput: baseReviewOutput(),
          provenance: baseProvenance(),
          context: baseContext({ max_diff_bytes: -1 }),
          passes: basePasses()
        }),
      /max_diff_bytes/
    );
  });

  it("requires passes to declare model/validation/rerank slots", () => {
    assert.throws(
      () =>
        buildCompletedPacket({
          reviewOutput: baseReviewOutput(),
          provenance: baseProvenance(),
          context: baseContext(),
          passes: { model: null, validation: null }
        }),
      /passes\.rerank/
    );
  });

  it("strips extra/foreign fields from provenance and context inputs", () => {
    const packet = buildCompletedPacket({
      reviewOutput: baseReviewOutput(),
      provenance: {
        ...baseProvenance(),
        leaked_api_key: "sk-secret-123",
        absolute_log_path: "ABS_FIXTURE_LOG_PATH_PLACEHOLDER"
      },
      context: {
        ...baseContext(),
        full_diff_text: "huge diff body",
        env_vars: { OPENAI_API_KEY: "sk-leak" }
      },
      passes: basePasses()
    });

    const serialized = JSON.stringify(packet);
    assert.ok(!serialized.includes("leaked_api_key"));
    assert.ok(!serialized.includes("sk-secret-123"));
    assert.ok(!serialized.includes("full_diff_text"));
    assert.ok(!serialized.includes("OPENAI_API_KEY"));
    assert.ok(!serialized.includes("sk-leak"));
    assert.ok(!serialized.includes("absolute_log_path"));
    assert.ok(!serialized.includes("ABS_FIXTURE_LOG_PATH_PLACEHOLDER"));
  });
});

describe("buildContextFailedPacket", () => {
  it("returns a frozen packet with status context-failed", () => {
    const packet = buildContextFailedPacket({
      failure: {
        error_code: CONTEXT_FAILURE_CODES.DIFF_TOO_LARGE,
        reason: "Review diff exceeds inline budget (file count 73 > 50)."
      },
      contextFailure: {
        error_code: CONTEXT_FAILURE_CODES.DIFF_TOO_LARGE,
        file_count: 73,
        diff_bytes: 512344,
        max_diff_files: 50,
        max_diff_bytes: 384 * 1024
      },
      provenance: baseProvenance({
        review_mode: "adversarial-review",
        prompt_template_name: "adversarial-review",
        prompt_template_sha256: null,
        system_prompt_sha256: null,
        final_prompt_sha256: null,
        model_requested: null,
        model_responded: null
      }),
      passes: { model: null, validation: null, rerank: null }
    });

    assert.equal(packet.status, REVIEW_PACKET_STATUS.CONTEXT_FAILED);
    assert.equal(packet.failure.error_code, "DIFF_TOO_LARGE");
    assert.equal(packet.context_failure.file_count, 73);
    assert.equal(packet.provenance.review_mode, "adversarial-review");
    assert.ok(!("review_output" in packet));
    assert.ok(!("context" in packet));
    assert.ok(Object.isFrozen(packet));
  });

  it("rejects unknown error codes", () => {
    assert.throws(
      () =>
        buildContextFailedPacket({
          failure: { error_code: "WHATEVER", reason: "x" },
          contextFailure: {
            error_code: "WHATEVER",
            file_count: 1,
            diff_bytes: 1,
            max_diff_files: 1,
            max_diff_bytes: 1
          },
          provenance: baseProvenance(),
          passes: { model: null, validation: null, rerank: null }
        }),
      /error_code/
    );
  });

  it("rejects empty failure.reason", () => {
    assert.throws(
      () =>
        buildContextFailedPacket({
          failure: { error_code: CONTEXT_FAILURE_CODES.DIFF_TOO_LARGE, reason: "" },
          contextFailure: {
            error_code: CONTEXT_FAILURE_CODES.DIFF_TOO_LARGE,
            file_count: 1,
            diff_bytes: 1,
            max_diff_files: 1,
            max_diff_bytes: 1
          },
          provenance: baseProvenance(),
          passes: { model: null, validation: null, rerank: null }
        }),
      /failure\.reason/
    );
  });
});

describe("assertPacketShape", () => {
  it("rejects completed packet missing review_output", () => {
    const packet = {
      schema_version: REVIEW_PACKET_SCHEMA_VERSION,
      status: "completed",
      provenance: baseProvenance(),
      context: baseContext(),
      passes: basePasses()
    };
    assert.throws(() => assertPacketShape(packet), /review_output/);
  });

  it("rejects completed packet that includes failure", () => {
    const packet = {
      schema_version: REVIEW_PACKET_SCHEMA_VERSION,
      status: "completed",
      review_output: baseReviewOutput(),
      provenance: baseProvenance(),
      context: baseContext(),
      passes: basePasses(),
      failure: { error_code: "DIFF_TOO_LARGE", reason: "x" }
    };
    assert.throws(() => assertPacketShape(packet), /must not contain "failure"/);
  });

  it("rejects context-failed packet that includes review_output", () => {
    const packet = {
      schema_version: REVIEW_PACKET_SCHEMA_VERSION,
      status: "context-failed",
      review_output: baseReviewOutput(),
      failure: { error_code: "DIFF_TOO_LARGE", reason: "x" },
      context_failure: {
        error_code: "DIFF_TOO_LARGE",
        file_count: 1,
        diff_bytes: 1,
        max_diff_files: 1,
        max_diff_bytes: 1
      },
      provenance: baseProvenance(),
      passes: { model: null, validation: null, rerank: null }
    };
    assert.throws(() => assertPacketShape(packet), /must not contain "review_output"/);
  });

  it("rejects context-failed packet that includes context", () => {
    const packet = {
      schema_version: REVIEW_PACKET_SCHEMA_VERSION,
      status: "context-failed",
      failure: { error_code: "DIFF_TOO_LARGE", reason: "x" },
      context_failure: {
        error_code: "DIFF_TOO_LARGE",
        file_count: 1,
        diff_bytes: 1,
        max_diff_files: 1,
        max_diff_bytes: 1
      },
      context: baseContext(),
      provenance: baseProvenance(),
      passes: { model: null, validation: null, rerank: null }
    };
    assert.throws(() => assertPacketShape(packet), /must not contain "context"/);
  });

  it("rejects packet with unknown top-level keys", () => {
    const packet = {
      schema_version: REVIEW_PACKET_SCHEMA_VERSION,
      status: "completed",
      review_output: baseReviewOutput(),
      provenance: baseProvenance(),
      context: baseContext(),
      passes: basePasses(),
      side_channel: "smuggle"
    };
    assert.throws(() => assertPacketShape(packet), /unexpected key "side_channel"/);
  });

  it("rejects packet with wrong schema_version", () => {
    const packet = {
      schema_version: "review-packet/v999",
      status: "completed",
      review_output: baseReviewOutput(),
      provenance: baseProvenance(),
      context: baseContext(),
      passes: basePasses()
    };
    assert.throws(() => assertPacketShape(packet), /schema_version/);
  });

  it("accepts a valid completed packet with optional repo_checks", () => {
    const packet = buildCompletedPacket({
      reviewOutput: baseReviewOutput(),
      provenance: baseProvenance(),
      context: baseContext(),
      passes: basePasses(),
      repoChecks: [{ rule_id: "no-mocks", status: "pass" }]
    });
    // Should not throw (build path also calls assertPacketShape internally).
    assert.equal(packet.repo_checks.length, 1);
  });
});

describe("review-packet.schema.json (M8A AC2)", () => {
  const schemaText = fs.readFileSync(PACKET_SCHEMA_PATH, "utf8");
  const schema = JSON.parse(schemaText);

  it("declares additionalProperties: false at top level", () => {
    assert.equal(schema.additionalProperties, false);
  });

  it("declares additionalProperties: false on every $defs object", () => {
    for (const [name, def] of Object.entries(schema.$defs)) {
      if (def.type !== "object") continue;
      assert.equal(
        def.additionalProperties,
        false,
        `$defs.${name} must have additionalProperties: false to bound packet schema`
      );
    }
  });

  it("pins schema_version constant to the JS module constant", () => {
    assert.equal(schema.properties.schema_version.const, REVIEW_PACKET_SCHEMA_VERSION);
  });

  it("status enum matches the JS module constants", () => {
    assert.deepEqual(
      [...schema.properties.status.enum].sort(),
      [REVIEW_PACKET_STATUS.COMPLETED, REVIEW_PACKET_STATUS.CONTEXT_FAILED].sort()
    );
  });

  it("provenance required keys match builder enforcement", () => {
    const required = new Set(schema.$defs.provenance.required);
    for (const key of [
      "plugin_version",
      "review_mode",
      "job_id",
      "generated_at",
      "base_ref",
      "head_ref",
      "model_requested",
      "model_responded",
      "prompt_template_name",
      "prompt_template_sha256",
      "system_prompt_sha256",
      "final_prompt_sha256"
    ]) {
      assert.ok(required.has(key), `provenance required key missing: ${key}`);
    }
  });

  it("context.input_mode enum is restricted to inline-diff (PA1 invariant)", () => {
    assert.deepEqual(
      schema.$defs.context.properties.input_mode.enum,
      [CONTEXT_INPUT_MODES.INLINE_DIFF]
    );
  });

  it("context_failure.error_code enum is restricted to DIFF_TOO_LARGE", () => {
    assert.deepEqual(
      schema.$defs.context_failure.properties.error_code.enum,
      [CONTEXT_FAILURE_CODES.DIFF_TOO_LARGE]
    );
  });

  it("oneOf branches enforce status-driven union", () => {
    const branches = schema.oneOf;
    assert.equal(branches.length, 2);
    const completed = branches.find((b) => b.properties?.status?.const === "completed");
    const failed = branches.find((b) => b.properties?.status?.const === "context-failed");
    assert.deepEqual(completed.required, ["review_output", "context"]);
    assert.deepEqual(failed.required, ["failure", "context_failure"]);
  });
});
