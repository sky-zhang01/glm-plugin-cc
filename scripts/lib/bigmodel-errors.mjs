/**
 * BigModel error-code dispatch table.
 *
 * BigModel's OpenAI-compatible gateway returns application-level error
 * codes inside the response body's `error.code` field (as a string,
 * confusingly). These are NOT the HTTP status codes — BigModel maps
 * several semantically-distinct failure modes onto HTTP 429, so a
 * generic "rate limited" message is wrong for 1304 (daily quota) or
 * 1308 (plan quota) which don't recover on retry.
 *
 * Table sourced from the official doc:
 *   https://docs.bigmodel.cn/cn/faq/api-code
 * Cross-checked with the empirical 1305 observation from
 * glm-plugin-cc v0.4.5 dogfood session ("该模型当前访问量过大") and the
 * v0.4.7 expanded-sweep session which caught 500 + 1234 + 1312 + 1313
 * appearing in the wild (not in the v0.4.6 snapshot of the table).
 *
 * Exported so companion error paths can map BigModel codes to our
 * `errorCode` surface and drive automatic retry (`retry: "immediate"`)
 * vs hand-off-to-user (`retry: "never"`) decisions in retry.mjs.
 */

/**
 * Canonical table of known BigModel error codes.
 *
 * Each entry carries:
 * - `errorCode`: internal surface value (distinct from raw BigModel code
 *   so consumers can pattern-match without memorizing vendor codes)
 * - `retry`: `"immediate" | "after-cooldown" | "never"` — drives
 *   retry.mjs:
 *     * `immediate` — transient server-side condition; retry with
 *       exponential backoff + jitter
 *     * `after-cooldown` — wait for a known reset window (daily, weekly,
 *       monthly). Retrying within the same window re-fails
 *     * `never` — user action required (top-up, plan renewal, prompt
 *       change, key rotation). No retry will succeed
 * - `message(ctx)`: function producing the user-visible description.
 *   Receives `{ endpoint, model }` so messages can reference the actual
 *   endpoint / model that failed
 *
 * Unknown vendor codes fall through to `VENDOR_ERROR:<code>` with the
 * raw code + message preserved (so we don't silently eat a new failure
 * mode the official docs haven't listed yet).
 */
export const BIG_MODEL_ERROR_CODES = Object.freeze({
  "500": {
    errorCode: "UPSTREAM_INTERNAL_ERROR",
    retry: "immediate",
    message: () =>
      "BigModel 500 — upstream internal error (HTTP 500 or business code 500). " +
      "Per official docs: 稍后重试或联系客服. Treat as transient and retry with backoff; " +
      "if persistent across multiple attempts, contact BigModel support."
  },
  "1234": {
    errorCode: "UPSTREAM_NETWORK_ERROR",
    retry: "immediate",
    message: () =>
      "BigModel 1234 — upstream network error (docs: 网络错误，错误id:${error_id}，请联系客服). " +
      "A single 1234 is typically a transient BigModel-side network hiccup; our retry/backoff " +
      "will handle it. If you see repeated 1234s with the same error_id, contact support."
  },
  "1301": {
    errorCode: "CONTENT_BLOCKED",
    retry: "never",
    message: () =>
      "BigModel 1301 — content moderation blocked the prompt or generated output. " +
      "Reword the prompt to avoid sensitive content. Retrying with the same input will re-fail."
  },
  "1302": {
    errorCode: "RATE_LIMITED_ACCOUNT",
    retry: "immediate",
    message: () =>
      "BigModel 1302 — account-level rate limit hit (concurrent / frequency cap). " +
      "Backing off and retrying with a lower request rate."
  },
  "1304": {
    errorCode: "DAILY_QUOTA_EXHAUSTED",
    retry: "never",
    message: () =>
      "BigModel 1304 — daily call-count quota exhausted on this API key. " +
      "Contact sales (联系客服购买) or wait for the next UTC-aligned reset window. " +
      "Retrying now will not help."
  },
  "1305": {
    errorCode: "SERVICE_OVERLOADED",
    retry: "immediate",
    message: ({ model } = {}) =>
      "BigModel 1305 — server-side traffic spike on the shared model pool" +
      (model ? ` (${model})` : "") +
      ". NOT an account quota issue (your 5h/weekly limits are unaffected). " +
      "Backing off and retrying; if persistent for >5 min, try --model glm-4.6 or off-peak hours."
  },
  "1308": {
    errorCode: "PLAN_QUOTA_EXHAUSTED",
    retry: "after-cooldown",
    message: () =>
      "BigModel 1308 — per-plan usage limit reached (e.g. 5-hour or token-based cap). " +
      "Wait for the plan's stated reset window. Immediate retry will re-fail."
  },
  "1309": {
    errorCode: "PLAN_EXPIRED",
    retry: "never",
    message: () =>
      "BigModel 1309 — GLM Coding Plan subscription has expired. " +
      "Renew at https://open.bigmodel.cn/usercenter before further requests will succeed."
  },
  "1310": {
    errorCode: "PERIODIC_QUOTA_EXHAUSTED",
    retry: "after-cooldown",
    message: () =>
      "BigModel 1310 — weekly or monthly usage cap reached. " +
      "Wait for the next period's reset window. Immediate retry will re-fail."
  },
  "1311": {
    errorCode: "MODEL_NOT_IN_PLAN",
    retry: "never",
    message: ({ model } = {}) =>
      "BigModel 1311 — the current subscription plan does not include " +
      (model ? `model "${model}"` : "this model") + " access. " +
      "Pick a model your plan covers (/glm:setup) or upgrade the plan. Retry won't help."
  },
  "1312": {
    errorCode: "MODEL_OVERLOADED",
    retry: "immediate",
    message: ({ model } = {}) =>
      "BigModel 1312 — model-specific traffic spike" +
      (model ? ` on "${model}"` : "") + " (docs suggest trying an alternative model). " +
      "Backing off and retrying; if persistent, try --model glm-4.6 or off-peak hours."
  },
  "1313": {
    errorCode: "FAIR_USE_LIMIT",
    retry: "never",
    message: () =>
      "BigModel 1313 — account tripped the fair-use policy rate limit (订阅服务协议). " +
      "Request frequency is throttled until you request removal via the personal center. " +
      "Immediate retry will re-fail; see https://open.bigmodel.cn/usercenter/proj-mgmt."
  }
});

/**
 * Extract a BigModel application-level error code from a raw response
 * body (whether the HTTP status was 2xx, 4xx, or 5xx — the gateway
 * sometimes wraps the same 1305 body in different HTTP codes depending
 * on which load-balancer tier rejected).
 *
 * Returns `null` if the body is non-JSON, doesn't contain `error.code`,
 * or the code isn't a string / number.
 */
export function extractBigModelErrorCode(rawResponseText) {
  if (typeof rawResponseText !== "string" || rawResponseText.length === 0) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(rawResponseText);
  } catch {
    return null;
  }
  const code = payload?.error?.code;
  if (typeof code === "string" && code.trim() !== "") {
    return code.trim();
  }
  if (typeof code === "number" && Number.isFinite(code)) {
    return String(code);
  }
  return null;
}

/**
 * Given a BigModel vendor code + optional context, return a
 * failure descriptor `{ errorCode, message, retry, vendorCode,
 * vendorMessage }` that the companion's `failureShape` helper can
 * spread into the output.
 *
 * Unknown codes produce `VENDOR_ERROR:<code>` so the caller can still
 * distinguish "our classifier didn't know this code" from a generic
 * HTTP error. The raw vendor message is preserved in `vendorMessage`
 * when available.
 */
export function classifyBigModelError(rawCode, rawResponseText, ctx = {}) {
  const known = BIG_MODEL_ERROR_CODES[rawCode];
  let rawMessage = null;
  try {
    const parsed = JSON.parse(rawResponseText ?? "");
    if (typeof parsed?.error?.message === "string") {
      rawMessage = parsed.error.message;
    }
  } catch {
    // ignore
  }
  if (known) {
    return {
      errorCode: known.errorCode,
      retry: known.retry,
      message: known.message(ctx),
      vendorCode: rawCode,
      vendorMessage: rawMessage
    };
  }
  return {
    errorCode: `VENDOR_ERROR:${rawCode}`,
    retry: "unknown",
    message:
      `BigModel vendor error ${rawCode}` +
      (rawMessage ? ` — ${rawMessage}` : " — no vendor message.") +
      " This code is not in the known-errors table (see https://docs.bigmodel.cn/cn/faq/api-code).",
    vendorCode: rawCode,
    vendorMessage: rawMessage
  };
}
