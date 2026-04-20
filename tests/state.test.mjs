import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// state.mjs writes under $CLAUDE_PLUGIN_DATA/state/<slug>/state.json.
// Isolate by pointing CLAUDE_PLUGIN_DATA at a unique tmp dir per test.
function makeTempPluginData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-state-test-"));
  process.env.CLAUDE_PLUGIN_DATA = dir;
  return dir;
}

async function freshModule() {
  return import(`../scripts/lib/state.mjs?t=${Date.now()}-${Math.random()}`);
}

test("loadState: missing state file returns defaultState (first-run)", async () => {
  makeTempPluginData();
  const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), "glm-state-cwd-"));
  // Make it look like a workspace root
  fs.mkdirSync(path.join(fakeRepo, ".git"), { recursive: true });
  const mod = await freshModule();
  const state = mod.loadState(fakeRepo);
  assert.ok(Array.isArray(state.jobs));
  assert.equal(state.jobs.length, 0);
  assert.ok(state.config !== undefined);
});

test("loadState: valid state.json parses correctly", async () => {
  const plugData = makeTempPluginData();
  const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), "glm-state-cwd-"));
  fs.mkdirSync(path.join(fakeRepo, ".git"), { recursive: true });
  const mod = await freshModule();
  mod.saveState(fakeRepo, {
    config: { stopReviewGate: true },
    jobs: [{ id: "job-x", status: "completed", updatedAt: "2026-04-21T00:00:00Z" }]
  });
  const loaded = mod.loadState(fakeRepo);
  assert.equal(loaded.config.stopReviewGate, true);
  assert.equal(loaded.jobs.length, 1);
  assert.equal(loaded.jobs[0].id, "job-x");
});

test("loadState: CORRUPT state.json throws (regression guard: H-A)", async () => {
  const plugData = makeTempPluginData();
  const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), "glm-state-cwd-"));
  fs.mkdirSync(path.join(fakeRepo, ".git"), { recursive: true });
  const mod = await freshModule();
  // Seed a valid state first so the state dir exists, then corrupt it.
  mod.saveState(fakeRepo, { config: {}, jobs: [{ id: "job-a", updatedAt: "2026-04-21T00:00:00Z" }] });
  const stateFile = mod.resolveStateFile(fakeRepo);
  fs.writeFileSync(stateFile, "{ this is not valid JSON", "utf8");

  // Pre-fix: loadState silently returned defaultState() (empty jobs).
  // Then saveState would write fresh state and orphan the on-disk job
  // files since previousJobs was []. Post-fix: throws clearly.
  assert.throws(
    () => mod.loadState(fakeRepo),
    /Could not parse .*state\.json/
  );
});

test("readJobFile: CORRUPT job file throws with file path (regression guard: MED-2)", async () => {
  makeTempPluginData();
  const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), "glm-state-cwd-"));
  fs.mkdirSync(path.join(fakeRepo, ".git"), { recursive: true });
  const mod = await freshModule();
  // writeJobFile needs the state dir to exist; writeJobFile creates it.
  const jobFile = mod.writeJobFile(fakeRepo, "job-broken", { id: "job-broken", status: "completed" });
  fs.writeFileSync(jobFile, "{ not valid JSON", "utf8");

  // Pre-fix: threw bare `SyntaxError: Expected property name or '}' in
  // JSON at position 2` with NO filename — user running /glm:result
  // <id> had no idea which file to delete.
  assert.throws(
    () => mod.readJobFile(jobFile),
    (err) => err.message.includes(jobFile) && /Could not parse/.test(err.message)
  );
});
