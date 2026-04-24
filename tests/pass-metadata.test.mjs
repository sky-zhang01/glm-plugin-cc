/**
 * M0 pass-level metadata tests — v0.4.8
 *
 * Guards the `passes` field scaffolded onto stored job records by
 * runTrackedJob in M0. The field captures per-pass timing and status
 * so future M1 (validation) and M5 (rerank) passes can write their own
 * entries without changing the job schema.
 *
 * Backward-compat invariant: old stored jobs without `passes` must
 * replay via renderStoredJobResult without error.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// Dynamic import so each test can pick a fresh cache-busted module
async function importTrackedJobs(suffix = "") {
  return import(`${repoRoot}/scripts/lib/tracked-jobs.mjs?t=${Date.now()}-${suffix}-${Math.random()}`);
}

async function importState(suffix = "") {
  return import(`${repoRoot}/scripts/lib/state.mjs?t=${Date.now()}-${suffix}-${Math.random()}`);
}

async function importRender(suffix = "") {
  return import(`${repoRoot}/scripts/lib/render.mjs?t=${Date.now()}-${suffix}-${Math.random()}`);
}

function makeTempDirs() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glm-pass-meta-"));
  fs.mkdirSync(path.join(workspaceRoot, ".git"), { recursive: true });
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "glm-pass-meta-data-"));
  return { workspaceRoot, pluginData };
}

// ── Success path: passes.model populated after completion ───────────────────

describe("runTrackedJob — passes.model on success path", () => {
  it("new stored job has passes.model with status=completed after runTrackedJob success", async () => {
    const { workspaceRoot, pluginData } = makeTempDirs();
    process.env.CLAUDE_PLUGIN_DATA = pluginData;

    const { runTrackedJob, createJobRecord, nowIso } = await importTrackedJobs("success");
    const stateMod = await importState("success");

    const jobId = `job-meta-success-${Date.now()}`;
    const startedAt = nowIso();
    const job = createJobRecord({
      id: jobId,
      kind: "review",
      title: "Test review",
      status: "queued",
      workspaceRoot,
      startedAt
    });

    // Simulate a fast successful runner
    const execution = await runTrackedJob(job, async () => ({
      exitStatus: 0,
      payload: { result: "ok" },
      rendered: "# Result\n",
      summary: "completed fine"
    }));

    // Read the stored job file back
    const jobFile = stateMod.resolveJobFile(workspaceRoot, jobId);
    const stored = stateMod.readJobFile(jobFile);

    assert.ok(stored.passes !== undefined, "passes field must be present on stored job");
    assert.ok(stored.passes.model !== null, "passes.model must not be null after success");
    assert.equal(stored.passes.model.status, "completed");
    assert.ok(
      typeof stored.passes.model.durationMs === "number" && stored.passes.model.durationMs >= 0,
      `durationMs must be a non-negative number, got: ${stored.passes.model.durationMs}`
    );
  });

  it("passes.validation and passes.rerank are null (M1/M5 placeholders)", async () => {
    const { workspaceRoot, pluginData } = makeTempDirs();
    process.env.CLAUDE_PLUGIN_DATA = pluginData;

    const { runTrackedJob, createJobRecord, nowIso } = await importTrackedJobs("placeholders");
    const stateMod = await importState("placeholders");

    const jobId = `job-meta-placeholders-${Date.now()}`;
    const job = createJobRecord({
      id: jobId,
      kind: "review",
      title: "Test review",
      status: "queued",
      workspaceRoot,
      startedAt: nowIso()
    });

    await runTrackedJob(job, async () => ({
      exitStatus: 0,
      payload: {},
      rendered: "",
      summary: ""
    }));

    const jobFile = stateMod.resolveJobFile(workspaceRoot, jobId);
    const stored = stateMod.readJobFile(jobFile);

    assert.equal(stored.passes.validation, null, "passes.validation must be null (M1 placeholder)");
    assert.equal(stored.passes.rerank, null, "passes.rerank must be null (M5 placeholder)");
  });

  it("durationMs is a non-negative number", async () => {
    const { workspaceRoot, pluginData } = makeTempDirs();
    process.env.CLAUDE_PLUGIN_DATA = pluginData;

    const { runTrackedJob, createJobRecord, nowIso } = await importTrackedJobs("duration");
    const stateMod = await importState("duration");

    const jobId = `job-meta-duration-${Date.now()}`;
    const job = createJobRecord({
      id: jobId,
      kind: "review",
      title: "Test review",
      status: "queued",
      workspaceRoot,
      startedAt: nowIso()
    });

    await runTrackedJob(job, async () => ({
      exitStatus: 0,
      payload: {},
      rendered: "",
      summary: ""
    }));

    const jobFile = stateMod.resolveJobFile(workspaceRoot, jobId);
    const stored = stateMod.readJobFile(jobFile);

    assert.ok(stored.passes.model.durationMs >= 0, "durationMs must be >= 0");
    assert.equal(typeof stored.passes.model.durationMs, "number", "durationMs must be a number");
  });
});

// ── Failure path: passes.model on failure path ──────────────────────────────

describe("runTrackedJob — passes.model on failure path", () => {
  it("failed job has passes.model with status=failed", async () => {
    const { workspaceRoot, pluginData } = makeTempDirs();
    process.env.CLAUDE_PLUGIN_DATA = pluginData;

    const { runTrackedJob, createJobRecord, nowIso } = await importTrackedJobs("fail");
    const stateMod = await importState("fail");

    const jobId = `job-meta-fail-${Date.now()}`;
    const job = createJobRecord({
      id: jobId,
      kind: "review",
      title: "Test review",
      status: "queued",
      workspaceRoot,
      startedAt: nowIso()
    });

    // Non-zero exit triggers "failed" status
    await runTrackedJob(job, async () => ({
      exitStatus: 1,
      payload: { error: "parse failure" },
      rendered: "# Failure\n",
      summary: "failed"
    }));

    const jobFile = stateMod.resolveJobFile(workspaceRoot, jobId);
    const stored = stateMod.readJobFile(jobFile);

    assert.ok(stored.passes !== undefined, "passes field must be present on failed job");
    assert.ok(stored.passes.model !== null, "passes.model must not be null after failure");
    assert.equal(stored.passes.model.status, "failed");
    assert.ok(stored.passes.model.durationMs >= 0, "durationMs must be >= 0 on failure path");
  });

  it("thrown runner failure still persists passes.model with status=failed", async () => {
    const { workspaceRoot, pluginData } = makeTempDirs();
    process.env.CLAUDE_PLUGIN_DATA = pluginData;

    const { runTrackedJob, createJobRecord, nowIso } = await importTrackedJobs("throw");
    const stateMod = await importState("throw");

    const jobId = `job-meta-throw-${Date.now()}`;
    const job = createJobRecord({
      id: jobId,
      kind: "review",
      title: "Test review",
      status: "queued",
      workspaceRoot,
      startedAt: nowIso()
    });

    await assert.rejects(
      () => runTrackedJob(job, async () => {
        throw new Error("boom");
      }),
      /boom/
    );

    const jobFile = stateMod.resolveJobFile(workspaceRoot, jobId);
    const stored = stateMod.readJobFile(jobFile);

    assert.ok(stored.passes !== undefined, "passes field must be present on thrown failure");
    assert.equal(stored.passes.model.status, "failed");
    assert.ok(stored.passes.model.durationMs >= 0, "durationMs must be >= 0 on thrown failure");
    assert.equal(stored.passes.validation, null);
    assert.equal(stored.passes.rerank, null);
  });
});

// ── Backward compat: old stored job (no passes) replays without error ────────

describe("renderStoredJobResult — backward compat (no passes field)", () => {
  it("old-shape stored job without passes replays via renderStoredJobResult without error", async () => {
    const { renderStoredJobResult } = await importRender("compat");

    // Simulate a v0.4.7-era stored job that has no `passes` field
    const oldJob = {
      id: "job-old-style",
      status: "completed",
      title: "Old review",
      kind: "review",
      startedAt: "2026-04-20T10:00:00.000Z",
      completedAt: "2026-04-20T10:01:00.000Z",
      result: {
        result: { verdict: "approve", summary: "ok", findings: [], next_steps: [] },
        parseError: null
      },
      rendered: "# GLM Review\n\nTarget: working tree\nVerdict: approve\n"
    };

    const job = {
      id: oldJob.id,
      status: oldJob.status,
      title: oldJob.title
    };

    // Must not throw
    let output;
    assert.doesNotThrow(() => {
      output = renderStoredJobResult(job, oldJob);
    });
    assert.ok(typeof output === "string" && output.length > 0, "renderStoredJobResult must return non-empty string");
  });
});
