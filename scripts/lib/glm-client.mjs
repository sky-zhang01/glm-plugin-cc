/**
 * GLM OpenAI-compatible client.
 *
 * GLM is stateless HTTP — no broker, no persistent sessions, no thread
 * resume, no server-side turn state. Every request is an independent
 * POST.
 *
 * Endpoint: ${base_url}/chat/completions
 *   base_url defaults to https://open.bigmodel.cn/api/paas/v4
 *   coding-plan preset:   https://open.bigmodel.cn/api/coding/paas/v4
 *   pay-as-you-go preset: https://open.bigmodel.cn/api/paas/v4
 *   custom preset:        user-supplied https://... (e.g. 海外 api.z.ai/api/paas/v4)
 *
 * Auth: `Authorization: Bearer <api_key>` header (OpenAI-compatible).
 *   API key is persisted to ~/.config/glm-plugin-cc/config.json (0600)
 *   by `/glm:setup`, mirroring codex's `~/.codex/auth.json` pattern.
 *
 * Thinking: OFF by default (matches codex `--effort unset`). Opt-in via
 * `thinking: true` (or CLI `--thinking on`). GLM uses the `thinking`
 * request field `{"type": "enabled" | "disabled"}`.
 */

import { classifyBigModelError, extractBigModelErrorCode } from "./bigmodel-errors.mjs";
import { formatUserFacingError, readJsonFile } from "./fs.mjs";
import { assertNonVisionModel, DEFAULT_MODEL } from "./model-catalog.mjs";
import { resolveApiKeyFromConfig, resolveEffectiveConfig } from "./preset-config.mjs";
import { withRetry } from "./retry.mjs";

const FALLBACK_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 min aligned with codex review gate

export const DEFAULT_CONTINUE_PROMPT =
  "Continue from the previous turn. Identify the next highest-value step and complete it.";
export const TASK_TITLE_PREFIX = "GLM Companion Task";

const SERVICE_NAME = "claude_code_glm_plugin";

function getEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * API key is stored on disk in `~/.config/glm-plugin-cc/config.json`
 * (mode 0600), written by `/glm:setup` — same pattern as the codex CLI
 * `~/.codex/auth.json`. There is intentionally NO environment-variable
 * fallback: the setup command is the single entry point for configuring
 * credentials, matching `codex login --api-key <key>`.
 */
function resolveApiKey() {
  return resolveApiKeyFromConfig();
}

/**
 * Structurally strip `/chat/completions` (and any trailing slashes) from
 * the pathname of a base URL, preserving scheme / host / port. Preserves
 * query and fragment if present so callers who intentionally pass an
 * API-version query string still get a sensible endpoint.
 *
 * Falls back to regex-based trimming if the input doesn't parse as a
 * URL (shouldn't happen after https:// validation, but cheap insurance).
 */
function normalizeBaseUrl(url) {
  const raw = String(url || "");
  try {
    const parsed = new URL(raw);
    parsed.pathname = parsed.pathname
      .replace(/\/chat\/completions\/?$/i, "")
      .replace(/\/+$/, "");
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/+$/, "").replace(/\/chat\/completions$/i, "");
  }
}

/**
 * Strip userinfo + query + fragment from a URL before echoing it back in
 * error / status output. Avoids leaking credentials that a user may have
 * accidentally pasted into `--base-url`.
 */
function sanitizeUrlForDisplay(url) {
  const raw = String(url || "");
  try {
    const parsed = new URL(raw);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    // Length-cap as a last-resort safety net.
    return raw.length > 100 ? `${raw.slice(0, 100)}…` : raw;
  }
}

function resolveBaseUrl() {
  const config = resolveEffectiveConfig();
  if (config.base_url) {
    return normalizeBaseUrl(config.base_url);
  }
  return FALLBACK_BASE_URL;
}

function resolveEndpoint() {
  return `${resolveBaseUrl()}/chat/completions`;
}

function resolveModel(options = {}) {
  let model;
  if (options.model) {
    model = options.model;
  } else {
    const config = resolveEffectiveConfig();
    model = config.default_model || DEFAULT_MODEL;
  }
  // Guard against accidentally routing vision models through text-only commands.
  assertNonVisionModel(model);
  return model;
}

export function resolveConfigSummary() {
  return resolveEffectiveConfig();
}

function resolveTimeoutMs(options = {}) {
  // Timeout is operational, not credential — env var override kept for
  // power users who need to extend the 15-minute ceiling on slow networks.
  const raw = options.timeoutMs || getEnv("GLM_TIMEOUT_MS");
  const parsed = raw ? Number.parseInt(String(raw), 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/**
 * Check basic availability: fetch is in Node >=18.18, and an API key is set.
 * This does NOT make a network call.
 */
export function getGlmAvailability(cwd) {
  if (typeof fetch !== "function") {
    return {
      available: false,
      detail: "Node.js >=18.18 required (global fetch missing)."
    };
  }
  let key;
  try {
    key = resolveApiKey();
  } catch (error) {
    return { available: false, detail: formatUserFacingError(error) };
  }
  if (!key) {
    return {
      available: false,
      detail: "No API key configured. Run /glm:setup and paste your key when prompted."
    };
  }
  try {
    const endpoint = resolveEndpoint();
    const model = resolveModel();
    return {
      available: true,
      detail: `endpoint=${sanitizeUrlForDisplay(endpoint)}, model=${model}`
    };
  } catch (error) {
    return { available: false, detail: formatUserFacingError(error) };
  }
}

/**
 * Probe the endpoint with a tiny request. Returns { ok, detail }.
 * Intentionally side-effectful (costs one token worth of tokens).
 * Used only from /glm:setup.
 */
export async function getGlmAuthStatus(cwd, options = {}) {
  const availability = getGlmAvailability(cwd);
  if (!availability.available) {
    return { ok: false, detail: availability.detail };
  }
  let apiKey, endpoint, probeModel;
  try {
    apiKey = resolveApiKey();
    endpoint = resolveEndpoint();
    probeModel = resolveModel(options);
  } catch (error) {
    return { ok: false, detail: formatUserFacingError(error) };
  }
  const timeoutMs = resolveTimeoutMs({ timeoutMs: 15000 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: probeModel,
        max_tokens: 16,
        messages: [{ role: "user", content: "ping" }]
      }),
      signal: controller.signal
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, detail: `Auth failed (HTTP ${response.status}). Re-run /glm:setup --api-key <key> to refresh the stored key.` };
    }
    if (response.status === 429) {
      return { ok: false, detail: "Rate limited (HTTP 429). API key is valid but quota exhausted." };
    }
    if (!response.ok) {
      const body = await safeReadText(response);
      return { ok: false, detail: `HTTP ${response.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true, detail: `HTTP ${response.status} from ${sanitizeUrlForDisplay(endpoint)}` };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ok: false, detail: `Request timed out after ${timeoutMs} ms.` };
    }
    return { ok: false, detail: `Network error: ${error?.message ?? String(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GLM is stateless HTTP. Session runtime is always trivially "ready".
 * Kept for companion interface parity.
 */
export function getSessionRuntimeStatus(env = process.env, cwd = process.cwd()) {
  const availability = getGlmAvailability(cwd);
  return {
    label: availability.available ? "ready" : "unavailable",
    detail: availability.detail,
    ready: availability.available
  };
}

/**
 * Build a short human-readable title for a task job, derived from the
 * first line of the prompt. Stored as `job.title` so `/glm:status`
 * shows something more useful than the job id.
 */
export function buildTaskTitle(prompt) {
  const firstLine = String(prompt ?? "").split(/\r?\n/)[0].trim();
  const suffix = firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine || "(no prompt)";
  return `${TASK_TITLE_PREFIX} · ${suffix}`;
}

/**
 * Send a review request. `prompt` is the full review prompt (the harness or
 * the command renderer composes it — we do not synthesize prompts here).
 *
 * Wrapped in `withRetry` so transient BigModel conditions (1302 account
 * rate limit, 1305 shared-pool overload, plus network TIMEOUT /
 * NETWORK_ERROR) are retried automatically with exponential backoff +
 * jitter. Terminal conditions (1301/1304/1308/1309/1310, auth, bad
 * request) return on first call without retrying.
 *
 * Returns: { rawOutput, parsed, parseError, failureMessage, errorCode,
 *            reasoningSummary, retry, attempts, attemptHistory,
 *            retryExhausted }
 */
export async function runGlmReview(cwd, options = {}) {
  return runWithRetryIfEnabled(cwd, { ...options, expectJson: true });
}

/**
 * Send a free-form task request. Returns the raw output without JSON parsing.
 * Same retry policy as runGlmReview.
 */
export async function runGlmTask(cwd, options = {}) {
  return runWithRetryIfEnabled(cwd, { ...options, expectJson: false });
}

/**
 * Shared entry point: wrap runChatRequest in withRetry unless the caller
 * opts out via `options.retry: false`. Pass `options.retryPolicy` /
 * `options.onAttempt` through.
 *
 * For review calls (`expectJson: true`), runChatRequest returns a
 * `retry: "correction"` failure when the parsed output fails shape
 * validation (SCHEMA_ECHO / INVALID_SHAPE). We intercept those between
 * withRetry iterations and do at most ONE targeted correction-retry
 * with a re-prompt explaining the previous mistake. Correction retries
 * do NOT count against the withRetry attempt budget — different concern,
 * different mechanism.
 */
async function runWithRetryIfEnabled(cwd, options = {}) {
  if (options.retry === false) {
    return runChatRequestWithCorrectionRetry(cwd, options);
  }
  return withRetry(
    ({ attempt }) => runChatRequestWithCorrectionRetry(cwd, { ...options, _attempt: attempt }),
    {
      policy: options.retryPolicy,
      onAttempt: ({ attempt, maxAttempts, result, willRetry, delayMs, elapsedMs, budgetMs }) => {
        if (typeof options.onProgress !== "function") return;
        if (willRetry) {
          options.onProgress({
            phase: "retrying",
            attempt,
            maxAttempts,
            errorCode: result?.errorCode || null,
            delayMs,
            elapsedMs,
            budgetMs,
            message:
              `attempt ${attempt}/${maxAttempts} hit ${result?.errorCode || "transient failure"}; ` +
              `backing off ${delayMs} ms before retry (elapsed ${elapsedMs}/${budgetMs} ms)`
          });
        } else if (result?.failureMessage && attempt > 1) {
          options.onProgress({
            phase: "retry-exhausted",
            attempt,
            maxAttempts,
            errorCode: result?.errorCode || null,
            elapsedMs,
            message: `gave up after ${attempt}/${maxAttempts} attempts: ${result.errorCode || "unknown failure"}`
          });
        }
      }
    }
  );
}

/**
 * Wraps runChatRequest with a single-shot correction retry for review-
 * payload shape failures (SCHEMA_ECHO / INVALID_SHAPE). Used by
 * runGlmReview. Non-review calls (expectJson=false) pass through
 * unchanged since there is no schema to validate against.
 *
 * The correction retry prepends a targeted instruction to the user
 * prompt explaining what went wrong on the previous attempt. If the
 * corrected call also fails shape validation, we stop — looping further
 * is unlikely to help and wastes tokens.
 */
async function runChatRequestWithCorrectionRetry(cwd, options = {}) {
  const first = await runChatRequest(cwd, options);
  if (first.retry !== "correction") {
    return first;
  }
  if (typeof options.onProgress === "function") {
    options.onProgress({
      phase: "correction-retry",
      errorCode: first.errorCode,
      message: `attempting one correction retry (${first.errorCode})`
    });
  }
  const hint = buildCorrectionHint(first.errorCode);
  const second = await runChatRequest(cwd, {
    ...options,
    _correctionHint: hint,
    _attempt: (options._attempt || 1) + 0.5  // non-integer = correction sub-attempt
  });
  // If second attempt ALSO fails shape validation, stop. retry="correction"
  // on the final result signals the consumer that correction didn't help.
  // Augment with a `correctionAttempted: true` marker so reporting surfaces
  // the fact that we tried.
  return {
    ...second,
    correctionAttempted: true,
    correctionHint: hint,
    correctionFirstErrorCode: first.errorCode
  };
}

function buildCorrectionHint(previousErrorCode) {
  if (previousErrorCode === "SCHEMA_ECHO") {
    return (
      "[CORRECTION] Your previous response returned the JSON schema definition " +
      "itself (with `$schema`, `type`, `properties` keys) instead of the actual " +
      "review output. Do NOT return the schema. Return a concrete JSON object " +
      "with real values for `verdict`, `summary`, `findings`. Each finding must " +
      "have real `severity`, `title`, `body`, `file`, `line_start`, `line_end`. " +
      "If there are no findings to report, return an empty `findings` array with " +
      "`verdict: \"approve\"`.\n\n"
    );
  }
  if (previousErrorCode === "INVALID_SHAPE") {
    return (
      "[CORRECTION] Your previous response was valid JSON but missing one or more " +
      "required fields (`verdict`, `summary`, or `findings`). Include all three " +
      "top-level fields in your response. If nothing notable was found, still " +
      "include `verdict: \"approve\"` and `findings: []`.\n\n"
    );
  }
  return "";
}

/**
 * Strip a single leading ```...``` markdown fence if present. Applied
 * unconditionally before JSON.parse since GLM-5.1 has been observed
 * wrapping structured output in ```json ... ``` despite explicit
 * instructions not to.
 *
 * Only strips the OUTERMOST fence — does not recursively unwrap.
 * Preserves inner content verbatim.
 */
export function stripMarkdownFences(text) {
  if (typeof text !== "string") return text;
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (match) {
    return match[1].trim();
  }
  return trimmed;
}

/**
 * Classify a parsed JSON object as a valid review payload vs one of two
 * review-semantic failure modes:
 *
 *   - `schema_echo`: payload root has `$schema` + `type: "object"` +
 *     `properties` (looks like a JSON Schema definition) AND no
 *     `verdict` / `findings` fields. Observed in v0.4.5 dogfood session
 *     and NousResearch hermes-agent #13042.
 *   - `invalid_shape`: payload has no `$schema` but is missing one or
 *     more of `verdict` / `summary` / `findings` that the review schema
 *     requires.
 *   - `valid`: payload has verdict + summary + findings (array).
 *
 * Exported for tests. Returns `{ kind, message, errorCode }` where
 * `kind` is one of `"valid" | "schema_echo" | "invalid_shape"`.
 */
export function classifyReviewPayload(parsed) {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      kind: "invalid_shape",
      errorCode: "INVALID_SHAPE",
      message: "Parsed response is not a JSON object; review payload must be { verdict, summary, findings, ... }."
    };
  }
  const hasSchemaKeys =
    typeof parsed.$schema === "string" ||
    (parsed.type === "object" && typeof parsed.properties === "object" && parsed.properties !== null);
  const hasReviewFields =
    typeof parsed.verdict === "string" ||
    Array.isArray(parsed.findings) ||
    typeof parsed.summary === "string";
  if (hasSchemaKeys && !hasReviewFields) {
    return {
      kind: "schema_echo",
      errorCode: "SCHEMA_ECHO",
      message:
        "GLM returned the JSON schema definition instead of review findings. " +
        "This is a known GLM-5.1 failure mode under large context + structured output."
    };
  }
  const missing = [];
  if (typeof parsed.verdict !== "string") missing.push("verdict");
  if (typeof parsed.summary !== "string") missing.push("summary");
  if (!Array.isArray(parsed.findings)) missing.push("findings");
  if (missing.length > 0) {
    return {
      kind: "invalid_shape",
      errorCode: "INVALID_SHAPE",
      message: `Review payload missing required field(s): ${missing.join(", ")}.`
    };
  }
  return { kind: "valid", errorCode: null, message: null };
}

/**
 * Set a sampling-param key on the request body only if `value` is a
 * finite number within the documented valid range. Silently skips
 * unset / null / NaN / out-of-range values so the server-side default
 * continues to apply. Callers can therefore always pass the option
 * through without guard.
 *
 * Ranges follow OpenAI-compatible convention:
 *   temperature: [0, 2]
 *   top_p: [0, 1]
 *   frequency_penalty / presence_penalty: [-2, 2]
 *   seed: any finite integer
 */
function assignOptionalSamplingParam(body, key, value, { min, max, integer = false } = {}) {
  if (value === undefined || value === null) return;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return;
  if (integer && !Number.isInteger(num)) return;
  if (typeof min === "number" && num < min) return;
  if (typeof max === "number" && num > max) return;
  body[key] = num;
}

async function runChatRequest(cwd, options = {}) {
  const availability = getGlmAvailability(cwd);
  if (!availability.available) {
    return failureShape(`GLM unavailable: ${availability.detail}`, "UNAVAILABLE");
  }

  const prompt = String(options.prompt ?? "").trim();
  if (!prompt) {
    return failureShape("Empty prompt.", "EMPTY_PROMPT");
  }

  let apiKey, endpoint, model;
  try {
    apiKey = resolveApiKey();
    endpoint = resolveEndpoint();
    model = resolveModel(options);
  } catch (error) {
    const message = formatUserFacingError(error);
    // Distinguish vision-model rejection from configuration errors so
    // callers can react differently.
    const errorCode = /vision model/i.test(message) ? "MODEL_REJECTED" : "CONFIG_ERROR";
    return failureShape(message, errorCode);
  }
  const timeoutMs = resolveTimeoutMs(options);
  const systemPrompt = options.systemPrompt || null;
  const maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
  const thinkingEnabled = Boolean(options.thinking);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    // Correction hint prepended only on in-session correction retries (see
    // runReviewWithCorrectionRetry). Plain first-attempt calls leave this
    // unset. This is how schema-echo / invalid-shape retries instruct GLM
    // to produce actual findings instead of repeating the schema.
    const correctionHint = options._correctionHint || "";
    const userContent = options.expectJson
      ? `${correctionHint}${prompt}\n\nRespond with ONLY a single JSON object. Do not wrap in markdown fences.`
      : `${correctionHint}${prompt}`;
    messages.push({ role: "user", content: userContent });

    // Default body = existing v0.4.6 shape (no sampling params). We only
    // include temperature / top_p / seed / frequency_penalty / presence_penalty
    // when the caller explicitly passes them. Rationale documented in
    // Gitea issue #7: no empirical basis for a default choice yet; the CLI
    // exposes the knobs so power users can opt in. Default change will
    // happen in a later release after the sanity-sweep data lands in
    // test-automation/review-eval/results/.
    const body = {
      model,
      max_tokens: maxTokens,
      messages,
      stream: false,
      thinking: { type: thinkingEnabled ? "enabled" : "disabled" }
    };
    assignOptionalSamplingParam(body, "temperature", options.temperature, { min: 0, max: 2 });
    assignOptionalSamplingParam(body, "top_p", options.topP ?? options.top_p, { min: 0, max: 1 });
    assignOptionalSamplingParam(body, "seed", options.seed, { integer: true });
    assignOptionalSamplingParam(body, "frequency_penalty", options.frequencyPenalty ?? options.frequency_penalty, { min: -2, max: 2 });
    assignOptionalSamplingParam(body, "presence_penalty", options.presencePenalty ?? options.presence_penalty, { min: -2, max: 2 });

    if (typeof options.onProgress === "function") {
      options.onProgress({
        message: `calling ${model}${thinkingEnabled ? " (thinking on)" : ""}`,
        phase: "starting"
      });
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "x-service-name": SERVICE_NAME
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const responseText = await safeReadText(response);

    // BigModel wraps application-level errors inside the response body's
    // `error.code` field (as a string). A single HTTP 429 can correspond
    // to concurrent-limit (1302), daily-quota (1303), insufficient-balance
    // (1304), or server-side traffic spike (1305) — each with a different
    // recovery path. Classify the vendor code before falling back to
    // generic HTTP-status handling.
    const vendorCode = extractBigModelErrorCode(responseText);
    if (vendorCode) {
      const vendor = classifyBigModelError(vendorCode, responseText, { endpoint, model });
      return failureShape(vendor.message, vendor.errorCode, {
        rawResponse: responseText,
        vendorCode: vendor.vendorCode,
        vendorMessage: vendor.vendorMessage,
        retry: vendor.retry
      });
    }

    if (response.status === 429) {
      return failureShape(
        `Rate limited by ${sanitizeUrlForDisplay(endpoint)}. Retry after quota reset.`,
        "RATE_LIMITED",
        { rawResponse: responseText, retry: "after-cooldown" }
      );
    }
    if (response.status === 401 || response.status === 403) {
      return failureShape(
        `Auth failed (HTTP ${response.status}). Stored api_key may be invalid or lack permission for ${model}. Re-run /glm:setup --api-key <key> to refresh.`,
        "AUTH_FAILED",
        { rawResponse: responseText, retry: "never" }
      );
    }
    if (response.status === 400) {
      return failureShape(
        `Bad request (HTTP 400). Response: ${responseText.slice(0, 400)}`,
        "BAD_REQUEST",
        { rawResponse: responseText, retry: "never" }
      );
    }
    if (response.status === 404) {
      return failureShape(
        `HTTP 404 from ${sanitizeUrlForDisplay(endpoint)}. Endpoint wrong for this preset? Preset base_url must be OpenAI-compatible (\`/chat/completions\` is appended automatically).`,
        "NOT_FOUND",
        { rawResponse: responseText, retry: "never" }
      );
    }
    if (!response.ok) {
      // 500/502/503/504 are transient by nature (server bug + gateway
      // errors + gateway timeouts). Drive retry via a distinct errorCode
      // so the retry layer doesn't confuse these with application-level
      // vendor errors or permanent 4xx client errors.
      const isTransientGateway = [500, 502, 503, 504].includes(response.status);
      if (isTransientGateway) {
        return failureShape(
          `HTTP ${response.status} from ${sanitizeUrlForDisplay(endpoint)} (transient gateway error): ${responseText.slice(0, 400)}`,
          "HTTP_ERROR_TRANSIENT",
          { rawResponse: responseText, retry: "immediate" }
        );
      }
      return failureShape(
        `HTTP ${response.status} from ${sanitizeUrlForDisplay(endpoint)}: ${responseText.slice(0, 400)}`,
        "HTTP_ERROR",
        { rawResponse: responseText, retry: "unknown" }
      );
    }

    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      return failureShape(
        `Response was not valid JSON: ${error.message}`,
        "INVALID_RESPONSE",
        { rawResponse: responseText }
      );
    }

    const rawOutput = extractTextFromChatCompletion(payload);
    if (!rawOutput) {
      return failureShape(
        "Response contained no assistant text.",
        "EMPTY_RESPONSE",
        { rawResponse: responseText }
      );
    }

    const reasoningSummary = extractReasoningFromChatCompletion(payload);

    if (typeof options.onProgress === "function") {
      options.onProgress({
        message: `completed in ${Date.now() - startedAt} ms`,
        phase: "completed"
      });
    }

    if (options.expectJson) {
      // Strip markdown fences before parse. GLM-5.1 under structured-output
      // + long-context conditions has been observed wrapping JSON in
      // ```json ... ``` fences despite the explicit "do not wrap in
      // markdown fences" instruction (observed in v0.4.6 aftercare dogfood).
      // Fence-stripping is cheap + idempotent so apply unconditionally.
      const cleaned = stripMarkdownFences(rawOutput);
      const parseResult = parseStructuredOutput(cleaned, {
        errorCode: null,
        reasoningSummary
      });
      // Classify the parsed payload to detect SCHEMA_ECHO / INVALID_SHAPE.
      // These are review-semantic failures distinct from JSON parse errors
      // and are handled by the caller (runReviewWithCorrectionRetry) with
      // a single targeted correction-retry round, not by the transient
      // backoff layer.
      if (parseResult.parsed !== null && parseResult.parseError === null) {
        const classification = classifyReviewPayload(parseResult.parsed);
        if (classification.kind !== "valid") {
          return failureShape(
            classification.message,
            classification.errorCode,
            {
              rawResponse: responseText,
              rawOutput: cleaned,
              parsed: parseResult.parsed,
              reasoningSummary,
              retry: "correction"
            }
          );
        }
      }
      return parseResult;
    }

    return {
      rawOutput,
      parsed: null,
      parseError: null,
      failureMessage: null,
      errorCode: null,
      reasoningSummary
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return failureShape(`Request timed out after ${timeoutMs} ms.`, "TIMEOUT");
    }
    return failureShape(`Network error: ${error?.message ?? String(error)}`, "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }
}

function extractTextFromChatCompletion(payload) {
  const choice = payload?.choices?.[0];
  if (!choice) {
    return "";
  }
  const message = choice.message ?? choice.delta ?? null;
  if (!message) {
    return "";
  }
  // Standard OpenAI: message.content is a string.
  if (typeof message.content === "string") {
    return message.content.trim();
  }
  // Defensive: some OpenAI-compatible providers return content as an array
  // of parts (like the Chat Completions vision flow). Concatenate text parts.
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function extractReasoningFromChatCompletion(payload) {
  const choice = payload?.choices?.[0];
  const message = choice?.message ?? null;
  if (!message) return null;
  // GLM returns thinking content under `reasoning_content` when
  // thinking.type === "enabled". Expose it so render.mjs can show it.
  if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
    return [message.reasoning_content.trim()];
  }
  if (Array.isArray(message.reasoning_content)) {
    const lines = message.reasoning_content
      .map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .map((line) => line.trim());
    return lines.length > 0 ? lines : null;
  }
  return null;
}

function failureShape(message, errorCode, extra = {}) {
  return {
    rawOutput: "",
    parsed: null,
    parseError: null,
    failureMessage: message,
    errorCode,
    reasoningSummary: null,
    ...extra
  };
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/**
 * Parse a structured review JSON output. Same contract as codex.mjs.
 */
export function parseStructuredOutput(rawOutput, fallback = {}) {
  if (!rawOutput) {
    return {
      parsed: null,
      parseError: fallback.failureMessage ?? "GLM did not return a final structured message.",
      rawOutput: rawOutput ?? "",
      failureMessage: null,
      ...fallback
    };
  }
  try {
    return {
      parsed: JSON.parse(rawOutput),
      parseError: null,
      rawOutput,
      failureMessage: null,
      ...fallback
    };
  } catch (error) {
    return {
      parsed: null,
      parseError: error.message,
      rawOutput,
      failureMessage: null,
      ...fallback
    };
  }
}

export function readOutputSchema(schemaPath) {
  return readJsonFile(schemaPath);
}
