/**
 * GLM Anthropic-compatible client.
 *
 * GLM is stateless HTTP — no broker, no persistent sessions, no thread resume.
 * We keep the function surface aligned with the codex-plugin-cc scaffold so
 * the companion / render / job-control code can call us uniformly.
 *
 * Endpoint: https://api.z.ai/api/anthropic/v1/messages
 * Auth: `x-api-key: ${ZAI_API_KEY}` header (Anthropic-compatible).
 */

import { readJsonFile } from "./fs.mjs";

const DEFAULT_ENDPOINT = "https://api.z.ai/api/anthropic/v1/messages";
const DEFAULT_MODEL = "glm-4.6";
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

function resolveEndpoint() {
  const override = getEnv("ZAI_BASE_URL");
  if (!override) {
    return DEFAULT_ENDPOINT;
  }
  if (!/^https:\/\//i.test(override)) {
    throw new Error(
      `ZAI_BASE_URL must use https:// (got: ${override}). Plaintext endpoints would leak the API key.`
    );
  }
  return `${override.replace(/\/+$/, "")}/v1/messages`;
}

function resolveModel(options = {}) {
  return options.model || getEnv("GLM_MODEL") || DEFAULT_MODEL;
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
  return {
    available: true,
    detail: `endpoint=${resolveEndpoint()}, model=${resolveModel()}`
  };
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
  const apiKey = resolveApiKey();
  const endpoint = resolveEndpoint();
  const timeoutMs = resolveTimeoutMs({ timeoutMs: 15000 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: resolveModel(options),
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
    return { ok: true, detail: `HTTP ${response.status} from ${endpoint}` };
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
  return runMessagesRequest(cwd, { ...options, expectJson: true });
}

/**
 * Send a free-form task request. Returns the raw output without JSON parsing.
 */
export async function runGlmTask(cwd, options = {}) {
  return runMessagesRequest(cwd, { ...options, expectJson: false });
}

async function runMessagesRequest(cwd, options = {}) {
  const availability = getGlmAvailability(cwd);
  if (!availability.available) {
    return failureShape(`GLM unavailable: ${availability.detail}`, "UNAVAILABLE");
  }

  const prompt = String(options.prompt ?? "").trim();
  if (!prompt) {
    return failureShape("Empty prompt.", "EMPTY_PROMPT");
  }

  const apiKey = resolveApiKey();
  const endpoint = resolveEndpoint();
  const model = resolveModel(options);
  const timeoutMs = resolveTimeoutMs(options);
  const systemPrompt = options.systemPrompt || null;
  const maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const body = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }]
    };
    if (systemPrompt) {
      body.system = systemPrompt;
    }
    if (options.expectJson) {
      body.messages[0].content =
        `${prompt}\n\nRespond with ONLY a single JSON object. Do not wrap in markdown fences.`;
    }

    if (typeof options.onProgress === "function") {
      options.onProgress({ message: `calling ${model}`, phase: "starting" });
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "x-service-name": SERVICE_NAME
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const responseText = await safeReadText(response);

    if (response.status === 429) {
      return failureShape(
        `Rate limited by ${endpoint}. Retry after quota reset.`,
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
    if (!response.ok) {
      return failureShape(
        `HTTP ${response.status} from ${endpoint}: ${responseText.slice(0, 400)}`,
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

    const rawOutput = extractTextFromAnthropicResponse(payload);
    if (!rawOutput) {
      return failureShape(
        "Response contained no text content.",
        "EMPTY_RESPONSE",
        { rawResponse: responseText }
      );
    }

    if (typeof options.onProgress === "function") {
      options.onProgress({
        message: `completed in ${Date.now() - startedAt} ms`,
        phase: "completed"
      });
    }

    if (options.expectJson) {
      return parseStructuredOutput(rawOutput, { threadId: null, turnId: null, errorCode: null });
    }

    return {
      rawOutput,
      parsed: null,
      parseError: null,
      failureMessage: null,
      threadId: null,
      turnId: null,
      errorCode: null
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

function extractTextFromAnthropicResponse(payload) {
  if (!payload || !Array.isArray(payload.content)) {
    return "";
  }
  return payload.content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
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
