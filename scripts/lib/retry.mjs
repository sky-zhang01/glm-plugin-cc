/**
 * Bounded exponential-backoff retry wrapper for BigModel HTTP calls.
 *
 * Drives the `retry` semantic produced by bigmodel-errors.mjs:
 *
 *   retry = "immediate"       → transient server-side condition
 *                               (1302 account rate limit / 1305 shared
 *                               pool overload). Retry with exponential
 *                               backoff + jitter, bounded attempts,
 *                               bounded total elapsed.
 *   retry = "after-cooldown"  → known reset window (1308 plan, 1310
 *                               weekly/monthly). Retrying inside the
 *                               window re-fails. Return to caller
 *                               without retrying; caller surfaces hint.
 *   retry = "never"           → user action required (1301 content
 *                               block, 1304 daily, 1309 plan expired,
 *                               auth, bad request). No retry possible.
 *   retry = "unknown"         → unknown vendor code or generic HTTP
 *                               error. Do NOT retry (conservative
 *                               default; a new failure mode might be
 *                               permanent and retry just wastes tokens).
 *   retry = null / undefined  → legacy / success path. Pass through.
 *
 * Also treats network-layer errors (TIMEOUT / NETWORK_ERROR from
 * glm-client.mjs) as `immediate` retryable since those are usually
 * transient.
 *
 * Not: this is a wrapper over a single-shot call. It does NOT deal with
 * streaming responses (companion doesn't stream) or cross-host failover.
 */

const DEFAULT_POLICY = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 2000,
  multiplier: 2.5,
  maxDelayMs: 15000,
  jitterRatio: 0.2,
  // Wall-clock cap covering: (sum of call durations) + (sum of backoff
  // sleeps). If an individual GLM call already blows the budget, we do
  // not schedule another retry even if maxAttempts has remaining slots.
  // 90s is enough to accommodate 3 × ~20s thinking-on calls plus the
  // scheduled 2s + 5s + 12.5s backoff, while still bounding the user's
  // hang if the API is actually down.
  totalBudgetMs: 90000
});

/**
 * Network-layer error codes that should also trigger retry. Produced by
 * glm-client.mjs when fetch itself throws or the AbortController fires.
 * HTTP_ERROR_TRANSIENT covers 500/502/503/504 surfaced by glm-client
 * when BigModel's gateway is flaky (independent of vendor error.code).
 */
const NETWORK_RETRYABLE = new Set([
  "TIMEOUT",
  "NETWORK_ERROR",
  "HTTP_ERROR_TRANSIENT"
]);

/**
 * Sleep for `ms` milliseconds. Extracted so tests can stub it.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Compute the delay before attempt N (1-indexed).
 *
 * Attempt 1 = the original call (no wait). So this is called with
 * N >= 2 — the "I'm about to retry" moment. Returns the pre-retry
 * wait in ms, clamped to `maxDelayMs`, and jitter is applied as
 * `delay * (1 +/- jitterRatio)`.
 */
export function computeBackoffDelay(attemptNumber, policy = DEFAULT_POLICY, random = Math.random) {
  const { baseDelayMs, multiplier, maxDelayMs, jitterRatio } = policy;
  const exponent = Math.max(0, attemptNumber - 2);
  const base = Math.min(baseDelayMs * Math.pow(multiplier, exponent), maxDelayMs);
  const jitterSpan = base * jitterRatio;
  const offset = (random() * 2 - 1) * jitterSpan; // uniform [-jitterSpan, +jitterSpan]
  return Math.max(0, Math.round(base + offset));
}

/**
 * Decide whether a result warrants retrying.
 *
 * Pure function — no side effects. Returns one of:
 *   "retry"   — proceed with exponential backoff and another attempt
 *   "stop"    — terminal outcome; return result to caller unchanged
 */
export function classifyResultForRetry(result) {
  // Success path: no failureMessage AND some usable output (rawOutput
  // or parsed). If failureMessage is falsy we treat as success even
  // without output — let the caller validate the payload shape.
  if (!result?.failureMessage && !result?.parseError) {
    return "stop";
  }
  const retry = result?.retry;
  if (retry === "immediate") {
    return "retry";
  }
  // Treat transient network failures as immediate-retry even when the
  // classifier didn't assign a retry semantic (legacy paths).
  if (NETWORK_RETRYABLE.has(result?.errorCode)) {
    return "retry";
  }
  return "stop";
}

/**
 * Wrap a single-shot call producer with bounded exponential-backoff
 * retry. `callFn` is an async function that takes `{ attempt }` and
 * returns a result shape identical to what glm-client.mjs runChatRequest
 * produces (i.e. `{ rawOutput, failureMessage, errorCode, retry, ... }`).
 *
 * Policy options (all optional, defaults in DEFAULT_POLICY):
 *   - maxAttempts (default 3)
 *   - baseDelayMs (default 2000)
 *   - multiplier (default 2.5)
 *   - maxDelayMs (default 15000)
 *   - jitterRatio (default 0.2)
 *   - totalBudgetMs (default 30000) — hard cap on cumulative sleep time
 *
 * Observability:
 *   - `onAttempt({ attempt, result, willRetry, delayMs })` is called
 *     after each attempt completes (success or failure). Surfaces
 *     progress so the caller can emit onProgress events to the user.
 *   - Returns `{ ...finalResult, attempts, attemptHistory }` where
 *     attemptHistory is an array of `{ attempt, errorCode, retry, delayMsBeforeNext }`.
 */
export async function withRetry(callFn, options = {}) {
  const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
  const onAttempt = typeof options.onAttempt === "function" ? options.onAttempt : null;
  const sleeper = typeof options.sleep === "function" ? options.sleep : sleep;
  const rng = typeof options.random === "function" ? options.random : Math.random;
  const now = typeof options.now === "function" ? options.now : () => Date.now();

  const history = [];
  const cycleStartMs = now();
  let result;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const callStartMs = now();
    result = await callFn({ attempt });
    const callDurationMs = now() - callStartMs;

    const decision = classifyResultForRetry(result);
    const atLastAttempt = attempt === policy.maxAttempts;
    const wouldRetry = decision === "retry" && !atLastAttempt;
    const delayMs = wouldRetry ? computeBackoffDelay(attempt + 1, policy, rng) : 0;
    // Budget check covers CUMULATIVE wall-clock including call duration
    // AND the proposed next backoff sleep. This prevents the scenario
    // where each call takes ~20s and 3 attempts blow past a 30s budget
    // silently (GLM adversarial-review v0.4.6 finding 2).
    const elapsedSoFarMs = now() - cycleStartMs;
    const withinBudget = elapsedSoFarMs + delayMs <= policy.totalBudgetMs;
    const willRetry = wouldRetry && withinBudget;

    history.push({
      attempt,
      errorCode: result?.errorCode ?? null,
      retry: result?.retry ?? null,
      failureMessage: result?.failureMessage ?? null,
      callDurationMs,
      delayMsBeforeNext: willRetry ? delayMs : 0
    });

    if (onAttempt) {
      onAttempt({
        attempt,
        maxAttempts: policy.maxAttempts,
        result,
        willRetry,
        delayMs: willRetry ? delayMs : 0,
        elapsedMs: elapsedSoFarMs,
        budgetMs: policy.totalBudgetMs
      });
    }

    if (!willRetry) {
      break;
    }

    await sleeper(delayMs);
  }

  return {
    ...result,
    attempts: history.length,
    attemptHistory: history,
    retryExhausted:
      history.length >= policy.maxAttempts &&
      classifyResultForRetry(result) === "retry"
  };
}

/**
 * Exported for tests. Not part of the stable public surface.
 */
export const __internals = Object.freeze({
  DEFAULT_POLICY,
  NETWORK_RETRYABLE,
  sleep
});
