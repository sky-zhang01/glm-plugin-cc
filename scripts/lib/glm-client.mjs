/**
 * GLM OpenAI-compatible client.
 *
 * GLM is stateless HTTP — no broker, no persistent sessions, no thread resume.
 * We keep the function surface aligned with the codex-plugin-cc scaffold so
 * the companion / render / job-control code can call us uniformly.
 *
 * Endpoint: ${base_url}/chat/completions
 *   base_url defaults to https://open.bigmodel.cn/api/paas/v4
 *   coding-plan preset:   https://open.bigmodel.cn/api/coding/paas/v4
 *   pay-as-you-go preset: https://open.bigmodel.cn/api/paas/v4
 *   custom preset:        user-supplied https://... (e.g. 海外 api.z.ai/api/paas/v4)
 *
 * Auth: `Authorization: Bearer ${ZAI_API_KEY}` header (OpenAI-compatible).
 *
 * Thinking: OFF by default (matches codex `--effort unset`). Opt-in via
 * `thinking: true` (or CLI `--thinking on`). GLM uses the `thinking`
 * request field `{"type": "enabled" | "disabled"}`.
 */

import { readJsonFile } from "./fs.mjs";
import { assertNonVisionModel, DEFAULT_MODEL } from "./model-catalog.mjs";
import { resolveEffectiveConfig } from "./preset-config.mjs";

const FALLBACK_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 min aligned with codex review gate

export const DEFAULT_CONTINUE_PROMPT =
  "Continue from the previous turn. Identify the next highest-value step and complete it.";
export const TASK_THREAD_PREFIX = "GLM Companion Task";

const SERVICE_NAME = "claude_code_glm_plugin";

function getEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function resolveApiKey() {
  return getEnv("ZAI_API_KEY") || getEnv("Z_AI_API_KEY") || getEnv("GLM_API_KEY");
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
 * accidentally pasted into `ZAI_BASE_URL` or `--base-url`.
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
  const override = getEnv("ZAI_BASE_URL");
  if (override) {
    if (!/^https:\/\//i.test(override)) {
      throw new Error(
        `ZAI_BASE_URL must use https:// (got: ${sanitizeUrlForDisplay(override)}). Plaintext endpoints would leak the API key.`
      );
    }
    return normalizeBaseUrl(override);
  }
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
  let model = null;
  if (options.model) {
    model = options.model;
  } else {
    const envModel = getEnv("GLM_MODEL");
    if (envModel) {
      model = envModel;
    } else {
      const config = resolveEffectiveConfig();
      model = config.default_model || DEFAULT_MODEL;
    }
  }
  // Guard against accidentally routing vision models through text-only commands.
  assertNonVisionModel(model);
  return model;
}

export function resolveConfigSummary() {
  return resolveEffectiveConfig();
}

function resolveTimeoutMs(options = {}) {
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
  const key = resolveApiKey();
  if (!key) {
    return {
      available: false,
      detail: "ZAI_API_KEY (or Z_AI_API_KEY / GLM_API_KEY) environment variable not set."
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
    return {
      available: false,
      detail: error instanceof Error ? error.message : String(error)
    };
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
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
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
      return { ok: false, detail: `Auth failed (HTTP ${response.status}). Check ZAI_API_KEY.` };
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
 * GLM has no persistent threads. This always resolves to null.
 */
export async function findLatestTaskThread(cwd) {
  return null;
}

/**
 * Persistent task name is not applicable for GLM. Returned value is purely
 * cosmetic so the job record still has a title.
 */
export function buildPersistentTaskThreadName(prompt) {
  const firstLine = String(prompt ?? "").split(/\r?\n/)[0].trim();
  const suffix = firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine || "(no prompt)";
  return `${TASK_THREAD_PREFIX} · ${suffix}`;
}

/**
 * HTTP isn't cancelable in the same way as a persistent session. We expose a
 * no-op so the companion's cancel path stays consistent; actual AbortController
 * is held inside the request function for its own lifetime.
 */
export async function interruptAppServerTurn(cwd, { threadId, turnId } = {}) {
  return { ok: true, detail: "GLM requests are stateless; nothing to interrupt server-side." };
}

/**
 * Send a review request. `prompt` is the full review prompt (the harness or
 * the command renderer composes it — we do not synthesize prompts here).
 *
 * Returns the same shape codex.runAppServerReview returns:
 *   { rawOutput, parsed, parseError, failureMessage, threadId, turnId, errorCode }
 */
export async function runGlmReview(cwd, options = {}) {
  return runChatRequest(cwd, { ...options, expectJson: true });
}

/**
 * Send a free-form task request. Returns the raw output without JSON parsing.
 */
export async function runGlmTask(cwd, options = {}) {
  return runChatRequest(cwd, { ...options, expectJson: false });
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
    const message = error instanceof Error ? error.message : String(error);
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
    const userContent = options.expectJson
      ? `${prompt}\n\nRespond with ONLY a single JSON object. Do not wrap in markdown fences.`
      : prompt;
    messages.push({ role: "user", content: userContent });

    const body = {
      model,
      max_tokens: maxTokens,
      messages,
      stream: false,
      thinking: { type: thinkingEnabled ? "enabled" : "disabled" }
    };

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

    if (response.status === 429) {
      return failureShape(
        `Rate limited by ${sanitizeUrlForDisplay(endpoint)}. Retry after quota reset.`,
        "RATE_LIMITED",
        { rawResponse: responseText }
      );
    }
    if (response.status === 401 || response.status === 403) {
      return failureShape(
        `Auth failed (HTTP ${response.status}). ZAI_API_KEY may be invalid or lack permission for ${model}.`,
        "AUTH_FAILED",
        { rawResponse: responseText }
      );
    }
    if (response.status === 400) {
      return failureShape(
        `Bad request (HTTP 400). Response: ${responseText.slice(0, 400)}`,
        "BAD_REQUEST",
        { rawResponse: responseText }
      );
    }
    if (response.status === 404) {
      return failureShape(
        `HTTP 404 from ${sanitizeUrlForDisplay(endpoint)}. Endpoint wrong for this preset? Preset base_url must be OpenAI-compatible (\`/chat/completions\` is appended automatically).`,
        "NOT_FOUND",
        { rawResponse: responseText }
      );
    }
    if (!response.ok) {
      return failureShape(
        `HTTP ${response.status} from ${sanitizeUrlForDisplay(endpoint)}: ${responseText.slice(0, 400)}`,
        "HTTP_ERROR",
        { rawResponse: responseText }
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
      return parseStructuredOutput(rawOutput, {
        threadId: null,
        turnId: null,
        errorCode: null,
        reasoningSummary
      });
    }

    return {
      rawOutput,
      parsed: null,
      parseError: null,
      failureMessage: null,
      threadId: null,
      turnId: null,
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
    threadId: null,
    turnId: null,
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
