import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Side-1 regression guard: /glm:status must survive a corrupt
// state.json the same way /glm:setup does (I-1 fix). buildStatusSnapshot
// reads state twice (getConfig + listJobs, both via loadState) — pre-fix
// either throw crashes the whole command even though the user could
// recover if they could see the hint.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const companionScript = path.join(repoRoot, "scripts", "glm-companion.mjs");

async function seedCorruptStateJson(pluginData, fakeRepo) {
  process.env.CLAUDE_PLUGIN_DATA = pluginData;
  const mod = await import(`../scripts/lib/state.mjs?t=${Date.now()}-${Math.random()}`);
  mod.saveState(fakeRepo, { config: {}, jobs: [] });
  const stateFile = mod.resolveStateFile(fakeRepo);
  fs.writeFileSync(stateFile, "{ not valid JSON at all", "utf8");
  return stateFile;
}

test("/glm:status survives corrupt state.json and reports stateError (Side-1)", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "glm-status-resilience-data-"));
  const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), "glm-status-resilience-repo-"));
  fs.mkdirSync(path.join(fakeRepo, ".git"), { recursive: true });
  const xdgConfig = fs.mkdtempSync(path.join(os.tmpdir(), "glm-status-resilience-cfg-"));
  await seedCorruptStateJson(pluginData, fakeRepo);

  const result = spawnSync(
    process.execPath,
    [companionScript, "status", "--json"],
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

  // Pre-fix: crashed with exit 1 and a raw stacktrace; user saw
  // nothing about recovery. Post-fix: status still renders; the
  // stateError surfaces so the user knows which file to fix.
  assert.equal(result.status, 0, `status exited non-zero: stderr=${result.stderr}`);

  const parsed = JSON.parse(result.stdout);
  const snapshot = parsed.snapshot ?? parsed;
  assert.equal(typeof snapshot.stateError, "string", "snapshot.stateError missing");
  assert.match(snapshot.stateError, /Could not parse .*state\.json/);
  // Lists must be empty (jobs unreadable) but the response shape is intact.
  assert.ok(Array.isArray(snapshot.running));
  assert.equal(snapshot.running.length, 0);
  assert.equal(snapshot.latestFinished, null);
});
