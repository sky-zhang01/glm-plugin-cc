import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// preset-config uses XDG_CONFIG_HOME env var, falling back to ~/.config.
// Tests point it at a unique tmp dir per run to avoid touching real config.
function makeTempConfigHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-preset-test-"));
  process.env.XDG_CONFIG_HOME = dir;
  return dir;
}

function readConfigJson(configHome) {
  return JSON.parse(
    fs.readFileSync(path.join(configHome, "glm-plugin-cc", "config.json"), "utf8")
  );
}

test("writeConfigFile: first-run (no existing config) writes partial verbatim", async () => {
  const home = makeTempConfigHome();
  const mod = await import(
    `../scripts/lib/preset-config.mjs?t=${Date.now()}-${Math.random()}`
  );
  mod.writeConfigFile({ preset_id: "coding-plan", api_key: "sk-test-first" });
  const written = readConfigJson(home);
  assert.equal(written.preset_id, "coding-plan");
  assert.equal(written.api_key, "sk-test-first");
});

test("writeConfigFile: merges with existing valid config (preserves other fields on key rotation)", async () => {
  const home = makeTempConfigHome();
  const configDir = path.join(home, "glm-plugin-cc");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify({
      preset_id: "coding-plan",
      base_url: "https://open.bigmodel.cn/api/coding/paas/v4",
      default_model: "glm-5.1",
      api_key: "sk-old-key",
      updated_at_utc: "2026-01-01T00:00:00Z"
    }),
    "utf8"
  );
  const mod = await import(
    `../scripts/lib/preset-config.mjs?t=${Date.now()}-${Math.random()}`
  );
  mod.writeConfigFile({ api_key: "sk-new-rotated-key" });
  const written = readConfigJson(home);
  assert.equal(written.preset_id, "coding-plan");
  assert.equal(written.base_url, "https://open.bigmodel.cn/api/coding/paas/v4");
  assert.equal(written.default_model, "glm-5.1");
  assert.equal(written.api_key, "sk-new-rotated-key");
});

test("writeConfigFile: throws on CORRUPT existing config (does not silently drop preset)", async () => {
  const home = makeTempConfigHome();
  const configDir = path.join(home, "glm-plugin-cc");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    "{ this is not valid JSON",
    "utf8"
  );
  const mod = await import(
    `../scripts/lib/preset-config.mjs?t=${Date.now()}-${Math.random()}`
  );
  // Regression guard for M-A: pre-fix, writeConfigFile silently merged
  // with existing=null and dropped preset_id / base_url / default_model.
  // Post-fix: throws a clear error pointing at the bad file.
  assert.throws(
    () => mod.writeConfigFile({ api_key: "sk-new-key" }),
    /Could not parse .*config\.json/
  );
});
