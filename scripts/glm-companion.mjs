#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { formatUserFacingError } from "./lib/fs.mjs";
import {
  DEFAULT_CONTINUE_PROMPT,
  buildTaskTitle,
  getGlmAuthStatus,
  getGlmAvailability,
  getSessionRuntimeStatus,
  readOutputSchema,
  runGlmReview,
  runGlmTask
} from "./lib/glm-client.mjs";
import {
  collectReviewContext,
  ensureGitRepository,
  resolveHeadSha,
  resolveRefSha,
  resolveReviewTarget,
  ReviewContextDiffTooLargeError
} from "./lib/git.mjs";
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
  sanitizeReviewResultForStorageM0,
  renderTaskResult
} from "./lib/render.mjs";
import {
  buildReviewValidationContext,
  validateStructuralReviewResult
} from "./lib/validators/review-structural.mjs";
import { runRepoChecks } from "./lib/repo-checks.mjs";
import {
  attachRerankMetadata,
  buildReflectionPrompt,
  buildRerankPassMetadata
} from "./lib/review-rerank.mjs";
import {
  buildCompletedPacket,
  buildContextFailedPacket,
  CONTEXT_FAILURE_CODES,
  CONTEXT_INPUT_MODES,
  sha256Hex
} from "./lib/review-packet.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEW_SCHEMA_PATH = path.join(ROOT_DIR, "schemas", "review-output.schema.json");

// Read once at module load. Used as `provenance.plugin_version` in M8A
// review packets so eval/host-skill consumers can attribute a stored review
// to a specific plugin version without trusting the model's self-report.
const PLUGIN_VERSION = (() => {
  try {
    const raw = readFileSync(path.join(ROOT_DIR, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
    return "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/glm-companion.mjs setup [--preset ...] [--api-key <key>] [--ping] [--enable-review-gate|--disable-review-gate] [--json]",
      "  node scripts/glm-companion.mjs review [--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--max-diff-files <N>] [--max-diff-bytes <BYTES>] [--model <model>] [--thinking on|off] [--temperature <0-2>] [--top-p <0-1>] [--seed <int>] [--reflect] [--reflect-model <model>] [--json]",
      "  node scripts/glm-companion.mjs adversarial-review [--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--max-diff-files <N>] [--max-diff-bytes <BYTES>] [--model <model>] [--thinking on|off] [--temperature <0-2>] [--top-p <0-1>] [--seed <int>] [--reflect] [--reflect-model <model>] [--json] [focus text]",
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

/**
 * Parse a CLI-supplied sampling parameter as a finite float, else
 * return undefined. glm-client's assignOptionalSamplingParam also
 * validates range, so this helper is intentionally lenient — any
 * parse failure degrades to "use server default" rather than
 * throwing. Throwing would force the user to retry an entire review
 * command over a typo, which is worse UX than silently ignoring the
 * malformed flag.
 */
function parseFloatOrUndefined(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseIntOrUndefined(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) ? n : undefined;
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

export function buildTargetLabel(target, focusText) {
  // resolveReviewTarget returns { mode, label, baseRef, explicit } — no
  // `base` / `scope`. The previous impl referenced target.base /
  // target.scope which were always undefined, so the label silently fell
  // through to "working tree" regardless of the actual review target.
  const focus = focusText ? `focus=${shorten(focusText, 60)}` : null;
  return [target?.label, focus].filter(Boolean).join(" · ") || "working tree";
}

/**
 * Compute M0 pass-level metadata for a completed review run.
 *
 * Shape matches runTrackedJob's tracked-jobs.mjs scaffolding so renderers
 * and future M1/M5 consumers see a single stable contract regardless of
 * which path wrote the stored job. See tests/run-review-pass-metadata
 * for the structural guard that keeps this helper wired into runReview.
 */
export function buildPassesField(startedAt, completedAt, finalStatus) {
  const startedAtTs = Date.parse(startedAt ?? "");
  const completedAtTs = Date.parse(completedAt ?? "");
  const durationMs = Number.isFinite(startedAtTs) && Number.isFinite(completedAtTs)
    ? Math.max(0, completedAtTs - startedAtTs)
    : 0;
  return {
    model: {
      status: finalStatus === "completed" ? "completed" : "failed",
      durationMs
    },
    validation: null, // M1 will populate
    rerank: null // M5 will populate
  };
}

async function buildSetupReport(cwd, actionsTaken = [], pingRequested = false) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const nodeDetail = `${process.version} (global fetch ${typeof fetch === "function" ? "present" : "missing"})`;

  let effectiveConfig = null;
  let configError = null;
  try {
    effectiveConfig = resolveEffectiveConfig();
  } catch (error) {
    configError = formatUserFacingError(error);
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
    stateError = formatUserFacingError(error);
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
    valueOptions: [
      "base", "scope", "model", "thinking",
      // Sampling-param knobs (v0.4.7). Values forwarded to glm-client as
      // options.temperature / options.topP / options.seed etc. Unset =
      // server-side default (current v0.4.6 behavior preserved). Ranges
      // are validated in glm-client's assignOptionalSamplingParam —
      // out-of-range values are silently dropped, not rejected.
      "temperature", "top-p", "seed", "frequency-penalty", "presence-penalty", "reflect-model",
      // PA1 (v0.4.8): inline-diff budget overrides. Defaults are 50 files /
      // 384 KB. Pass higher values to allow larger reviews; pass lower values
      // to force fail-closed earlier. See git.mjs::collectReviewContext.
      "max-diff-files", "max-diff-bytes"
    ],
    // `wait` / `background` are no-ops here — declared so parseArgs consumes
    // them instead of leaking into positionals as focus text. Real detach
    // lives in Claude Code's `Bash(run_in_background: true)`. See
    // commands/review.md.
    booleanOptions: ["json", "wait", "background", "reflect"]
  });
  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const focusText = positionals.join(" ").trim();
  // C4 (M0): /glm:review does not accept focus text — reject early with a
  // clear usage error. Message leads with the actionable fix (remove the
  // text) before offering adversarial-review as an alternative, so users
  // who only wanted a balanced review are not pushed toward adversarial.
  // Runs before ensureGitRepository so the error is not shadowed by git checks.
  if (!adversarial && focusText) {
    process.stderr.write(
      "/glm:review does not accept focus text — remove the trailing text to run a balanced review. If you genuinely need custom framing, use /glm:adversarial-review instead.\n"
    );
    process.exit(1);
  }
  // Global default ON — mirrors codex CLI's single model_reasoning_effort
  // = "medium" default on gpt-5.4 (no per-command split).
  const thinking = parseThinkingFlag(options.thinking, true);

  ensureGitRepository(cwd);
  const target = resolveReviewTarget(cwd, { base: options.base, scope: options.scope });
  const maxDiffFilesOverride = parseIntOrUndefined(options["max-diff-files"]);
  const maxDiffBytesOverride = parseIntOrUndefined(options["max-diff-bytes"]);
  const reviewMode = adversarial ? "adversarial-review" : "review";
  const reviewLabel = adversarial ? "Adversarial Review" : "Review";
  const reviewTitle = adversarial ? "GLM adversarial review" : "GLM review";

  // M8A: create the job record BEFORE context collection so a DIFF_TOO_LARGE
  // failure can persist a structured packet alongside the failed-job entry,
  // instead of returning a packetless command error with `jobId: null`.
  const jobId = generateJobId();
  const logPath = createJobLogFile(workspaceRoot, jobId);
  const jobStartedAt = nowIso();
  const jobRecord = createJobRecord({
    id: jobId,
    kind: reviewMode,
    title: reviewTitle,
    status: "running",
    sessionId: currentSessionId(),
    startedAt: jobStartedAt,
    workspaceRoot,
    logFile: logPath
  });
  upsertJob(workspaceRoot, jobRecord);

  let reviewContext;
  try {
    reviewContext = collectReviewContext(cwd, target, {
      maxInlineFiles: maxDiffFilesOverride,
      maxInlineDiffBytes: maxDiffBytesOverride
    });
  } catch (err) {
    if (err instanceof ReviewContextDiffTooLargeError) {
      const completedAt = nowIso();
      const failureResult = {
        rawOutput: "",
        failureMessage: err.message,
        errorCode: err.kind,
        retry: "never",
        diagnostics: {
          fileCount: err.fileCount,
          diffBytes: err.diffBytes,
          maxInlineFiles: err.maxInlineFiles,
          maxInlineDiffBytes: err.maxInlineDiffBytes
        }
      };
      const meta = {
        reviewLabel,
        reviewMode,
        targetLabel: buildTargetLabel(target, focusText),
        targetMode: target.mode,
        baseRef: target.baseRef ?? null,
        focusText
      };
      const passes = { model: null, validation: null, rerank: null };
      const baseSha =
        target.mode === "branch" && target.baseRef
          ? resolveRefSha(cwd, target.baseRef)
          : null;
      const packet = buildContextFailedPacket({
        failure: { error_code: err.kind, reason: err.message },
        contextFailure: {
          error_code: err.kind,
          file_count: err.fileCount,
          diff_bytes: err.diffBytes,
          max_diff_files: err.maxInlineFiles,
          max_diff_bytes: err.maxInlineDiffBytes
        },
        provenance: {
          plugin_version: PLUGIN_VERSION,
          review_mode: reviewMode,
          job_id: jobId,
          generated_at: completedAt,
          base_ref: baseSha ?? (target.baseRef ?? null),
          head_ref: resolveHeadSha(cwd),
          model_requested: options.model ?? null,
          model_responded: null,
          prompt_template_name: reviewMode,
          prompt_template_sha256: null,
          system_prompt_sha256: null,
          final_prompt_sha256: null
        },
        passes
      });
      writeJobFile(workspaceRoot, jobId, {
        ...jobRecord,
        status: "failed",
        completedAt,
        result: failureResult,
        rendered: err.message,
        meta,
        passes,
        packet
      });
      upsertJob(workspaceRoot, {
        ...jobRecord,
        status: "failed",
        completedAt,
        summary: firstMeaningfulLine(err.message, "review failed: DIFF_TOO_LARGE")
      });
      outputCommandResult(
        {
          command: reviewMode,
          jobId,
          result: failureResult,
          rendered: err.message,
          meta,
          passes,
          packet
        },
        err.message,
        Boolean(options.json)
      );
      process.exit(1);
    }
    // M8A reordered job creation to run *before* collectReviewContext so
    // the DIFF_TOO_LARGE branch above can persist a packet. That made the
    // job record exist even if a non-DIFF_TOO_LARGE error escapes from
    // context collection (e.g. filesystem race, git binary suddenly
    // unavailable). Without the cleanup below the job would stay
    // `status: "running"` forever in state.json. We mark it failed and
    // then re-throw so the original error still surfaces to the caller.
    // No packet is written: this failure mode is not a defined M8A
    // status and inventing one would launder noise into eval data.
    const completedAt = nowIso();
    const errorMessage = err?.message ? String(err.message) : String(err);
    const errorCode = err?.code || err?.errorCode || "PRECONTEXT_ERROR";
    const failureResult = {
      rawOutput: "",
      failureMessage: errorMessage,
      errorCode,
      retry: "never"
    };
    const meta = {
      reviewLabel,
      reviewMode,
      targetLabel: buildTargetLabel(target, focusText),
      targetMode: target.mode,
      baseRef: target.baseRef ?? null,
      focusText
    };
    writeJobFile(workspaceRoot, jobId, {
      ...jobRecord,
      status: "failed",
      completedAt,
      result: failureResult,
      rendered: errorMessage,
      meta,
      passes: { model: null, validation: null, rerank: null }
    });
    upsertJob(workspaceRoot, {
      ...jobRecord,
      status: "failed",
      completedAt,
      summary: firstMeaningfulLine(errorMessage, "review failed before context collection")
    });
    throw err;
  }

  // Dispatch to the mode-specific template. Pre-fix, runReview always
  // loaded `adversarial-review.md` regardless of mode, and passed keys
  // (FOCUS_INSTRUCTION / REVIEW_DIFF / REVIEW_BASE / REVIEW_SCOPE /
  // ADVERSARIAL_MODE) that the template did NOT declare — so every
  // `{{TARGET_LABEL}}`, `{{USER_FOCUS}}`, `{{REVIEW_COLLECTION_GUIDANCE}}`,
  // and `{{REVIEW_INPUT}}` silently interpolated to "" (interpolateTemplate
  // replaces unmatched variables with empty string). Both modes shipped
  // empty repository context to GLM.
  const templateName = reviewMode;
  const promptTemplate = loadPromptTemplate(ROOT_DIR, templateName);
  const promptTemplateSha = sha256Hex(promptTemplate);
  const interpolated = interpolateTemplate(promptTemplate, {
    REVIEW_KIND: adversarial ? "Adversarial Review" : "Balanced Review",
    TARGET_LABEL: target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_COLLECTION_GUIDANCE: reviewContext.collectionGuidance,
    REVIEW_INPUT: reviewContext.content
  });
  const finalPromptSha = sha256Hex(interpolated);

  const schema = readOutputSchema(REVIEW_SCHEMA_PATH);
  const systemPrompt = buildReviewSystemPrompt({ adversarial, schema });
  const systemPromptSha = sha256Hex(systemPrompt);

  const reporter = createProgressReporter({ logFile: logPath });
  const result = await runGlmReview(cwd, {
    prompt: interpolated,
    systemPrompt,
    model: options.model,
    thinking,
    // Sampling-param pass-through. Values stay `undefined` when the
    // corresponding CLI flag is absent → glm-client's validator skips
    // them and the server default applies.
    temperature: parseFloatOrUndefined(options.temperature),
    topP: parseFloatOrUndefined(options["top-p"]),
    seed: parseIntOrUndefined(options.seed),
    frequencyPenalty: parseFloatOrUndefined(options["frequency-penalty"]),
    presencePenalty: parseFloatOrUndefined(options["presence-penalty"]),
    expectJson: true,
    onProgress: reporter
  });

  const modelCompletedAt = nowIso();
  const validationContext = buildReviewValidationContext(reviewContext);
  const sanitizedResult = sanitizeReviewResultForStorageM0(result);
  const { result: storedResult, pass: validationPass } = validateStructuralReviewResult(
    sanitizedResult,
    validationContext
  );
  const repoChecks = runRepoChecks({
    repoRoot: reviewContext.repoRoot,
    changedFiles: reviewContext.changedFiles
  });
  let storedResultWithRepoChecks = {
    ...storedResult,
    repo_checks: repoChecks
  };
  let finalValidationPass = validationPass;

  let rerankPass = null;
  if (options.reflect || options["reflect-model"]) {
    const canReflect =
      Boolean(storedResultWithRepoChecks.parsed) &&
      (storedResultWithRepoChecks.parsed.findings?.length ?? 0) > 0 &&
      !storedResultWithRepoChecks.failureMessage &&
      !storedResultWithRepoChecks.parseError;
    if (!canReflect) {
      rerankPass = buildRerankPassMetadata({
        status: "skipped",
        startedAtMs: Date.now(),
        completedAtMs: Date.now(),
        model: options["reflect-model"] || options.model || null,
        initialResult: storedResultWithRepoChecks,
        finalResult: storedResultWithRepoChecks,
        failureMessage:
          storedResultWithRepoChecks.parsed
            ? "initial review had no findings to rerank"
            : "initial review did not produce a usable parsed payload"
      });
      storedResultWithRepoChecks = attachRerankMetadata(storedResultWithRepoChecks, rerankPass);
    } else {
      const rerankStartedAt = Date.now();
      const reflectModel = options["reflect-model"] || options.model || null;
      reporter({
        phase: "rerank",
        message: `starting optional reflection/rerank pass${reflectModel ? ` with ${reflectModel}` : ""}`
      });
      const reflectionPrompt = buildReflectionPrompt({
        targetLabel: buildTargetLabel(target, focusText),
        reviewMode: adversarial ? "adversarial-review" : "review",
        initialResult: storedResultWithRepoChecks,
        validationPass,
        repoChecks
      });
      const reflectionResult = await runGlmReview(cwd, {
        prompt: reflectionPrompt,
        systemPrompt,
        model: reflectModel || options.model,
        thinking,
        temperature: parseFloatOrUndefined(options.temperature),
        topP: parseFloatOrUndefined(options["top-p"]),
        seed: parseIntOrUndefined(options.seed),
        frequencyPenalty: parseFloatOrUndefined(options["frequency-penalty"]),
        presencePenalty: parseFloatOrUndefined(options["presence-penalty"]),
        expectJson: true,
        onProgress: reporter
      });
      const sanitizedReflection = sanitizeReviewResultForStorageM0(reflectionResult);
      const { result: reflectedResult, pass: reflectedValidationPass } = validateStructuralReviewResult(
        sanitizedReflection,
        validationContext
      );
      const reflectedWithRepoChecks = {
        ...reflectedResult,
        repo_checks: repoChecks
      };
      const reflectionFailed =
        Boolean(reflectedWithRepoChecks.failureMessage) ||
        Boolean(reflectedWithRepoChecks.parseError) ||
        !reflectedWithRepoChecks.parsed;
      const rerankCompletedAt = Date.now();
      if (reflectionFailed) {
        rerankPass = buildRerankPassMetadata({
          status: "failed",
          startedAtMs: rerankStartedAt,
          completedAtMs: rerankCompletedAt,
          model: reflectModel,
          initialResult: storedResultWithRepoChecks,
          finalResult: storedResultWithRepoChecks,
          failureMessage:
            reflectedWithRepoChecks.failureMessage ||
            reflectedWithRepoChecks.parseError ||
            "reflection pass did not return a usable parsed review"
        });
        storedResultWithRepoChecks = attachRerankMetadata(storedResultWithRepoChecks, rerankPass);
      } else {
        rerankPass = buildRerankPassMetadata({
          status: "completed",
          startedAtMs: rerankStartedAt,
          completedAtMs: rerankCompletedAt,
          model: reflectModel,
          initialResult: storedResultWithRepoChecks,
          finalResult: reflectedWithRepoChecks
        });
        storedResultWithRepoChecks = attachRerankMetadata(reflectedWithRepoChecks, rerankPass);
        finalValidationPass = reflectedValidationPass;
      }
    }
  }

  const completedAt = nowIso();
  const failed = Boolean(storedResultWithRepoChecks.failureMessage) || Boolean(storedResultWithRepoChecks.parseError);
  const finalStatus = failed ? "failed" : "completed";
  const targetLabel = buildTargetLabel(target, focusText);
  const meta = {
    reviewLabel,
    reviewMode,
    targetLabel,
    targetMode: target.mode,
    baseRef: target.baseRef ?? null,
    focusText
  };
  const rendered = renderReviewResult(storedResultWithRepoChecks, meta);
  const passes = buildPassesField(jobRecord.startedAt, modelCompletedAt, finalStatus);
  passes.validation = finalValidationPass;
  passes.rerank = rerankPass;

  // M8A: build the pipeline-owned review packet. The model output schema
  // stays frozen (review-output.schema.json); provenance, context, and pass
  // metadata live here so eval/host-skill consumers can attribute and audit
  // a stored review without trusting the model to self-report any of it.
  //
  // A "completed" packet requires a real model output. Network / quota /
  // parse failures (failureMessage or parseError set) keep the legacy
  // packet-less job shape — M8 design does not assign a status for them
  // and inventing a synthetic review_output here would launder noise into
  // the eval harness. M8B fixtures will exercise these failure modes
  // explicitly when a "model-failed" status is added.
  const parsedOutput = storedResultWithRepoChecks.parsed;
  const canBuildCompletedPacket =
    !failed && parsedOutput && typeof parsedOutput === "object";
  const packet = canBuildCompletedPacket
    ? buildCompletedPacket({
        reviewOutput: {
          verdict: parsedOutput.verdict,
          summary: parsedOutput.summary,
          findings: Array.isArray(parsedOutput.findings) ? parsedOutput.findings : [],
          next_steps: Array.isArray(parsedOutput.next_steps) ? parsedOutput.next_steps : []
        },
        provenance: {
          plugin_version: PLUGIN_VERSION,
          review_mode: reviewMode,
          job_id: jobId,
          generated_at: completedAt,
          base_ref: reviewContext.baseSha ?? (target.baseRef ?? null),
          head_ref: reviewContext.headSha ?? null,
          model_requested: options.model ?? null,
          model_responded: null,
          prompt_template_name: templateName,
          prompt_template_sha256: promptTemplateSha,
          system_prompt_sha256: systemPromptSha,
          final_prompt_sha256: finalPromptSha
        },
        context: {
          input_mode: reviewContext.inputMode === "inline-diff"
            ? CONTEXT_INPUT_MODES.INLINE_DIFF
            : reviewContext.inputMode,
          diff_bytes: reviewContext.diffBytes,
          file_count: reviewContext.fileCount,
          max_diff_files: reviewContext.maxInlineFiles,
          max_diff_bytes: reviewContext.maxInlineDiffBytes,
          diff_included_files: Array.isArray(reviewContext.changedFiles)
            ? reviewContext.changedFiles.slice()
            : [],
          omitted_files: Array.isArray(reviewContext.omittedFiles)
            ? reviewContext.omittedFiles.slice()
            : []
        },
        passes,
        repoChecks: Array.isArray(repoChecks) ? repoChecks : []
      })
    : null;

  writeJobFile(workspaceRoot, jobId, {
    ...jobRecord,
    status: finalStatus,
    completedAt,
    result: storedResultWithRepoChecks,
    rendered,
    meta,
    passes,
    ...(packet ? { packet } : {})
  });
  upsertJob(workspaceRoot, {
    ...jobRecord,
    status: finalStatus,
    completedAt,
    summary: firstMeaningfulLine(
      storedResultWithRepoChecks.rawOutput,
      storedResultWithRepoChecks.failureMessage || ""
    )
  });

  outputCommandResult(
    {
      command: reviewMode,
      jobId,
      result: storedResultWithRepoChecks,
      rendered,
      meta,
      passes,
      ...(packet ? { packet } : {})
    },
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
    title: rescueMode ? "GLM rescue" : buildTaskTitle(prompt),
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

  if (reference) {
    const snapshot = buildSingleJobSnapshot(cwd, reference);
    outputCommandResult(
      { command: "status", snapshot },
      renderJobStatusReport(snapshot.job),
      Boolean(options.json)
    );
    return;
  }

  // Session scoping is read from options.env[SESSION_ID_ENV] inside
  // filterJobsForCurrentSession — no need to plumb session_id
  // explicitly from here.
  const snapshot = buildStatusSnapshot(cwd, {
    all: Boolean(options.all),
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

  // Session scoping is read from env inside filterJobsForCurrentSession;
  // pass the env explicitly so resolveCancelableJob sees the current
  // Claude Code session, not just whatever happens to be on
  // process.env.
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference, { env: process.env });
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

// Only auto-run the CLI when this file is invoked directly. Without this
// guard, tests that `import { buildTargetLabel }` would trigger main()
// with whatever test-runner argv they inherit (usually "unknown command"
// → exitCode=2). Matches Node's recommended direct-invocation check.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    // formatUserFacingError normalizes the throw (Error | string | other)
    // AND redacts $HOME so crash messages pasted into issues / Slack /
    // logs don't leak the username. Local debugging still sees the full
    // path via ~/… form.
    process.stderr.write(`${formatUserFacingError(error)}\n`);
    process.exitCode = 1;
  });
}
