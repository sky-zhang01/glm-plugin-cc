import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  renderCancelReport,
  renderJobStatusReport,
  renderStatusReport,
  renderStoredJobResult
} from "../scripts/lib/render.mjs";

// Bundle F regression guard: the existing render tests only covered
// renderReviewResult + renderSetupReport paths. pushJobDetails (the
// function that walks per-job details for /glm:status) was never
// exercised by any test. That's how a ReferenceError sneaked in
// during Bundle E+: `formatResumeCommand` was deleted but a call site
// at render.mjs:142 was not — tests passed because the for-loop never
// entered pushJobDetails with a real job.
//
// These tests exercise the four renderers that walk job records so the
// same class of "delete function, miss caller" regression fails loudly
// at npm test.

const runningJob = {
  id: "job-running-1",
  kindLabel: "review",
  status: "running",
  phase: "querying GLM",
  elapsed: "12s",
  summary: "diffing working tree",
  logFile: "/tmp/glm-test/job-running-1.log"
};

const completedJob = {
  id: "job-done-1",
  kindLabel: "review",
  status: "completed",
  phase: "done",
  duration: "1m 4s",
  summary: "No material findings.",
  logFile: "/tmp/glm-test/job-done-1.log"
};

test("renderJobStatusReport walks a running job without ReferenceError", () => {
  const rendered = renderJobStatusReport(runningJob);
  // Must emit the job id, status, summary, phase. No need to pin exact
  // Markdown — what matters is it ran end-to-end and produced content.
  assert.match(rendered, /job-running-1/);
  assert.match(rendered, /running/);
  assert.match(rendered, /diffing working tree/);
  assert.match(rendered, /querying GLM/);
  // Must NOT emit stale codex-scaffold thread ref / resume lines.
  assert.doesNotMatch(rendered, /GLM thread ref/);
  assert.doesNotMatch(rendered, /Resume thread/);
});

test("renderJobStatusReport walks a completed job without ReferenceError", () => {
  const rendered = renderJobStatusReport(completedJob);
  assert.match(rendered, /job-done-1/);
  assert.match(rendered, /completed/);
  assert.match(rendered, /No material findings\./);
  assert.doesNotMatch(rendered, /GLM thread ref/);
  assert.doesNotMatch(rendered, /Resume thread/);
});

test("renderStatusReport with an active job exercises the table + details path", () => {
  // This is the exact path that would have crashed during Bundle E+
  // because pushJobDetails called the deleted formatResumeCommand.
  const report = {
    sessionRuntime: { label: "none" },
    config: { stopReviewGate: false },
    stateError: null,
    running: [runningJob],
    latestFinished: null,
    recent: [],
    needsReview: false
  };
  const rendered = renderStatusReport(report);
  // Must emit the active-jobs table header.
  assert.match(rendered, /Active jobs:/);
  // The table header row must NOT contain the old "GLM Session ID"
  // column, which was misleading (always empty for GLM).
  assert.doesNotMatch(rendered, /GLM Session ID/);
  // Must emit the job id in the table.
  assert.match(rendered, /job-running-1/);
  // Must still render details block without crashing.
  assert.match(rendered, /diffing working tree/);
  assert.doesNotMatch(rendered, /Resume thread/);
});

test("renderStatusReport with latestFinished + recent exercises all job-detail paths", () => {
  const report = {
    sessionRuntime: { label: "none" },
    config: { stopReviewGate: true },
    stateError: null,
    running: [],
    latestFinished: completedJob,
    recent: [
      { ...completedJob, id: "job-done-2", summary: "issues found in auth" }
    ],
    needsReview: true
  };
  const rendered = renderStatusReport(report);
  assert.match(rendered, /Latest finished:/);
  assert.match(rendered, /Recent jobs:/);
  assert.match(rendered, /job-done-1/);
  assert.match(rendered, /job-done-2/);
  assert.match(rendered, /issues found in auth/);
  assert.match(rendered, /stop-time review gate is enabled/);
  assert.doesNotMatch(rendered, /Resume thread/);
  assert.doesNotMatch(rendered, /GLM thread ref/);
});

test("renderStoredJobResult does not leak any thread / resume scaffolding", () => {
  // Even when a legacy job record carries a stale threadId, the
  // renderer must ignore it — pre-cleanup, this would have emitted
  // "GLM thread ref: …" in the output.
  const legacyJob = { ...completedJob, threadId: "legacy-uuid-from-codex-days" };
  const storedJob = {
    ...legacyJob,
    rendered: "# GLM Review\n\nNo findings.\n"
  };
  const rendered = renderStoredJobResult(legacyJob, storedJob);
  assert.match(rendered, /No findings\./);
  assert.doesNotMatch(rendered, /GLM thread ref/);
  assert.doesNotMatch(rendered, /Resume thread/);
  assert.doesNotMatch(rendered, /legacy-uuid-from-codex-days/);
});

test("renderStoredJobResult falls through to the skeleton block when nothing is stored", () => {
  const rendered = renderStoredJobResult(completedJob, null);
  assert.match(rendered, /# GLM Result|# /);
  assert.match(rendered, /Job: job-done-1/);
  assert.match(rendered, /Status: completed/);
  assert.doesNotMatch(rendered, /GLM thread ref/);
});

test("renderCancelReport renders without thread scaffolding", () => {
  const cancelledJob = { ...completedJob, status: "cancelled" };
  const rendered = renderCancelReport(cancelledJob);
  assert.match(rendered, /Cancelled/);
  assert.match(rendered, /job-done-1/);
  assert.doesNotMatch(rendered, /GLM thread ref/);
  assert.doesNotMatch(rendered, /Resume thread/);
  assert.doesNotMatch(rendered, /turn/i);
});
