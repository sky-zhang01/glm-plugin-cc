/**
 * Unit tests for scripts/lib/retry.mjs
 *
 * Covers:
 * - computeBackoffDelay: exponential growth, max-cap enforcement, jitter
 *   range correctness
 * - classifyResultForRetry: terminal-on-success, retry-on-immediate,
 *   stop-on-after-cooldown / never / unknown, retry-on-network-layer
 * - withRetry: bounded attempts, budget enforcement, onAttempt
 *   callback contract, attemptHistory shape, retryExhausted flag
 *
 * Does NOT make any real HTTP calls. Uses a stubbed call function that
 * produces controlled result shapes, and stubbed sleep/random so tests
 * are deterministic.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  classifyResultForRetry,
  computeBackoffDelay,
  withRetry,
  __internals
} from "../scripts/lib/retry.mjs";

const { DEFAULT_POLICY, NETWORK_RETRYABLE } = __internals;

// ─── computeBackoffDelay ──────────────────────────────────────────

describe("computeBackoffDelay", () => {
  const deterministicPolicy = { ...DEFAULT_POLICY, jitterRatio: 0 };

  it("attempt 2 = baseDelayMs (no exponent yet)", () => {
    const d = computeBackoffDelay(2, deterministicPolicy);
    assert.equal(d, DEFAULT_POLICY.baseDelayMs);
  });

  it("attempt 3 = baseDelayMs * multiplier", () => {
    const d = computeBackoffDelay(3, deterministicPolicy);
    assert.equal(d, Math.round(DEFAULT_POLICY.baseDelayMs * DEFAULT_POLICY.multiplier));
  });

  it("attempt 4 caps at maxDelayMs", () => {
    const d = computeBackoffDelay(4, deterministicPolicy);
    assert.ok(d <= DEFAULT_POLICY.maxDelayMs);
    assert.ok(d > 0);
  });

  it("jitter produces a range within ±jitterRatio when random returns 0/1", () => {
    const policy = { ...DEFAULT_POLICY, jitterRatio: 0.2 };
    const lower = computeBackoffDelay(2, policy, () => 0);      // -1 offset
    const upper = computeBackoffDelay(2, policy, () => 0.9999); // +1 offset
    assert.ok(lower < DEFAULT_POLICY.baseDelayMs);
    assert.ok(upper > DEFAULT_POLICY.baseDelayMs);
    // Both within ±20% of base
    assert.ok(Math.abs(lower - DEFAULT_POLICY.baseDelayMs) <= DEFAULT_POLICY.baseDelayMs * 0.25);
    assert.ok(Math.abs(upper - DEFAULT_POLICY.baseDelayMs) <= DEFAULT_POLICY.baseDelayMs * 0.25);
  });

  it("never returns a negative delay even with large negative jitter", () => {
    const policy = { ...DEFAULT_POLICY, jitterRatio: 10 }; // absurd ratio
    const d = computeBackoffDelay(2, policy, () => 0); // -10x offset
    assert.ok(d >= 0);
  });
});

// ─── classifyResultForRetry ───────────────────────────────────────

describe("classifyResultForRetry", () => {
  it("success path (no failureMessage, no parseError) => stop", () => {
    assert.equal(
      classifyResultForRetry({ rawOutput: "ok", failureMessage: null, parseError: null }),
      "stop"
    );
  });

  it("retry=immediate => retry", () => {
    assert.equal(
      classifyResultForRetry({ failureMessage: "1305", retry: "immediate", errorCode: "SERVICE_OVERLOADED" }),
      "retry"
    );
  });

  it("retry=after-cooldown => stop (single-session retry pointless)", () => {
    assert.equal(
      classifyResultForRetry({ failureMessage: "1308", retry: "after-cooldown", errorCode: "PLAN_QUOTA_EXHAUSTED" }),
      "stop"
    );
  });

  it("retry=never => stop", () => {
    assert.equal(
      classifyResultForRetry({ failureMessage: "1304", retry: "never", errorCode: "DAILY_QUOTA_EXHAUSTED" }),
      "stop"
    );
  });

  it("retry=unknown => stop (conservative — new failure modes default to no-retry)", () => {
    assert.equal(
      classifyResultForRetry({ failureMessage: "Unknown 9999", retry: "unknown", errorCode: "VENDOR_ERROR:9999" }),
      "stop"
    );
  });

  it("network-layer TIMEOUT retries even without retry field set", () => {
    assert.equal(
      classifyResultForRetry({ failureMessage: "Timed out", errorCode: "TIMEOUT" }),
      "retry"
    );
  });

  it("network-layer NETWORK_ERROR retries even without retry field set", () => {
    assert.equal(
      classifyResultForRetry({ failureMessage: "ECONNRESET", errorCode: "NETWORK_ERROR" }),
      "retry"
    );
  });

  it("HTTP_ERROR (non-transient, e.g. after-body-validation failure) does NOT auto-retry", () => {
    // HTTP_ERROR is reserved for non-transient HTTP failures (5xx other
    // than 500/502/503/504 which are classified as HTTP_ERROR_TRANSIENT).
    // Keeping conservative to avoid amplifying persistent backend bugs.
    assert.equal(
      classifyResultForRetry({ failureMessage: "HTTP 507", errorCode: "HTTP_ERROR" }),
      "stop"
    );
  });

  it("HTTP_ERROR_TRANSIENT (500/502/503/504) auto-retries as network-layer (Finding #1 fix)", () => {
    assert.equal(
      classifyResultForRetry({ failureMessage: "HTTP 502 Bad Gateway", errorCode: "HTTP_ERROR_TRANSIENT" }),
      "retry"
    );
  });
});

// ─── withRetry ─────────────────────────────────────────────────────

function makeFakeCall(results) {
  let i = 0;
  return async () => {
    const r = results[Math.min(i, results.length - 1)];
    i++;
    return r;
  };
}

describe("withRetry", () => {
  it("returns immediately on first-attempt success with attempts=1", async () => {
    const call = makeFakeCall([{ rawOutput: "ok", failureMessage: null, parseError: null }]);
    const result = await withRetry(call, { sleep: async () => {} });
    assert.equal(result.attempts, 1);
    assert.equal(result.rawOutput, "ok");
    assert.equal(result.retryExhausted, false);
    assert.equal(result.attemptHistory.length, 1);
    assert.equal(result.attemptHistory[0].delayMsBeforeNext, 0);
  });

  it("retries on 1305 and succeeds on attempt 2", async () => {
    const call = makeFakeCall([
      { failureMessage: "1305", retry: "immediate", errorCode: "SERVICE_OVERLOADED" },
      { rawOutput: "success", failureMessage: null, parseError: null }
    ]);
    const result = await withRetry(call, { sleep: async () => {} });
    assert.equal(result.attempts, 2);
    assert.equal(result.rawOutput, "success");
    assert.equal(result.retryExhausted, false);
    assert.equal(result.attemptHistory[0].errorCode, "SERVICE_OVERLOADED");
    assert.ok(result.attemptHistory[0].delayMsBeforeNext > 0);
  });

  it("gives up after maxAttempts with retryExhausted=true", async () => {
    const call = makeFakeCall([
      { failureMessage: "1305", retry: "immediate", errorCode: "SERVICE_OVERLOADED" }
    ]);
    const result = await withRetry(call, {
      sleep: async () => {},
      policy: { maxAttempts: 3, baseDelayMs: 1, multiplier: 1, maxDelayMs: 1, jitterRatio: 0, totalBudgetMs: 999999 }
    });
    assert.equal(result.attempts, 3);
    assert.equal(result.retryExhausted, true);
    assert.equal(result.errorCode, "SERVICE_OVERLOADED");
  });

  it("does NOT retry on retry=never (1304 daily quota)", async () => {
    let callCount = 0;
    const call = async () => {
      callCount++;
      return { failureMessage: "1304", retry: "never", errorCode: "DAILY_QUOTA_EXHAUSTED" };
    };
    const result = await withRetry(call, { sleep: async () => {} });
    assert.equal(callCount, 1, "never-retry code must not cause additional calls");
    assert.equal(result.attempts, 1);
    assert.equal(result.retryExhausted, false);
  });

  it("does NOT retry on retry=after-cooldown (1308 plan)", async () => {
    let callCount = 0;
    const call = async () => {
      callCount++;
      return { failureMessage: "1308", retry: "after-cooldown", errorCode: "PLAN_QUOTA_EXHAUSTED" };
    };
    const result = await withRetry(call, { sleep: async () => {} });
    assert.equal(callCount, 1);
    assert.equal(result.retryExhausted, false);
  });

  it("honors totalBudgetMs cap — stops retrying when budget would be exceeded", async () => {
    // With baseDelayMs=10000 and budget=5000, even the first retry's
    // delay (~10000ms) exceeds the 5000ms budget → retry aborted.
    let callCount = 0;
    const call = async () => {
      callCount++;
      return { failureMessage: "1305", retry: "immediate", errorCode: "SERVICE_OVERLOADED" };
    };
    const result = await withRetry(call, {
      sleep: async () => {},
      policy: {
        maxAttempts: 5,
        baseDelayMs: 10000,
        multiplier: 2,
        maxDelayMs: 30000,
        jitterRatio: 0,
        totalBudgetMs: 5000
      }
    });
    assert.equal(callCount, 1, "should abort before second attempt since first delay exceeds budget");
  });

  it("budget covers WALL-CLOCK including call duration (Finding #2 fix)", async () => {
    // Stub `now()` to simulate each call taking 20s of wall-clock.
    // Budget is 30s. After attempt 1 (20s elapsed), adding the 2s backoff
    // (22s) is still within 30s → retry. After attempt 2 (42s elapsed),
    // any further retry would blow the budget → stop. So callCount=2.
    let nowMs = 1000000;
    let callCount = 0;
    const now = () => nowMs;
    const call = async () => {
      callCount++;
      nowMs += 20000; // each call advances wall-clock by 20s
      return { failureMessage: "1305", retry: "immediate", errorCode: "SERVICE_OVERLOADED" };
    };
    const result = await withRetry(call, {
      sleep: async (ms) => { nowMs += ms; }, // sleep also advances clock
      now,
      policy: {
        maxAttempts: 5,
        baseDelayMs: 2000,
        multiplier: 2.5,
        maxDelayMs: 15000,
        jitterRatio: 0,
        totalBudgetMs: 30000
      }
    });
    assert.equal(
      callCount,
      2,
      "must stop after 2 calls since 20s + 2s backoff + 20s = 42s would exceed 30s budget"
    );
    // Each history entry should include the callDurationMs we stubbed
    assert.equal(result.attemptHistory[0].callDurationMs, 20000);
    assert.equal(result.attemptHistory[1].callDurationMs, 20000);
  });

  it("HTTP_ERROR_TRANSIENT triggers auto-retry (Finding #1 fix — 502/503/504)", async () => {
    const call = makeFakeCall([
      { failureMessage: "HTTP 502 Bad Gateway", errorCode: "HTTP_ERROR_TRANSIENT", retry: "immediate" },
      { rawOutput: "recovered", failureMessage: null, parseError: null }
    ]);
    const result = await withRetry(call, { sleep: async () => {} });
    assert.equal(result.attempts, 2);
    assert.equal(result.rawOutput, "recovered");
    assert.equal(result.attemptHistory[0].errorCode, "HTTP_ERROR_TRANSIENT");
  });

  it("onAttempt event payload includes maxAttempts and elapsed/budget fields", async () => {
    const call = makeFakeCall([
      { failureMessage: "1305", retry: "immediate", errorCode: "SERVICE_OVERLOADED" },
      { rawOutput: "ok", failureMessage: null, parseError: null }
    ]);
    const events = [];
    await withRetry(call, {
      sleep: async () => {},
      onAttempt: (e) => events.push({
        attempt: e.attempt,
        maxAttempts: e.maxAttempts,
        elapsedMs: typeof e.elapsedMs,
        budgetMs: typeof e.budgetMs
      })
    });
    assert.equal(events[0].maxAttempts, 3, "default policy maxAttempts surfaced");
    assert.equal(events[0].elapsedMs, "number");
    assert.equal(events[0].budgetMs, "number");
  });

  it("onAttempt callback fires with willRetry + delayMs", async () => {
    const call = makeFakeCall([
      { failureMessage: "1302", retry: "immediate", errorCode: "RATE_LIMITED_ACCOUNT" },
      { rawOutput: "ok", failureMessage: null, parseError: null }
    ]);
    const events = [];
    await withRetry(call, {
      sleep: async () => {},
      onAttempt: (event) => events.push({ ...event, result: undefined })
    });
    assert.equal(events.length, 2);
    assert.equal(events[0].attempt, 1);
    assert.equal(events[0].willRetry, true);
    assert.ok(events[0].delayMs > 0);
    assert.equal(events[1].attempt, 2);
    assert.equal(events[1].willRetry, false);
  });

  it("retries network-layer TIMEOUT even without retry field", async () => {
    const call = makeFakeCall([
      { failureMessage: "Timed out", errorCode: "TIMEOUT" },
      { rawOutput: "recovered", failureMessage: null, parseError: null }
    ]);
    const result = await withRetry(call, { sleep: async () => {} });
    assert.equal(result.attempts, 2);
    assert.equal(result.rawOutput, "recovered");
  });

  it("attemptHistory captures retry semantic per attempt", async () => {
    const call = makeFakeCall([
      { failureMessage: "1305", retry: "immediate", errorCode: "SERVICE_OVERLOADED" },
      { failureMessage: "1305", retry: "immediate", errorCode: "SERVICE_OVERLOADED" },
      { rawOutput: "eventually", failureMessage: null, parseError: null }
    ]);
    const result = await withRetry(call, { sleep: async () => {} });
    assert.equal(result.attempts, 3);
    assert.equal(result.attemptHistory[0].retry, "immediate");
    assert.equal(result.attemptHistory[1].retry, "immediate");
    assert.equal(result.attemptHistory[2].retry ?? null, null);
  });
});

// ─── NETWORK_RETRYABLE set ─────────────────────────────────────────

describe("NETWORK_RETRYABLE set", () => {
  it("includes TIMEOUT and NETWORK_ERROR", () => {
    assert.ok(NETWORK_RETRYABLE.has("TIMEOUT"));
    assert.ok(NETWORK_RETRYABLE.has("NETWORK_ERROR"));
  });

  it("does not include terminal error codes", () => {
    assert.equal(NETWORK_RETRYABLE.has("AUTH_FAILED"), false);
    assert.equal(NETWORK_RETRYABLE.has("BAD_REQUEST"), false);
    assert.equal(NETWORK_RETRYABLE.has("HTTP_ERROR"), false);
  });
});
