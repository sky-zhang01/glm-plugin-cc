#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import {
  DEFAULT_CONTINUE_PROMPT,
  buildPersistentTaskThreadName,
  getGlmAuthStatus,
  getGlmAvailability,
  getSessionRuntimeStatus,
  readOutputSchema,
  runGlmReview,
  runGlmTask
} from "./lib/glm-client.mjs";
import { collectReviewContext, ensureGitRepository, resolveReviewTarget } from "./lib/git.mjs";
import {
  applyPreset,
  listPresets,
  persistApiKey,
  resolveEffectiveConfig
} from "./lib/preset-config.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import {
  generateJobId,
  getConfig,
  listJobs,
  setConfig,
  upsertJob,
  writeJobFile
} from "./lib/state.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  readStoredJob,
  resolveCancelableJob,
  resolveResultJob
} from "./lib/job-control.mjs";
import {
  appendLogLine,
  createJobLogFile,
  createJobRecord,
  createProgressReporter,
  nowIso,
  SESSION_ID_ENV
} from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import {
  renderCancelReport,
  renderJobStatusReport,
  renderReviewResult,
  renderSetupReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult
} from "./lib/render.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEW_SCHEMA_PATH = path.join(ROOT_DIR, "schemas", "review-output.schema.json");

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/glm-companion.mjs setup [--preset ...] [--api-key <key>] [--ping] [--enable-review-gate|--disable-review-gate] [--json]",
      "  node scripts/glm-companion.mjs review [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--thinking on|off] [--json] [focus text]",
      "  node scripts/glm-companion.mjs adversarial-review [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--thinking on|off] [--json] [focus text]",
      "  node scripts/glm-companion.mjs task [--system <text>] [--model <model>] [--thinking on|off] [--json] [prompt]",
      "  node scripts/glm-companion.mjs rescue [--system <text>] [--model <model>] [--thinking on|off] [--json] [prompt]",
      "  node scripts/glm-companion.mjs status [job-id] [--all] [--json]",
      "  node scripts/glm-companion.mjs result [job-id] [--json]",
      "  node scripts/glm-companion.mjs cancel [job-id] [--json]"
    ].join("\n")
  );
}

function parseThinkingFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "on" || normalized === "true" || normalized === "1" || normalized === "enabled") {
    return true;
  }
  if (normalized === "off" || normalized === "false" || normalized === "0" || normalized === "disabled") {
    return false;
  }
  throw new Error(`--thinking expects on|off (got: ${value}).`);
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(String(value ?? ""));
  }
}

function outputCommandResult(payload, rendered, asJson) {
  outputResult(asJson ? payload : rendered, asJson);
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) {
      return [];
    }
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  // `--cwd <path>` (alias `-C`) is valid on every subcommand so the
  // companion can be invoked against a repo different from the caller's
  // process cwd (e.g. scripted multi-worktree runs). Previously, only
  // the alias was registered — the actual value option was not, so
  // `--cwd /path` fell through to positionals and was silently ignored.
  const valueOptions = Array.from(
    new Set(["cwd", ...(config.valueOptions ?? [])])
  );
  return parseArgs(normalizeArgv(argv), {
    ...config,
    valueOptions,
    aliasMap: { C: "cwd", ...(config.aliasMap ?? {}) }
  });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function resolveCommandWorkspace(options = {}) {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}

function currentSessionId() {
  return process.env[SESSION_ID_ENV] || null;
}

function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 3)}...`;
}

function firstMeaningfulLine(text, fallback) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? fallback;
}

function buildTargetLabel(target, focusText) {
  // resolveReviewTarget returns { mode, label, baseRef, explicit } — no
  // `base` / `scope`. The previous impl referenced target.base /
  // target.scope which were always undefined, so the label silently fell
  // through to "working tree" regardless of the actual review target.
  const focus = focusText ? `focus=${shorten(focusText, 60)}` : null;
  return [target?.label, focus].filter(Boolean).join(" · ") || "working tree";
}

async function buildSetupReport(cwd, actionsTaken = [], pingRequested = false) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const nodeDetail = `${process.version} (global fetch ${typeof fetch === "function" ? "present" : "missing"})`;

  let effectiveConfig = null;
  let configError = null;
  try {
    effectiveConfig = resolveEffectiveConfig();
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }

  const glmAvailability = getGlmAvailability(cwd);
  const authStatus = pingRequested
    ? await getGlmAuthStatus(cwd)
    : { ok: null, detail: "ping skipped (pass --ping to probe)" };

  // getConfig() reads state.json via loadState(); loadState now throws on
  // corrupt (H-A fix). If /glm:setup crashes here, the user loses the
  // recovery report and has no in-app path to fix state.json. Catch and
  // surface as stateError so the rest of the report still renders.
  let repoConfig = null;
  let stateError = null;
  try {
    repoConfig = getConfig(workspaceRoot);
  } catch (error) {
    stateError = error instanceof Error ? error.message : String(error);
  }

  const hasApiKey = Boolean(effectiveConfig?.has_api_key);

  const nextSteps = [];
  if (configError) {
    nextSteps.push(`Fix config file error: ${configError}`);
  }
  if (stateError) {
    nextSteps.push(`Fix state file error: ${stateError}`);
  }
  if (!effectiveConfig?.preset_id) {
    nextSteps.push("Pick a preset: /glm:setup --preset coding-plan | pay-as-you-go | custom --base-url <url>");
  }
  if (!hasApiKey) {
    nextSteps.push("Set API key: /glm:setup --api-key <your-key> (or paste it in the interactive prompt)");
  }
  if (glmAvailability.available && pingRequested && authStatus.ok === false) {
    nextSteps.push(`Auth probe failed: ${authStatus.detail}`);
  }

  return {
    ready: Boolean(effectiveConfig?.preset_id) &&
      hasApiKey &&
      glmAvailability.available &&
      authStatus.ok !== false &&
      !stateError,
    node: { detail: nodeDetail },
    npm: { detail: "not required for glm-plugin-cc (zero runtime deps)" },
    glm: { detail: glmAvailability.detail },
    auth: { detail: authStatus.detail },
    sessionRuntime: getSessionRuntimeStatus(process.env, cwd),
    reviewGateEnabled: Boolean(repoConfig?.stopReviewGate),
    state: { error: stateError },
    actionsTaken,
    nextSteps,
    config: {
      source: effectiveConfig?.source ?? "error",
      preset_id: effectiveConfig?.preset_id ?? null,
      preset_display: effectiveConfig?.preset_display ?? null,
      base_url: effectiveConfig?.base_url ?? null,
      default_model: effectiveConfig?.default_model ?? null,
      // Boolean only — never emit the raw key in any output.
      has_api_key: hasApiKey,
      updated_at_utc: effectiveConfig?.updated_at_utc ?? null,
      error: configError
    },
    presets: listPresets()
  };
}

async function runSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["preset", "base-url", "default-model", "api-key"],
    booleanOptions: ["json", "ping", "enable-review-gate", "disable-review-gate"]
  });
  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);

  const actionsTaken = [];

  if (options.preset || options["base-url"] || options["default-model"]) {
    if (!options.preset) {
      throw new Error("--base-url / --default-model require --preset (coding-plan | pay-as-you-go | custom).");
    }
    const result = applyPreset({
      preset_id: options.preset,
      base_url: options["base-url"],
      default_model: options["default-model"]
    });
    actionsTaken.push(
      `wrote ${result.path}: preset=${result.config.preset_id}, base_url=${result.config.base_url ?? "(null)"}, default_model=${result.config.default_model ?? "(null)"}`
    );
  }

  if (options["api-key"] != null && options["api-key"] !== "") {
    const result = persistApiKey(options["api-key"]);
    // NEVER log the raw key. Actions-taken line reports persistence but
    // not the value.
    actionsTaken.push(`stored api_key to ${result.path} (0600)`);
  }

  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
    actionsTaken.push("enabled stopReviewGate flag (harness owns the actual Stop hook wiring)");
  }
  if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
    actionsTaken.push("disabled stopReviewGate flag");
  }

  const report = await buildSetupReport(cwd, actionsTaken, Boolean(options.ping));
  outputCommandResult({ command: "setup", report }, renderSetupReport(report), Boolean(options.json));
}

function buildReviewSystemPrompt({ adversarial, schema }) {
  // Schema is shipped with the plugin and always required here. The
  // previous code path wrapped the read in a safeRead wrapper and fell
  // back to a hard-coded verdict enum that did NOT match the shipped
  // schema's `approve` / `needs-attention` — silently shipping a drifted
  // vocabulary to GLM whenever the shipped schema file was
  // missing/corrupt. Now fail-closed: let the readOutputSchema error
  // propagate so the user gets a clear "reinstall the plugin" path
  // instead of quietly degraded reviews. See tests/template-contract.mjs
  // for the structural regression guard.
  const schemaNote = `Return ONE JSON object. Do NOT wrap in markdown fences. Schema:\n${JSON.stringify(schema, null, 2)}`;
  const modeNote = adversarial
    ? "Act as an adversarial reviewer. Prioritize defects, missing tests, silent failures, and reviewer blind spots over approval."
    : "Act as a balanced reviewer. Report real issues; do not manufacture any.";
  return [
    modeNote,
    "Do not invent file paths, functions, or APIs not shown in the diff or context.",
    schemaNote
  ].join("\n\n");
}

async function runReview(argv, { adversarial }) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "thinking"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const focusText = positionals.join(" ").trim();
  // Global default ON — mirrors codex CLI's single model_reasoning_effort
  // = "medium" default on gpt-5.4 (no per-command split).
  const thinking = parseThinkingFlag(options.thinking, true);

  ensureGitRepository(cwd);
  const target = resolveReviewTarget(cwd, { base: options.base, scope: options.scope });
  const reviewContext = collectReviewContext(cwd, target);

  // Dispatch to the mode-specific template. Pre-fix, runReview always
  // loaded `adversarial-review.md` regardless of mode, and passed keys
  // (FOCUS_INSTRUCTION / REVIEW_DIFF / REVIEW_BASE / REVIEW_SCOPE /
  // ADVERSARIAL_MODE) that the template did NOT declare — so every
  // `{{TARGET_LABEL}}`, `{{USER_FOCUS}}`, `{{REVIEW_COLLECTION_GUIDANCE}}`,
  // and `{{REVIEW_INPUT}}` silently interpolated to "" (interpolateTemplate
  // replaces unmatched variables with empty string). Both modes shipped
  // empty repository context to GLM.
  const templateName = adversarial ? "adversarial-review" : "review";
  const promptTemplate = loadPromptTemplate(ROOT_DIR, templateName);
  const interpolated = interpolateTemplate(promptTemplate, {
    REVIEW_KIND: adversarial ? "Adversarial Review" : "Balanced Review",
    TARGET_LABEL: target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_COLLECTION_GUIDANCE: reviewContext.collectionGuidance,
    REVIEW_INPUT: reviewContext.content
  });

  const schema = readOutputSchema(REVIEW_SCHEMA_PATH);
  const systemPrompt = buildReviewSystemPrompt({ adversarial, schema });

  const jobId = generateJobId();
  const logPath = createJobLogFile(workspaceRoot, jobId);
  const jobRecord = createJobRecord({
    id: jobId,
    kind: adversarial ? "adversarial-review" : "review",
    title: adversarial ? "GLM adversarial review" : "GLM review",
    status: "running",
    sessionId: currentSessionId(),
    startedAt: nowIso(),
    workspaceRoot,
    logFile: logPath
  });
  upsertJob(workspaceRoot, jobRecord);

  const reporter = createProgressReporter({ logFile: logPath });
  const result = await runGlmReview(cwd, {
    prompt: interpolated,
    systemPrompt,
    model: options.model,
    thinking,
    expectJson: true,
    onProgress: reporter
  });

  const completedAt = nowIso();
  const failed = Boolean(result.failureMessage) || Boolean(result.parseError);
  const finalStatus = failed ? "failed" : "completed";
  const targetLabel = buildTargetLabel(target, focusText);
  const meta = {
    reviewLabel: adversarial ? "Adversarial Review" : "Review",
    targetLabel,
    targetMode: target.mode,
    baseRef: target.baseRef ?? null,
    focusText
  };
  const rendered = renderReviewResult(result, meta);

  writeJobFile(workspaceRoot, jobId, {
    ...jobRecord,
    status: finalStatus,
    completedAt,
    result,
    rendered,
    meta
  });
  upsertJob(workspaceRoot, {
    ...jobRecord,
    status: finalStatus,
    completedAt,
    summary: firstMeaningfulLine(result.rawOutput, result.failureMessage || "")
  });

  outputCommandResult(
    { command: meta.reviewLabel.toLowerCase().replace(/\s+/g, "-"), jobId, result, rendered, meta },
    rendered,
    Boolean(options.json)
  );
}

async function runTask(argv, { rescueMode }) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["system", "model", "thinking"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  // Global default ON — mirrors codex CLI's single model_reasoning_effort
  // = "medium" default on gpt-5.4 (no per-command split). User can always
  // pass --thinking off for light/quick calls.
  const thinking = parseThinkingFlag(options.thinking, true);

  const prompt = positionals.join(" ").trim() || DEFAULT_CONTINUE_PROMPT;
  const systemPrompt = options.system ||
    (rescueMode
      ? "You are a senior engineer helping rescue a blocked implementation. Be concrete; show commands or code diffs; call out risky assumptions."
      : null);

  const jobId = generateJobId();
  const logPath = createJobLogFile(workspaceRoot, jobId);
  const jobRecord = createJobRecord({
    id: jobId,
    kind: rescueMode ? "rescue" : "task",
    title: rescueMode ? "GLM rescue" : buildPersistentTaskThreadName(prompt),
    status: "running",
    sessionId: currentSessionId(),
    startedAt: nowIso(),
    workspaceRoot,
    logFile: logPath
  });
  upsertJob(workspaceRoot, jobRecord);

  const reporter = createProgressReporter({ logFile: logPath });
  const result = await runGlmTask(cwd, {
    prompt,
    systemPrompt,
    model: options.model,
    thinking,
    onProgress: reporter
  });

  const completedAt = nowIso();
  const failed = Boolean(result.failureMessage);
  const finalStatus = failed ? "failed" : "completed";
  const meta = {
    taskLabel: rescueMode ? "Rescue" : "Task",
    prompt: shorten(prompt),
    model: options.model || null
  };
  const rendered = renderTaskResult(result, meta);

  writeJobFile(workspaceRoot, jobId, {
    ...jobRecord,
    status: finalStatus,
    completedAt,
    result,
    rendered,
    meta
  });
  upsertJob(workspaceRoot, {
    ...jobRecord,
    status: finalStatus,
    completedAt,
    summary: firstMeaningfulLine(result.rawOutput, result.failureMessage || "")
  });

  outputCommandResult(
    { command: rescueMode ? "rescue" : "task", jobId, result, rendered, meta },
    rendered,
    Boolean(options.json)
  );
}

async function runStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, { booleanOptions: ["json", "all"] });
  const cwd = resolveCommandCwd(options);
  const [reference] = positionals;
  const session_id = currentSessionId();

  if (reference) {
    const snapshot = buildSingleJobSnapshot(cwd, reference);
    outputCommandResult(
      { command: "status", snapshot },
      renderJobStatusReport(snapshot.job),
      Boolean(options.json)
    );
    return;
  }

  const snapshot = buildStatusSnapshot(cwd, {
    all: Boolean(options.all),
    session_id,
    env: process.env
  });
  outputCommandResult(
    { command: "status", snapshot },
    renderStatusReport(snapshot),
    Boolean(options.json)
  );
}

async function runResult(argv) {
  const { options, positionals } = parseCommandInput(argv, { booleanOptions: ["json"] });
  const cwd = resolveCommandCwd(options);
  const [reference] = positionals;
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);
  const rendered = renderStoredJobResult(job, storedJob);
  outputCommandResult({ command: "result", job: storedJob ?? job }, rendered, Boolean(options.json));
}

async function runCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, { booleanOptions: ["json"] });
  const cwd = resolveCommandCwd(options);
  const [reference] = positionals;
  const session_id = currentSessionId();

  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference, { session_id });
  const cancelledJob = {
    ...job,
    status: "cancelled",
    completedAt: nowIso(),
    summary: job.summary || "cancelled by user (GLM is stateless; no server-side interrupt sent)"
  };
  upsertJob(workspaceRoot, cancelledJob);
  outputCommandResult(
    { command: "cancel", job: cancelledJob },
    renderCancelReport(cancelledJob),
    Boolean(options.json)
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    printUsage();
    return;
  }
  switch (command) {
    case "setup":
      return runSetup(rest);
    case "review":
      return runReview(rest, { adversarial: false });
    case "adversarial-review":
      return runReview(rest, { adversarial: true });
    case "task":
      return runTask(rest, { rescueMode: false });
    case "rescue":
      return runTask(rest, { rescueMode: true });
    case "status":
      return runStatus(rest);
    case "result":
      return runResult(rest);
    case "cancel":
      return runCancel(rest);
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exitCode = 2;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
