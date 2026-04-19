/**
 * GLM model catalog — validation + vision-model deny list.
 *
 * Kept deliberately minimal: the plugin does not need to maintain a full
 * model list. It just needs to reject obvious misuse (passing a vision
 * model to a text-review command) and expose a sanctioned default.
 *
 * Vision models are rejected up-front because this plugin sends only
 * text messages; routing a vision model would still be billed but the
 * model would operate on text alone, producing confusing output.
 *
 * Keep this list conservative — only models that are unambiguously
 * vision-only (or vision-primary) belong here. When in doubt, leave the
 * model out of the deny list and let the HTTP response tell the user.
 */

// Picked to match codex CLI's default tier (gpt-5.4 flagship):
//   - Artificial Analysis Intelligence Index: gpt-5.4 = 57, glm-5.1 = 51 (closest open-weights)
//   - SWE-Bench Pro: glm-5.1 = 58.4 (outperforms gpt-5.4, Claude Opus 4.6, Gemini 3.1 Pro)
//   - BenchLM aggregate: glm-5.1 (84) vs gpt-5.4-mini (73)
//   - Available to all 智谱 Coding Plan tiers (Max/Pro/Lite) since 2026-03-28
// Override per-call with --model glm-4.6/glm-5/glm-5-turbo when latency or cost matters more.
export const DEFAULT_MODEL = "glm-5.1";

/**
 * Vision-only / vision-primary GLM models. Lower-cased for case-insensitive
 * matching against user input.
 */
const VISION_MODEL_DENYLIST = new Set([
  "glm-4v",
  "glm-4v-flash",
  "glm-4v-plus",
  "glm-4.1v-thinking",
  "glm-4.1v-thinking-flash",
  "glm-4.1v-thinking-flashx",
  "glm-4.5v",
  "glm-4.6v"
]);

/**
 * Returns true if the model name looks like a vision-primary GLM model.
 * Pattern-based check is the primary guard; the explicit set above is a
 * short list of known-bad names for nicer error messages.
 */
export function isVisionModel(model) {
  if (typeof model !== "string" || !model.trim()) {
    return false;
  }
  const normalized = model.trim().toLowerCase();
  if (VISION_MODEL_DENYLIST.has(normalized)) {
    return true;
  }
  // Generic pattern: glm-<N>v, glm-<N>.<M>v-*, glm-<N>.<M>v<suffix>
  // Matches glm-4v, glm-4.5v, glm-4.6v, glm-4.1v-thinking, etc.
  return /^glm-\d+(?:\.\d+)?v(?:[-.].*)?$/i.test(normalized);
}

/**
 * Throw if the caller picked a vision model. Text-review commands cannot
 * meaningfully use vision models; fail fast rather than silently wasting a
 * request.
 */
export function assertNonVisionModel(model) {
  if (isVisionModel(model)) {
    throw new Error(
      `Model "${model}" is a GLM vision model; glm-plugin-cc only issues text requests. ` +
        `Use a text model (e.g. glm-4.6, glm-5.1, glm-5-turbo) or omit --model to use the default.`
    );
  }
}
