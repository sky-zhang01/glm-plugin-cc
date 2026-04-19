/**
 * Preset + user-config persistence for glm-plugin-cc.
 *
 * API-key is NEVER stored here (always read from ZAI_API_KEY env).
 * Only endpoint preset + default model are persisted, to
 * `~/.config/glm-plugin-cc/config.json` (XDG-compliant).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const BUILTIN_PRESETS = Object.freeze({
  "coding-plan": Object.freeze({
    id: "coding-plan",
    display: "Z.AI Coding Plan",
    base_url: "https://api.z.ai/api/anthropic",
    default_model: "glm-4.6",
    api_key_env: "ZAI_API_KEY",
    docs_url: "https://z.ai",
    notes: "Subscription-priced coding plan. Best for regular review use."
  }),
  "pay-as-you-go": Object.freeze({
    id: "pay-as-you-go",
    display: "Z.AI Pay-as-you-go (BigModel)",
    base_url: "https://open.bigmodel.cn/api/anthropic",
    default_model: "glm-4.6",
    api_key_env: "ZAI_API_KEY",
    docs_url: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
    notes: "Metered billing via BigModel console. Pay per token."
  }),
  "custom": Object.freeze({
    id: "custom",
    display: "Custom endpoint",
    base_url: null,
    default_model: "glm-4.6",
    api_key_env: "ZAI_API_KEY",
    docs_url: null,
    notes: "Bring-your-own Anthropic-compatible endpoint."
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
  if (!input || typeof input !== "object") {
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
  return {
    preset_id: presetId,
    base_url: baseUrl,
    default_model: defaultModel || null,
    updated_at_utc: typeof input.updated_at_utc === "string" ? input.updated_at_utc : null
  };
}

export function writeConfigFile(partial) {
  const existing = safeReadConfigOrNull();
  const merged = {
    preset_id: partial.preset_id ?? existing?.preset_id ?? null,
    base_url: partial.base_url ?? existing?.base_url ?? null,
    default_model: partial.default_model ?? existing?.default_model ?? null,
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

function safeReadConfigOrNull() {
  try {
    return readConfigFile();
  } catch {
    return null;
  }
}

/**
 * Resolve effective config by merging builtin preset + user config.
 * Never reads API keys — only endpoint + model.
 */
export function resolveEffectiveConfig() {
  const userConfig = safeReadConfigOrNull();
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
    updated_at_utc: userConfig?.updated_at_utc ?? null,
    notes: preset?.notes ?? null,
    docs_url: preset?.docs_url ?? null
  };
}

/**
 * Apply a preset plus optional overrides. Returns the persisted config.
 * For preset_id === "custom", base_url is required.
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
    // strip trailing slashes and any accidental /v1/messages suffix users may paste
    resolvedBaseUrl = resolvedBaseUrl
      .replace(/\/+$/, "")
      .replace(/\/v1\/messages$/i, "");
  }

  return writeConfigFile({
    preset_id,
    base_url: resolvedBaseUrl,
    default_model: default_model || preset.default_model || null
  });
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
