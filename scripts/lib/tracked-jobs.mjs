import fs from "node:fs";
import process from "node:process";

import { formatUserFacingError } from "./fs.mjs";
import { readJobFile, resolveJobFile, resolveJobLogFile, upsertJob, writeJobFile } from "./state.mjs";

export const SESSION_ID_ENV = "GLM_COMPANION_SESSION_ID";

export function nowIso() {
  return new Date().toISOString();
}

function normalizeProgressEvent(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      message: String(value.message ?? "").trim(),
      phase: typeof value.phase === "string" && value.phase.trim() ? value.phase.trim() : null,
      stderrMessage: value.stderrMessage == null ? null : String(value.stderrMessage).trim(),
      logTitle: typeof value.logTitle === "string" && value.logTitle.trim() ? value.logTitle.trim() : null,
      logBody: value.logBody == null ? null : String(value.logBody).trimEnd()
    };
  }

  return {
    message: String(value ?? "").trim(),
    phase: null,
    stderrMessage: String(value ?? "").trim(),
    logTitle: null,
    logBody: null
  };
}

export function appendLogLine(logFile, message) {
  const normalized = String(message ?? "").trim();
  if (!logFile || !normalized) {
    return;
  }
  fs.appendFileSync(logFile, `[${nowIso()}] ${normalized}\n`, { encoding: "utf8", mode: 0o600 });
}

export function appendLogBlock(logFile, title, body) {
  if (!logFile || !body) {
    return;
  }
  fs.appendFileSync(logFile, `\n[${nowIso()}] ${title}\n${String(body).trimEnd()}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

export function createJobLogFile(workspaceRoot, jobId, title) {
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  // 0600 — log may contain review prompts, diffs, and GLM output.
  fs.writeFileSync(logFile, "", { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(logFile, 0o600);
  } catch {
    /* non-fatal */
  }
  if (title) {
    appendLogLine(logFile, `Starting ${title}.`);
  }
  return logFile;
}

export function createJobRecord(base, options = {}) {
  const env = options.env ?? process.env;
  const sessionId = env[options.sessionIdEnv ?? SESSION_ID_ENV];
  return {
    ...base,
    createdAt: nowIso(),
    ...(sessionId ? { sessionId } : {})
  };
}

export function createJobProgressUpdater(workspaceRoot, jobId) {
  let lastPhase = null;

  return (event) => {
    const normalized = normalizeProgressEvent(event);
    const patch = { id: jobId };
    let changed = false;

    if (normalized.phase && normalized.phase !== lastPhase) {
      lastPhase = normalized.phase;
      patch.phase = normalized.phase;
      changed = true;
    }

    if (!changed) {
      return;
    }

    upsertJob(workspaceRoot, patch);

    const jobFile = resolveJobFile(workspaceRoot, jobId);
    if (!fs.existsSync(jobFile)) {
      return;
    }

    const storedJob = readJobFile(jobFile);
    writeJobFile(workspaceRoot, jobId, {
      ...storedJob,
      ...patch
    });
  };
}

export function createProgressReporter({ stderr = false, logFile = null, onEvent = null } = {}) {
  if (!stderr && !logFile && !onEvent) {
    return null;
  }

  // Best-effort: progress logging failures (read-only log dir, disk full,
  // fs quota, etc.) must NOT bubble up into the fetch lifecycle and get
  // mis-reported as NETWORK_ERROR. Each side effect is isolated.
  return (eventOrMessage) => {
    let event;
    try {
      event = normalizeProgressEvent(eventOrMessage);
    } catch {
      return;
    }
    const stderrMessage = event.stderrMessage ?? event.message;
    if (stderr && stderrMessage) {
      try {
        process.stderr.write(`[glm] ${stderrMessage}\n`);
      } catch {
        /* non-fatal */
      }
    }
    try {
      appendLogLine(logFile, event.message);
    } catch {
      /* non-fatal — log path unwritable */
    }
    try {
      appendLogBlock(logFile, event.logTitle, event.logBody);
    } catch {
      /* non-fatal */
    }
    if (typeof onEvent === "function") {
      try {
        onEvent(event);
      } catch {
        /* non-fatal */
      }
    }
  };
}

function readStoredJobOrNull(workspaceRoot, jobId) {
  const jobFile = resolveJobFile(workspaceRoot, jobId);
  if (!fs.existsSync(jobFile)) {
    return null;
  }
  return readJobFile(jobFile);
}

export function buildTrackedJobPasses(startedAt, completedAt, finalStatus) {
  const startedAtTs = Date.parse(startedAt ?? "");
  const completedAtTs = Date.parse(completedAt ?? "");
  const durationMs = Number.isFinite(startedAtTs) && Number.isFinite(completedAtTs)
    ? Math.max(0, completedAtTs - startedAtTs)
    : 0;
  return {
    model: { status: finalStatus === "completed" ? "completed" : "failed", durationMs },
    validation: null,
    rerank: null
  };
}

export async function runTrackedJob(job, runner, options = {}) {
  const startedAt = nowIso();
  const runningRecord = {
    ...job,
    status: "running",
    startedAt,
    phase: "starting",
    pid: process.pid,
    logFile: options.logFile ?? job.logFile ?? null
  };
  writeJobFile(job.workspaceRoot, job.id, runningRecord);
  upsertJob(job.workspaceRoot, runningRecord);

  try {
    const execution = await runner();
    const completionStatus = execution.exitStatus === 0 ? "completed" : "failed";
    const completedAt = nowIso();
    const passes = buildTrackedJobPasses(startedAt, completedAt, completionStatus);
    writeJobFile(job.workspaceRoot, job.id, {
      ...runningRecord,
      status: completionStatus,
      pid: null,
      phase: completionStatus === "completed" ? "done" : "failed",
      completedAt,
      result: execution.payload,
      rendered: execution.rendered,
      passes
    });
    upsertJob(job.workspaceRoot, {
      id: job.id,
      status: completionStatus,
      summary: execution.summary,
      phase: completionStatus === "completed" ? "done" : "failed",
      pid: null,
      completedAt
    });
    appendLogBlock(options.logFile ?? job.logFile ?? null, "Final output", execution.rendered);
    return execution;
  } catch (error) {
    const errorMessage = formatUserFacingError(error);
    // readStoredJobOrNull now throws (MED-2 fix) when the job file
    // exists but is corrupt. Don't let a secondary "Could not parse
    // <jobFile>" shadow the primary runner error — prefer the primary,
    // fall back to runningRecord, and surface the secondary as context.
    let existing = runningRecord;
    let persistWarning = null;
    try {
      existing = readStoredJobOrNull(job.workspaceRoot, job.id) ?? runningRecord;
    } catch (readError) {
      persistWarning = readError instanceof Error ? readError.message : String(readError);
    }
    const completedAt = nowIso();
    const passes = buildTrackedJobPasses(startedAt, completedAt, "failed");
    try {
      writeJobFile(job.workspaceRoot, job.id, {
        ...existing,
        status: "failed",
        phase: "failed",
        errorMessage: persistWarning ? `${errorMessage} (state write warning: ${persistWarning})` : errorMessage,
        pid: null,
        completedAt,
        logFile: options.logFile ?? job.logFile ?? existing.logFile ?? null,
        passes
      });
      upsertJob(job.workspaceRoot, {
        id: job.id,
        status: "failed",
        phase: "failed",
        pid: null,
        errorMessage,
        completedAt
      });
    } catch {
      // If persistence itself fails, we still want the original runner
      // error to reach main().catch — do not mask it with the write
      // failure. The user's next /glm:status call will see the job as
      // running-but-orphaned, which is a recoverable state.
    }
    throw error;
  }
}
