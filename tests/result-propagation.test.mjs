import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// GAP-2: MED-2 (readJobFile throws with path on corrupt job file) has
// a direct unit test, but no propagation test. If the throw doesn't
// reach main().catch cleanly, users of /glm:result see a stacktrace
// instead of the actionable message. This test spawns /glm:result
// against a real corrupt job file and asserts the clean-exit path.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const companionScript = path.join(repoRoot, "scripts", "glm-companion.mjs");

test("/glm:result <id> surfaces clean error when job file is corrupt (GAP-2)", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "glm-result-prop-data-"));
  const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), "glm-result-prop-repo-"));
  fs.mkdirSync(path.join(fakeRepo, ".git"), { recursive: true });
  const xdgConfig = fs.mkdtempSync(path.join(os.tmpdir(), "glm-result-prop-cfg-"));

  process.env.CLAUDE_PLUGIN_DATA = pluginData;
  const stateMod = await import(`../scripts/lib/state.mjs?t=${Date.now()}-${Math.random()}`);
  const jobId = "job-corrupt-test";
  // Seed a valid record in state.json so resolveResultJob finds the ID…
  stateMod.saveState(fakeRepo, {
    config: {},
    jobs: [
      {
        id: jobId,
        status: "completed",
        updatedAt: "2026-04-21T00:00:00Z",
        completedAt: "2026-04-21T00:00:01Z"
      }
    ]
  });
  // …then corrupt the matching job file so readJobFile throws.
  const jobFile = stateMod.writeJobFile(fakeRepo, jobId, { id: jobId, status: "completed" });
  fs.writeFileSync(jobFile, "{ not valid JSON at all", "utf8");

  const result = spawnSync(
    process.execPath,
    [companionScript, "result", jobId],
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

  // Throw should reach main().catch → exit 1 with a single stderr line.
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}`);
  assert.equal(result.stdout, "", "stdout should be empty on failed /glm:result");
  // Stderr must carry the file path AND the recovery hint — no
  // stacktrace, no bare "Expected property name".
  assert.match(result.stderr, /Could not parse .*\.json/);
  assert.match(result.stderr, /Delete or fix the file/);
  // Must not leak Node internals or a stacktrace.
  assert.doesNotMatch(result.stderr, /at .+:\d+:\d+/, "stderr contains a stacktrace line");
  assert.doesNotMatch(result.stderr, /SyntaxError: Expected property name/, "raw SyntaxError leaked without context");
});
