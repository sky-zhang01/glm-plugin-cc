/**
 * Preset + user-config persistence for glm-plugin-cc (OpenAI-compatible).
 *
 * Mirrors the codex CLI pattern (`~/.codex/auth.json`): the API key is
 * persisted to `~/.config/glm-plugin-cc/config.json` (mode 0600, XDG-
 * compliant) alongside the endpoint preset. No environment-variable
 * fallback — `/glm:setup` is the one entry point for configuring the
 * key, matching `codex login --api-key <key>`.
 *
 * Endpoints are OpenAI-compatible (POST /chat/completions). Defaults
 * target 国内智谱 BigModel; overseas Z.AI / self-hosted endpoints can be
 * plugged in via the `custom` preset.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const BUILTIN_PRESETS = Object.freeze({
  "coding-plan": Object.freeze({
    id: "coding-plan",
    display: "智谱 BigModel Coding Plan",
    base_url: "https://open.bigmodel.cn/api/coding/paas/v4",
    default_model: "glm-5.1",
    docs_url: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
    notes: "Subscription-priced coding plan via 智谱 BigModel (国内)."
  }),
  "pay-as-you-go": Object.freeze({
    id: "pay-as-you-go",
    display: "智谱 BigModel Pay-as-you-go",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    default_model: "glm-5.1",
    docs_url: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
    notes: "Metered billing via 智谱 BigModel (国内). Pay per token."
  }),
  "custom": Object.freeze({
    id: "custom",
    display: "Custom endpoint",
    base_url: null,
    default_model: "glm-5.1",
    docs_url: null,
    notes: "Bring-your-own OpenAI-compatible endpoint (e.g. 海外 Z.AI, self-hosted)."
  })
});

const VALID_PRESET_IDS = new Set(Object.keys(BUILTIN_PRESETS));

export function getConfigDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.startsWith("/") ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "glm-plugin-cc");
}

export function getConfigFilePath() {
  return path.join(getConfigDir(), "config.json");
}

export function readConfigFile() {
  const filePath = getConfigFilePath();
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return sanitizeConfig(parsed);
  } catch (error) {
    throw new Error(
      `Could not parse ${filePath}: ${error.message}. Delete or fix the file, then re-run /glm:setup.`
    );
  }
}

function sanitizeConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    // Reject null / primitives / arrays — a config file must be a plain object.
    return null;
  }
  const presetId = typeof input.preset_id === "string" ? input.preset_id : null;
  if (presetId && !VALID_PRESET_IDS.has(presetId)) {
    throw new Error(
      `Config file has unknown preset_id "${presetId}". Expected one of: ${[...VALID_PRESET_IDS].join(", ")}.`
    );
  }
  const baseUrl = typeof input.base_url === "string" ? input.base_url.trim() : null;
  if (baseUrl && !/^https:\/\//i.test(baseUrl)) {
    throw new Error(`Config file base_url must start with https:// (got: ${baseUrl}).`);
  }
  const defaultModel = typeof input.default_model === "string" ? input.default_model.trim() : null;
  const apiKeyRaw = typeof input.api_key === "string" ? input.api_key : null;
  // Accept only plausibly shaped keys. Strip whitespace; reject empty
  // strings. Max length is a generous 512 so any provider's token fits.
  const apiKey = apiKeyRaw ? apiKeyRaw.trim() : null;
  if (apiKey !== null && (apiKey.length === 0 || apiKey.length > 512)) {
    throw new Error("Config file api_key has invalid length (must be 1-512 chars).");
  }
  return {
    preset_id: presetId,
    base_url: baseUrl,
    default_model: defaultModel || null,
    api_key: apiKey || null,
    updated_at_utc: typeof input.updated_at_utc === "string" ? input.updated_at_utc : null
  };
}

export function writeConfigFile(partial) {
  // Use readConfigFile (throws on corrupt, returns null on missing) — never
  // swallow the corrupt case: if a user runs `/glm:setup --api-key <new>`
  // against a corrupt config, we must NOT silently drop their preset /
  // base_url / default_model to null during the merge. Missing file
  // (first-run) still works: returns null, merge fills from partial.
  const existing = readConfigFile();
  const merged = {
    preset_id: partial.preset_id ?? existing?.preset_id ?? null,
    base_url: partial.base_url ?? existing?.base_url ?? null,
    default_model: partial.default_model ?? existing?.default_model ?? null,
    api_key: partial.api_key ?? existing?.api_key ?? null,
    updated_at_utc: new Date().toISOString()
  };

  if (merged.preset_id && !VALID_PRESET_IDS.has(merged.preset_id)) {
    throw new Error(
      `preset_id must be one of: ${[...VALID_PRESET_IDS].join(", ")} (got: ${merged.preset_id}).`
    );
  }
  if (merged.base_url && !/^https:\/\//i.test(merged.base_url)) {
    throw new Error(`base_url must start with https:// (got: ${merged.base_url}).`);
  }
  if (merged.api_key !== null) {
    const trimmed = String(merged.api_key).trim();
    if (!trimmed || trimmed.length > 512) {
      throw new Error("api_key has invalid length (must be 1-512 chars after trim).");
    }
    merged.api_key = trimmed;
  }

  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Defense-in-depth: mkdirSync mode isn't re-applied when the dir already
  // exists. Force-tighten regardless.
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* non-fatal */
  }

  const filePath = getConfigFilePath();
  // Atomic write: tmp + rename prevents half-written state if two /glm:setup
  // calls race, and leaves the old file intact on error.
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(tmpPath, 0o600);
  } catch {
    /* non-fatal */
  }
  fs.renameSync(tmpPath, filePath);
  // Second chmod after rename in case rename crossed a filesystem that
  // reset perms.
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* non-fatal */
  }
  return { path: filePath, config: merged };
}

/**
 * Resolve effective config by merging builtin preset + user config.
 *
 * Returns non-sensitive fields only. The API key is intentionally NOT
 * returned here — callers that need the key use `resolveApiKeyFromConfig()`.
 * This keeps the key out of `/glm:setup --json` output, job records,
 * error messages, and any accidental logging of the full config object.
 *
 * Fail-closed: if the config file exists but is corrupt (unparseable
 * JSON, invalid preset_id, non-https base_url, wrong shape), this
 * THROWS. Callers must catch and surface the error to the user rather
 * than silently falling through to the built-in fallback endpoint.
 *
 * Missing config file is NOT an error — returns { source: "unconfigured" }.
 */
export function resolveEffectiveConfig() {
  const userConfig = readConfigFile();
  const preset = userConfig?.preset_id ? BUILTIN_PRESETS[userConfig.preset_id] : null;

  const baseUrl =
    userConfig?.base_url || preset?.base_url || null;
  const defaultModel =
    userConfig?.default_model || preset?.default_model || null;

  return {
    source: userConfig ? "user-config" : "unconfigured",
    preset_id: userConfig?.preset_id ?? null,
    preset_display: preset?.display ?? null,
    base_url: baseUrl,
    default_model: defaultModel,
    // Boolean flag only — never the raw key.
    has_api_key: Boolean(userConfig?.api_key),
    updated_at_utc: userConfig?.updated_at_utc ?? null,
    notes: preset?.notes ?? null,
    docs_url: preset?.docs_url ?? null
  };
}

/**
 * Read the persisted API key directly from config.json. Returns null
 * when the key is unset. Throws via readConfigFile() if the file is
 * corrupt.
 *
 * Separate function (rather than part of resolveEffectiveConfig) so
 * sensitive material only enters memory when a caller explicitly needs
 * it for an outgoing HTTP request.
 */
export function resolveApiKeyFromConfig() {
  const config = readConfigFile();
  return config?.api_key ?? null;
}

/**
 * Apply a preset plus optional overrides. Returns the persisted config.
 * For preset_id === "custom", base_url is required.
 *
 * Does NOT touch the api_key field (preserved as-is across preset
 * changes). Use `persistApiKey` to set/rotate the key.
 */
export function applyPreset({ preset_id, base_url, default_model } = {}) {
  if (!preset_id) {
    throw new Error("applyPreset requires preset_id");
  }
  if (!VALID_PRESET_IDS.has(preset_id)) {
    throw new Error(
      `Unknown preset "${preset_id}". Expected one of: ${[...VALID_PRESET_IDS].join(", ")}.`
    );
  }
  const preset = BUILTIN_PRESETS[preset_id];

  let resolvedBaseUrl = base_url || preset.base_url || null;
  if (preset_id === "custom" && !resolvedBaseUrl) {
    throw new Error("Custom preset requires --base-url <https://...>.");
  }
  if (resolvedBaseUrl && !/^https:\/\//i.test(resolvedBaseUrl)) {
    // Truncate to avoid echoing accidentally-pasted credentials back in errors.
    const shown = resolvedBaseUrl.length > 80 ? `${resolvedBaseUrl.slice(0, 80)}…` : resolvedBaseUrl;
    throw new Error(`base_url must start with https:// (got: ${shown}).`);
  }
  if (resolvedBaseUrl) {
    // strip trailing slashes and any accidental /chat/completions suffix users may paste
    resolvedBaseUrl = resolvedBaseUrl
      .replace(/\/+$/, "")
      .replace(/\/chat\/completions$/i, "");
  }

  return writeConfigFile({
    preset_id,
    base_url: resolvedBaseUrl,
    default_model: default_model || preset.default_model || null
  });
}

/**
 * Persist a new API key to config.json. Preset / base_url / default_model
 * are preserved. Separate from applyPreset so callers can rotate the
 * key without re-selecting a preset.
 *
 * To remove the stored key, delete ~/.config/glm-plugin-cc/config.json
 * (or re-run `/glm:setup --preset <id> --api-key ""`). We intentionally
 * do not expose a "logout" flow — the simpler path is to rewrite the
 * config via the same setup command.
 */
export function persistApiKey(apiKey) {
  const trimmed = String(apiKey ?? "").trim();
  if (!trimmed) {
    throw new Error("persistApiKey requires a non-empty string.");
  }
  if (trimmed.length > 512) {
    throw new Error("api_key is too long (max 512 chars).");
  }
  return writeConfigFile({ api_key: trimmed });
}

export function listPresets() {
  return Object.values(BUILTIN_PRESETS).map((preset) => ({
    id: preset.id,
    display: preset.display,
    base_url: preset.base_url,
    default_model: preset.default_model,
    notes: preset.notes,
    docs_url: preset.docs_url
  }));
}
