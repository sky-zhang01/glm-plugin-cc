import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 1;
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "glm-companion");
const STATE_FILE_NAME = "state.json";
const JOBS_DIR_NAME = "jobs";
const MAX_JOBS = 50;

function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    version: STATE_VERSION,
    config: {
      stopReviewGate: false
    },
    jobs: []
  };
}

export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  // Prefer the canonical (realpath) form so symlinked worktrees hash
  // to the same state dir as the underlying repo. If realpath fails
  // (missing FS support, broken link, etc.), fall back to the raw
  // workspaceRoot we already have — the catch body is intentionally
  // empty because the initial value is already that fallback.
  let canonicalWorkspaceRoot = workspaceRoot;
  try {
    canonicalWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  } catch {
    /* keep workspaceRoot fallback */
  }

  const slugSource = path.basename(workspaceRoot) || "workspace";
  const slug = slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonicalWorkspaceRoot).digest("hex").slice(0, 16);
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  const stateRoot = pluginDataDir ? path.join(pluginDataDir, "state") : FALLBACK_STATE_ROOT_DIR;
  return path.join(stateRoot, `${slug}-${hash}`);
}

export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), STATE_FILE_NAME);
}

export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), JOBS_DIR_NAME);
}

export function ensureStateDir(cwd) {
  const stateDir = resolveStateDir(cwd);
  const jobsDir = resolveJobsDir(cwd);
  // Create with 0700 — review prompts, diffs, and GLM outputs may contain
  // sensitive source code that should not be readable by other local users.
  fs.mkdirSync(jobsDir, { recursive: true, mode: 0o700 });
  // mkdirSync's mode is only applied when it creates the dir. If either
  // dir already existed with looser perms, tighten them defensively.
  for (const dir of [stateDir, jobsDir]) {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      /* non-fatal */
    }
  }
}

export function loadState(cwd) {
  const stateFile = resolveStateFile(cwd);
  if (!fs.existsSync(stateFile)) {
    return defaultState();
  }

  // Fail-CLOSED on corrupt state.json. Pre-fix, a JSON parse failure silently
  // returned defaultState(), so the next saveState would overwrite the
  // corrupt file with `{ jobs: [] }` — wiping the user's job history and
  // leaking every on-disk job/log file as an orphan (since the "orphan
  // cleanup" loop compared against the empty previousJobs). Mirrors the
  // v0.3.4 readConfigFile fail-closed fix: missing is OK (first-run),
  // corrupt is a visible error the user can recover from.
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      config: {
        ...defaultState().config,
        ...(parsed.config ?? {})
      },
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch (error) {
    throw new Error(
      `Could not parse ${stateFile}: ${error.message}. Delete or fix the file to recover. Any jobs listed only there will be lost.`
    );
  }
}

function pruneJobs(jobs) {
  return [...jobs]
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, MAX_JOBS);
}

function removeFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function saveState(cwd, state) {
  const previousJobs = loadState(cwd).jobs;
  ensureStateDir(cwd);
  const nextJobs = pruneJobs(state.jobs ?? []);
  const nextState = {
    version: STATE_VERSION,
    config: {
      ...defaultState().config,
      ...(state.config ?? {})
    },
    jobs: nextJobs
  };

  const retainedIds = new Set(nextJobs.map((job) => job.id));
  for (const job of previousJobs) {
    if (retainedIds.has(job.id)) {
      continue;
    }
    removeJobFile(resolveJobFile(cwd, job.id));
    removeFileIfExists(job.logFile);
  }

  const stateFile = resolveStateFile(cwd);
  fs.writeFileSync(stateFile, `${JSON.stringify(nextState, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  // mode in writeFileSync only applies on create. Defensively chmod on
  // existing files so older loose-perm state files get tightened.
  try {
    fs.chmodSync(stateFile, 0o600);
  } catch {
    /* non-fatal */
  }
  return nextState;
}

export function updateState(cwd, mutate) {
  const state = loadState(cwd);
  mutate(state);
  return saveState(cwd, state);
}

export function generateJobId(prefix = "job") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function upsertJob(cwd, jobPatch) {
  return updateState(cwd, (state) => {
    const timestamp = nowIso();
    const existingIndex = state.jobs.findIndex((job) => job.id === jobPatch.id);
    if (existingIndex === -1) {
      state.jobs.unshift({
        createdAt: timestamp,
        updatedAt: timestamp,
        ...jobPatch
      });
      return;
    }
    state.jobs[existingIndex] = {
      ...state.jobs[existingIndex],
      ...jobPatch,
      updatedAt: timestamp
    };
  });
}

export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

export function setConfig(cwd, key, value) {
  return updateState(cwd, (state) => {
    state.config = {
      ...state.config,
      [key]: value
    };
  });
}

export function getConfig(cwd) {
  return loadState(cwd).config;
}

export function writeJobFile(cwd, jobId, payload) {
  ensureStateDir(cwd);
  const jobFile = resolveJobFile(cwd, jobId);
  fs.writeFileSync(jobFile, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(jobFile, 0o600);
  } catch {
    /* non-fatal */
  }
  return jobFile;
}

export function readJobFile(jobFile) {
  // Mirror loadState / readConfigFile fail-closed pattern: surface the file
  // path and a recovery hint. Without this, a corrupt job file throws a
  // bare `SyntaxError: Expected property name ...` with no clue which file
  // to delete when the user hits `/glm:result <id>`.
  try {
    return JSON.parse(fs.readFileSync(jobFile, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not parse ${jobFile}: ${error.message}. Delete or fix the file to recover; its result will be lost.`
    );
  }
}

function removeJobFile(jobFile) {
  if (fs.existsSync(jobFile)) {
    fs.unlinkSync(jobFile);
  }
}

const JOB_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function assertSafeJobId(jobId) {
  const normalized = String(jobId ?? "").trim();
  if (!normalized || !JOB_ID_PATTERN.test(normalized) || normalized.length > 128) {
    throw new Error(
      `Invalid job id: "${jobId}". Expected alphanumeric with dashes/underscores (1-128 chars).`
    );
  }
  return normalized;
}

function resolveSafeJobPath(cwd, jobId, extension) {
  const safeId = assertSafeJobId(jobId);
  const jobsDir = resolveJobsDir(cwd);
  const candidate = path.resolve(jobsDir, `${safeId}${extension}`);
  const jobsDirResolved = path.resolve(jobsDir);
  if (!candidate.startsWith(`${jobsDirResolved}${path.sep}`)) {
    throw new Error(`Resolved job path escaped jobs directory: ${candidate}`);
  }
  return candidate;
}

export function resolveJobLogFile(cwd, jobId) {
  ensureStateDir(cwd);
  return resolveSafeJobPath(cwd, jobId, ".log");
}

export function resolveJobFile(cwd, jobId) {
  ensureStateDir(cwd);
  return resolveSafeJobPath(cwd, jobId, ".json");
}
