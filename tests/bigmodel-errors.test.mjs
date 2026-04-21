/**
 * Unit tests for scripts/lib/bigmodel-errors.mjs
 *
 * Guards the BigModel error-code dispatch table so:
 * - Known vendor codes 1301/1302/1304/1305/1308/1309/1310 map to the
 *   correct internal errorCode per official docs at
 *   https://docs.bigmodel.cn/cn/faq/api-code
 * - Recovery semantic (retry: immediate | after-cooldown | never) is
 *   accurate for each code (drives retry.mjs decisions)
 * - User-visible messages reference the actual condition, not a
 *   misleading generic "rate limited" label
 * - Unknown vendor codes fall through to VENDOR_ERROR:<code>
 *   preserving raw vendor message
 * - Malformed / non-JSON response bodies return null from the extractor
 *   instead of throwing
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  BIG_MODEL_ERROR_CODES,
  classifyBigModelError,
  extractBigModelErrorCode
} from "../scripts/lib/bigmodel-errors.mjs";

describe("extractBigModelErrorCode", () => {
  it("extracts string code from error.code", () => {
    const body = JSON.stringify({ error: { code: "1305", message: "traffic spike" } });
    assert.equal(extractBigModelErrorCode(body), "1305");
  });

  it("extracts numeric code and coerces to string", () => {
    const body = JSON.stringify({ error: { code: 1302, message: "rate limit" } });
    assert.equal(extractBigModelErrorCode(body), "1302");
  });

  it("returns null when there is no error field", () => {
    const body = JSON.stringify({ choices: [{ message: { content: "ok" } }] });
    assert.equal(extractBigModelErrorCode(body), null);
  });

  it("returns null on non-JSON body", () => {
    assert.equal(extractBigModelErrorCode("not json"), null);
  });

  it("returns null on empty / null / undefined input", () => {
    assert.equal(extractBigModelErrorCode(""), null);
    assert.equal(extractBigModelErrorCode(null), null);
    assert.equal(extractBigModelErrorCode(undefined), null);
  });

  it("returns null when error.code is missing or whitespace", () => {
    assert.equal(extractBigModelErrorCode(JSON.stringify({ error: { message: "x" } })), null);
    assert.equal(extractBigModelErrorCode(JSON.stringify({ error: { code: "  " } })), null);
  });
});

describe("classifyBigModelError — official BigModel codes", () => {
  it("1301 CONTENT_BLOCKED retry=never", () => {
    const result = classifyBigModelError("1301", JSON.stringify({ error: { code: "1301" } }));
    assert.equal(result.errorCode, "CONTENT_BLOCKED");
    assert.equal(result.retry, "never");
    assert.match(result.message, /content moderation/i);
  });

  it("1302 RATE_LIMITED_ACCOUNT retry=immediate", () => {
    const result = classifyBigModelError("1302", JSON.stringify({ error: { code: "1302" } }));
    assert.equal(result.errorCode, "RATE_LIMITED_ACCOUNT");
    assert.equal(result.retry, "immediate");
    assert.match(result.message, /rate limit/i);
    assert.match(result.message, /backing off/i, "must indicate automatic retry is in progress");
  });

  it("1304 DAILY_QUOTA_EXHAUSTED retry=never (daily call-count, not balance)", () => {
    const result = classifyBigModelError("1304", JSON.stringify({ error: { code: "1304" } }));
    assert.equal(result.errorCode, "DAILY_QUOTA_EXHAUSTED");
    assert.equal(result.retry, "never");
    assert.match(result.message, /daily call-count quota/i);
    assert.doesNotMatch(result.message, /balance insufficient/i, "1304 is call-count, NOT balance — official docs correction");
  });

  it("1305 SERVICE_OVERLOADED retry=immediate with model context", () => {
    const result = classifyBigModelError(
      "1305",
      JSON.stringify({ error: { code: "1305", message: "该模型当前访问量过大" } }),
      { model: "glm-5.1" }
    );
    assert.equal(result.errorCode, "SERVICE_OVERLOADED");
    assert.equal(result.retry, "immediate");
    assert.match(result.message, /traffic spike/i);
    assert.match(result.message, /glm-5\.1/, "must reference the model that failed");
    assert.match(result.message, /NOT an account quota issue/i, "must disambiguate from account-level quota errors");
  });

  it("1308 PLAN_QUOTA_EXHAUSTED retry=after-cooldown", () => {
    const result = classifyBigModelError("1308", JSON.stringify({ error: { code: "1308" } }));
    assert.equal(result.errorCode, "PLAN_QUOTA_EXHAUSTED");
    assert.equal(result.retry, "after-cooldown");
    assert.match(result.message, /plan/i);
    assert.match(result.message, /reset window/i);
  });

  it("1309 PLAN_EXPIRED retry=never", () => {
    const result = classifyBigModelError("1309", JSON.stringify({ error: { code: "1309" } }));
    assert.equal(result.errorCode, "PLAN_EXPIRED");
    assert.equal(result.retry, "never");
    assert.match(result.message, /Coding Plan/i);
    assert.match(result.message, /expired/i);
  });

  it("1310 PERIODIC_QUOTA_EXHAUSTED retry=after-cooldown", () => {
    const result = classifyBigModelError("1310", JSON.stringify({ error: { code: "1310" } }));
    assert.equal(result.errorCode, "PERIODIC_QUOTA_EXHAUSTED");
    assert.equal(result.retry, "after-cooldown");
    assert.match(result.message, /weekly or monthly/i);
  });

  it("preserves vendor message", () => {
    const result = classifyBigModelError(
      "1305",
      JSON.stringify({ error: { code: "1305", message: "该模型当前访问量过大，请您稍后再试" } })
    );
    assert.equal(result.vendorCode, "1305");
    assert.match(result.vendorMessage, /访问量过大/);
  });
});

describe("classifyBigModelError — unknown codes fall through", () => {
  it("unknown code produces VENDOR_ERROR:<code>", () => {
    const result = classifyBigModelError(
      "9999",
      JSON.stringify({ error: { code: "9999", message: "novel failure" } })
    );
    assert.equal(result.errorCode, "VENDOR_ERROR:9999");
    assert.equal(result.retry, "unknown");
    assert.match(result.message, /novel failure/);
    assert.match(result.message, /not in the known-errors table/i);
  });

  it("handles missing vendor message gracefully for unknown codes", () => {
    const result = classifyBigModelError("9998", JSON.stringify({ error: { code: "9998" } }));
    assert.equal(result.errorCode, "VENDOR_ERROR:9998");
    assert.match(result.message, /no vendor message/i);
  });

  it("1303 is NOT in table (was a previous misclassification — official docs skip 1303)", () => {
    const result = classifyBigModelError("1303", JSON.stringify({ error: { code: "1303" } }));
    assert.equal(result.errorCode, "VENDOR_ERROR:1303");
    assert.equal(result.retry, "unknown");
  });
});

describe("BIG_MODEL_ERROR_CODES table integrity", () => {
  it("is frozen (no accidental mutation of the dispatch table)", () => {
    assert.equal(Object.isFrozen(BIG_MODEL_ERROR_CODES), true);
  });

  it("covers the three retry semantics across the 7 known codes", () => {
    const retries = new Set(Object.values(BIG_MODEL_ERROR_CODES).map((e) => e.retry));
    assert.deepEqual(
      [...retries].sort(),
      ["after-cooldown", "immediate", "never"],
      "expected all three retry semantics represented"
    );
  });

  it("every entry produces a non-empty message string", () => {
    for (const [code, entry] of Object.entries(BIG_MODEL_ERROR_CODES)) {
      const msg = entry.message({ model: "glm-5.1" });
      assert.equal(typeof msg, "string", `${code} message must be string`);
      assert.ok(msg.length > 0, `${code} message must be non-empty`);
    }
  });

  it("errorCode values are unique across the table", () => {
    const codes = Object.values(BIG_MODEL_ERROR_CODES).map((e) => e.errorCode);
    assert.equal(new Set(codes).size, codes.length, "errorCode collisions would break caller pattern-match");
  });

  it("only immediate-retry codes exist for transient server conditions (1302, 1305)", () => {
    const immediateCodes = Object.entries(BIG_MODEL_ERROR_CODES)
      .filter(([, v]) => v.retry === "immediate")
      .map(([k]) => k)
      .sort();
    assert.deepEqual(immediateCodes, ["1302", "1305"],
      "only 1302 (account rate limit) and 1305 (shared pool) are transient per official docs");
  });
});
