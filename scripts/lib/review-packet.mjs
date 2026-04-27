// Pipeline-owned review packet (M8A).
//
// The packet is a local-only envelope that records what *the runtime* knows
// about a review run: plugin version, prompt hashes, git base/head, diff
// budget, and which validation/rerank passes ran. This is intentionally
// kept out of `schemas/review-output.schema.json` (the model contract) so
// GLM is never asked to self-report facts it cannot reliably know.
//
// Structural validation lives here as small repo-owned guards. M8A does
// not introduce AJV or any runtime schema dependency — the JSON Schema
// document at `schemas/review-packet.schema.json` is documentation for
// downstream tooling, and tests assert agreement between the two.
//
// See docs/plans/2026-04-26-m8-review-quality-harness-design.md.

import crypto from "node:crypto";

export const REVIEW_PACKET_SCHEMA_VERSION = "review-packet/v1";

export const REVIEW_PACKET_STATUS = Object.freeze({
  COMPLETED: "completed",
  CONTEXT_FAILED: "context-failed"
});

export const CONTEXT_INPUT_MODES = Object.freeze({
  INLINE_DIFF: "inline-diff"
});

export const CONTEXT_FAILURE_CODES = Object.freeze({
  DIFF_TOO_LARGE: "DIFF_TOO_LARGE"
});

const HEX_64 = /^[0-9a-f]{64}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

const ALLOWED_REVIEW_MODES = new Set(["review", "adversarial-review"]);

export function sha256Hex(value) {
  if (typeof value !== "string") {
    throw new TypeError("sha256Hex requires a string input");
  }
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function ensureNonEmptyString(name, value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`provenance.${name} must be a non-empty string`);
  }
}

function ensureStringOrNull(name, value) {
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`provenance.${name} must be a string or null`);
  }
}

function ensureHexHashOrNull(name, value) {
  if (value === null) return;
  if (typeof value !== "string" || !HEX_64.test(value)) {
    throw new TypeError(`provenance.${name} must be a 64-char lowercase hex sha256 or null`);
  }
}

function ensureNonNegativeInt(name, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
}

function ensurePositiveInt(name, value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

function ensureStringArray(name, value) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array of strings`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new TypeError(`${name}[] entries must be non-empty strings`);
    }
  }
}

function freezeProvenance(provenance) {
  ensureNonEmptyString("plugin_version", provenance.plugin_version);
  if (!ALLOWED_REVIEW_MODES.has(provenance.review_mode)) {
    throw new TypeError(
      `provenance.review_mode must be one of ${[...ALLOWED_REVIEW_MODES].join(", ")}`
    );
  }
  ensureNonEmptyString("job_id", provenance.job_id);
  ensureNonEmptyString("generated_at", provenance.generated_at);
  if (!ISO_DATETIME.test(provenance.generated_at)) {
    throw new TypeError("provenance.generated_at must be an ISO-8601 datetime");
  }
  ensureStringOrNull("base_ref", provenance.base_ref);
  ensureStringOrNull("head_ref", provenance.head_ref);
  ensureStringOrNull("model_requested", provenance.model_requested);
  ensureStringOrNull("model_responded", provenance.model_responded);
  ensureNonEmptyString("prompt_template_name", provenance.prompt_template_name);
  ensureHexHashOrNull("prompt_template_sha256", provenance.prompt_template_sha256);
  ensureHexHashOrNull("system_prompt_sha256", provenance.system_prompt_sha256);
  ensureHexHashOrNull("final_prompt_sha256", provenance.final_prompt_sha256);

  return Object.freeze({
    plugin_version: provenance.plugin_version,
    review_mode: provenance.review_mode,
    job_id: provenance.job_id,
    generated_at: provenance.generated_at,
    base_ref: provenance.base_ref ?? null,
    head_ref: provenance.head_ref ?? null,
    model_requested: provenance.model_requested ?? null,
    model_responded: provenance.model_responded ?? null,
    prompt_template_name: provenance.prompt_template_name,
    prompt_template_sha256: provenance.prompt_template_sha256 ?? null,
    system_prompt_sha256: provenance.system_prompt_sha256 ?? null,
    final_prompt_sha256: provenance.final_prompt_sha256 ?? null
  });
}

function freezeContext(context) {
  if (context.input_mode !== CONTEXT_INPUT_MODES.INLINE_DIFF) {
    throw new TypeError(
      `context.input_mode must be "${CONTEXT_INPUT_MODES.INLINE_DIFF}"; ` +
        "PA1 removed the silent self-collect fallback (see scripts/lib/git.mjs)."
    );
  }
  ensureNonNegativeInt("context.diff_bytes", context.diff_bytes);
  ensureNonNegativeInt("context.file_count", context.file_count);
  ensurePositiveInt("context.max_diff_files", context.max_diff_files);
  ensurePositiveInt("context.max_diff_bytes", context.max_diff_bytes);
  ensureStringArray("context.diff_included_files", context.diff_included_files);
  ensureStringArray("context.omitted_files", context.omitted_files);

  return Object.freeze({
    input_mode: context.input_mode,
    diff_bytes: context.diff_bytes,
    file_count: context.file_count,
    max_diff_files: context.max_diff_files,
    max_diff_bytes: context.max_diff_bytes,
    diff_included_files: Object.freeze([...context.diff_included_files]),
    omitted_files: Object.freeze([...context.omitted_files])
  });
}

function freezeContextFailure(contextFailure) {
  if (contextFailure.error_code !== CONTEXT_FAILURE_CODES.DIFF_TOO_LARGE) {
    throw new TypeError(
      `context_failure.error_code must be "${CONTEXT_FAILURE_CODES.DIFF_TOO_LARGE}"`
    );
  }
  ensureNonNegativeInt("context_failure.file_count", contextFailure.file_count);
  ensureNonNegativeInt("context_failure.diff_bytes", contextFailure.diff_bytes);
  ensurePositiveInt("context_failure.max_diff_files", contextFailure.max_diff_files);
  ensurePositiveInt("context_failure.max_diff_bytes", contextFailure.max_diff_bytes);

  return Object.freeze({
    error_code: contextFailure.error_code,
    file_count: contextFailure.file_count,
    diff_bytes: contextFailure.diff_bytes,
    max_diff_files: contextFailure.max_diff_files,
    max_diff_bytes: contextFailure.max_diff_bytes
  });
}

function freezeFailure(failure) {
  if (failure.error_code !== CONTEXT_FAILURE_CODES.DIFF_TOO_LARGE) {
    throw new TypeError(
      `failure.error_code must be "${CONTEXT_FAILURE_CODES.DIFF_TOO_LARGE}"`
    );
  }
  if (typeof failure.reason !== "string" || failure.reason.length === 0) {
    throw new TypeError("failure.reason must be a non-empty string");
  }
  return Object.freeze({
    error_code: failure.error_code,
    reason: failure.reason
  });
}

function freezePasses(passes) {
  if (!passes || typeof passes !== "object") {
    throw new TypeError("passes must be an object");
  }
  for (const key of ["model", "validation", "rerank"]) {
    if (!(key in passes)) {
      throw new TypeError(`passes.${key} must be present (object or null)`);
    }
    const value = passes[key];
    if (value !== null && (typeof value !== "object" || Array.isArray(value))) {
      throw new TypeError(`passes.${key} must be an object or null`);
    }
  }
  return Object.freeze({
    model: passes.model ?? null,
    validation: passes.validation ?? null,
    rerank: passes.rerank ?? null
  });
}

function freezeReviewOutput(reviewOutput) {
  if (!reviewOutput || typeof reviewOutput !== "object" || Array.isArray(reviewOutput)) {
    throw new TypeError("review_output must be an object");
  }
  // Cheap structural sanity. Full schema validation is the job of the
  // existing review-payload validator (see scripts/lib/validators) and
  // structural guards in scripts/glm-companion. We only assert here that
  // the four required top-level keys are present, so the packet cannot
  // silently drift from the model contract.
  for (const key of ["verdict", "summary", "findings", "next_steps"]) {
    if (!(key in reviewOutput)) {
      throw new TypeError(`review_output is missing required field "${key}"`);
    }
  }
  return reviewOutput;
}

export function buildCompletedPacket({
  reviewOutput,
  provenance,
  context,
  passes,
  repoChecks = []
}) {
  if (!Array.isArray(repoChecks)) {
    throw new TypeError("repo_checks must be an array (use [] when empty)");
  }
  const packet = {
    schema_version: REVIEW_PACKET_SCHEMA_VERSION,
    status: REVIEW_PACKET_STATUS.COMPLETED,
    review_output: freezeReviewOutput(reviewOutput),
    provenance: freezeProvenance(provenance),
    context: freezeContext(context),
    passes: freezePasses(passes),
    repo_checks: Object.freeze([...repoChecks])
  };
  assertPacketShape(packet);
  return Object.freeze(packet);
}

export function buildContextFailedPacket({
  failure,
  contextFailure,
  provenance,
  passes
}) {
  const packet = {
    schema_version: REVIEW_PACKET_SCHEMA_VERSION,
    status: REVIEW_PACKET_STATUS.CONTEXT_FAILED,
    failure: freezeFailure(failure),
    context_failure: freezeContextFailure(contextFailure),
    provenance: freezeProvenance(provenance),
    passes: freezePasses(passes)
  };
  assertPacketShape(packet);
  return Object.freeze(packet);
}

const PACKET_KEYS_BY_STATUS = {
  completed: {
    required: ["schema_version", "status", "review_output", "provenance", "context", "passes"],
    forbidden: ["failure", "context_failure"],
    optional: ["repo_checks"]
  },
  "context-failed": {
    required: ["schema_version", "status", "failure", "context_failure", "provenance", "passes"],
    forbidden: ["review_output", "context"],
    optional: []
  }
};

export function assertPacketShape(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    throw new TypeError("packet must be a plain object");
  }
  if (packet.schema_version !== REVIEW_PACKET_SCHEMA_VERSION) {
    throw new TypeError(
      `packet.schema_version must be "${REVIEW_PACKET_SCHEMA_VERSION}"`
    );
  }
  const rules = PACKET_KEYS_BY_STATUS[packet.status];
  if (!rules) {
    throw new TypeError(
      `packet.status must be one of ${Object.keys(PACKET_KEYS_BY_STATUS).join(", ")}`
    );
  }
  for (const key of rules.required) {
    if (!(key in packet)) {
      throw new TypeError(`packet (status=${packet.status}) missing required key "${key}"`);
    }
  }
  for (const key of rules.forbidden) {
    if (key in packet) {
      throw new TypeError(
        `packet (status=${packet.status}) must not contain "${key}"`
      );
    }
  }
  const allowed = new Set([...rules.required, ...rules.optional]);
  for (const key of Object.keys(packet)) {
    if (!allowed.has(key)) {
      throw new TypeError(`packet (status=${packet.status}) has unexpected key "${key}"`);
    }
  }
}
