import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Regression guard for I-1: `/glm:setup` must survive a corrupt
// state.json and still emit the report + recovery guidance. Pre-fix,
// `buildSetupReport` called `getConfig(workspaceRoot)` unguarded at
// line 179; after our H-A fix made `loadState` fail-closed on corrupt
// state.json, the setup command itself became the casualty — the very
// command the user would run to recover.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const companionScript = path.join(repoRoot, "scripts", "glm-companion.mjs");

function setupCorruptState() {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "glm-setup-resilience-data-"));
  const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), "glm-setup-resilience-repo-"));
  fs.mkdirSync(path.join(fakeRepo, ".git"), { recursive: true });
  // XDG_CONFIG_HOME isolates the user config file too so this test
  // doesn't read the developer's real ~/.config/glm-plugin-cc.
  const xdgConfig = fs.mkdtempSync(path.join(os.tmpdir(), "glm-setup-resilience-cfg-"));
  return { pluginData, fakeRepo, xdgConfig };
}

async function seedCorruptStateJson(pluginData, fakeRepo) {
  process.env.CLAUDE_PLUGIN_DATA = pluginData;
  const mod = await import(`../scripts/lib/state.mjs?t=${Date.now()}-${Math.random()}`);
  mod.saveState(fakeRepo, { config: {}, jobs: [] });
  const stateFile = mod.resolveStateFile(fakeRepo);
  fs.writeFileSync(stateFile, "{ not valid JSON at all", "utf8");
  return stateFile;
}

test("/glm:setup survives corrupt state.json and reports stateError (regression: I-1)", async () => {
  const { pluginData, fakeRepo, xdgConfig } = setupCorruptState();
  const stateFile = await seedCorruptStateJson(pluginData, fakeRepo);

  const result = spawnSync(
    process.execPath,
    [companionScript, "setup", "--json"],
    {
      cwd: fakeRepo,
      env: {
        ...process.env,
        CLAUDE_PLUGIN_DATA: pluginData,
        XDG_CONFIG_HOME: xdgConfig
      },
      encoding: "utf8",
      timeout: 10_000
    }
  );

  // Pre-fix: process exited with code 1 and a raw "Could not parse
  // ...state.json" stderr line; user saw no setup report at all.
  // Post-fix: report still renders (exit 0) with a state.error line
  // plus a "Fix state file error" entry in nextSteps.
  assert.equal(result.status, 0, `setup exited non-zero: stderr=${result.stderr}`);

  const parsed = JSON.parse(result.stdout);
  // The report shape is { command: "setup", report: {...} }.
  const report = parsed.report ?? parsed;
  assert.equal(typeof report.state?.error, "string", "report.state.error missing");
  assert.match(report.state.error, /Could not parse .*state\.json/);
  const hasStateFixStep = report.nextSteps.some((step) =>
    /state file error/i.test(step)
  );
  assert.ok(hasStateFixStep, `expected nextSteps to include a state file fix hint; got: ${JSON.stringify(report.nextSteps)}`);
  // The report must also still mark itself not-ready so the user knows
  // there's work to do.
  assert.equal(report.ready, false);
});
