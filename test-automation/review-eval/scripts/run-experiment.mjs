#!/usr/bin/env node
/**
 * Run one (fixture, sampling-cell, review-mode) combo N times against
 * /glm:review or /glm:adversarial-review
 * and append one row per run to a CSV.
 *
 * Usage:
 *   node run-experiment.mjs --fixture C2-v046-aftercare --temperature 0.2 \
 *        --top-p 0.85 --seed 42 --runs 3 --out ../results/v0.4.8/m3-measurement.csv
 *
 *   # Optional: exercise adversarial focus-text behavior intentionally.
 *   node run-experiment.mjs --mode adversarial-review \
 *        --adversarial-focus "stress risky-path tests" --runs 3
 *
 * Philosophy:
 *   - Small, targeted experiments. 9 calls not 900.
 *   - Every row is self-describing: the CSV includes the parameter
 *     cell + the metrics + a timestamp, so future releases can diff
 *     against historical rows.
 *   - No parameter defaults assumed. Missing knob = unset (server default).
 *
 * Metrics written per row:
 *   mode (string)                  — review | adversarial-review
 *   schema_compliance (0/1)        — parsed JSON has verdict + summary + findings
 *   schema_echo (0/1)              — payload is the schema definition itself
 *   invalid_shape (0/1)            — parsed but missing required fields
 *   findings_count (int)           — number of findings in output
 *   citation_accuracy (float)      — fraction of findings whose cited file exists + keywords match
 *   citation_false_file_hits (int) — findings citing files in ground-truth.known_false_files
 *   input_tokens (int)             — from BigModel usage block if present
 *   output_tokens (int)            — same
 *   latency_ms (int)               — wall-clock round-trip
 *   model_duration_ms (int)        — stored pass duration for model call
 *   validation_duration_ms (int)   — stored pass duration for validation pass
 *   tier_* (int)                   — confidence_tier distribution after validation
 *   error_code (string)            — companion errorCode, or "" on success
 *   correction_attempted (0/1)     — whether runChatRequestWithCorrectionRetry fired
 */

import { execFileSync, execSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const CORPUS_ROOT = path.resolve(__dirname, "../corpus");
const COMPANION = path.join(REPO_ROOT, "scripts", "glm-companion.mjs");

const CSV_HEADER = [
  "timestamp_utc",
  "fixture_id",
  "base_ref",
  "head_ref",
  "mode",
  "adversarial_focus",
  "temperature",
  "top_p",
  "seed",
  "thinking",
  "reflect",
  "reflect_model",
  "run_index",
  "schema_compliance",
  "schema_empty_string",
  "schema_echo",
  "invalid_shape",
  "findings_count",
  "citation_accuracy",
  "citation_false_file_hits",
  "input_tokens",
  "output_tokens",
  "latency_ms",
  "model_duration_ms",
  "validation_status",
  "validation_duration_ms",
  "rerank_status",
  "rerank_duration_ms",
  "rerank_initial_findings",
  "rerank_final_findings",
  "rerank_initial_proposed",
  "rerank_initial_cross_checked",
  "rerank_initial_deterministically_validated",
  "rerank_initial_rejected",
  "rerank_final_proposed",
  "rerank_final_cross_checked",
  "rerank_final_deterministically_validated",
  "rerank_final_rejected",
  "tier_proposed",
  "tier_cross_checked",
  "tier_deterministically_validated",
  "tier_rejected",
  "rejected_count",
  "error_code",
  "correction_attempted",
  "raw_payload_path"
].join(",");

// Cap raw-output snippet size so sidecar files stay bounded
// (~10-30 KB each). rawOutput in practice is bounded by the companion
// already; this is just defense.
const RAW_OUTPUT_HEAD_BYTES = 8192;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function loadGroundTruth(fixtureId) {
  const gtPath = path.join(CORPUS_ROOT, fixtureId, "ground-truth.json");
  return JSON.parse(readFileSync(gtPath, "utf8"));
}

function loadFixtureMeta(fixtureId) {
  const metaPath = path.join(CORPUS_ROOT, fixtureId, "meta.json");
  return JSON.parse(readFileSync(metaPath, "utf8"));
}

function normalizeFixtureRef(value, fieldName) {
  const ref = String(value || "").trim();
  if (!ref) {
    throw new Error(`Fixture meta missing ${fieldName}`);
  }
  // C3 records refs as "v0.4.0 (137234b)" for human context.
  // Git needs the actual ref token.
  return ref.split(/\s+/, 1)[0];
}

function createFixtureWorktree({ fixtureId, headRef }) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), `glm-review-${fixtureId}-`));
  const worktreePath = path.join(tempDir, "worktree");
  try {
    execFileSync("git", ["worktree", "add", "--detach", worktreePath, headRef], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "ignore", "pipe"]
    });
    return { tempDir, worktreePath };
  } catch (err) {
    rmSync(tempDir, { recursive: true, force: true });
    throw err;
  }
}

function removeFixtureWorktree({ tempDir, worktreePath }) {
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: REPO_ROOT,
      stdio: "ignore"
    });
  } catch {
    // Best-effort cleanup: git may already consider the worktree gone.
  }
  rmSync(tempDir, { recursive: true, force: true });
}

function extractDistinctiveTokens(body, limit = 3) {
  const stopwords = new Set([
    "the", "and", "for", "with", "that", "this", "from", "into",
    "will", "would", "could", "should", "when", "where", "what",
    "which", "there", "their", "been", "have", "has", "was", "are",
    "not", "but", "can", "may", "any", "all", "some", "you", "your"
  ]);
  return (String(body || ""))
    .split(/[^A-Za-z0-9_]+/)
    .filter((t) => t.length > 4 && !stopwords.has(t.toLowerCase()))
    .slice(0, limit);
}

function scoreCitation(finding, gt, workspaceRoot) {
  if (!finding || typeof finding.file !== "string") {
    return { ok: false, falseFile: false };
  }
  const cited = finding.file.trim();
  const isFalseFile = gt.known_false_files.some((pat) => cited.includes(pat));
  if (isFalseFile) return { ok: false, falseFile: true };
  const allowed = gt.allowed_files.includes(cited);
  if (!allowed) return { ok: false, falseFile: false };
  // File is allowed; check that distinctive tokens from body appear in
  // the cited file within line_start-line_end ± 20 lines.
  const absPath = path.join(workspaceRoot, cited);
  if (!existsSync(absPath)) return { ok: false, falseFile: false };
  const tokens = extractDistinctiveTokens(finding.body);
  if (tokens.length === 0) return { ok: true, falseFile: false }; // no claim to verify
  const lineStart = Math.max(1, (Number(finding.line_start) || 1) - 20);
  const lineEnd = (Number(finding.line_end) || Number(finding.line_start) || 1) + 20;
  try {
    const sedRange = `${lineStart},${lineEnd}p`;
    const content = execSync(`sed -n '${sedRange}' "${absPath}"`, { encoding: "utf8" });
    const hits = tokens.filter((t) => content.includes(t)).length;
    return { ok: hits >= 1, falseFile: false };
  } catch {
    return { ok: false, falseFile: false };
  }
}

function scoreCitations(findings, gt, workspaceRoot) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return { accuracy: 1.0, falseFileHits: 0 };
  }
  let ok = 0;
  let falseFileHits = 0;
  for (const f of findings) {
    const r = scoreCitation(f, gt, workspaceRoot);
    if (r.ok) ok++;
    if (r.falseFile) falseFileHits++;
  }
  return { accuracy: ok / findings.length, falseFileHits };
}

function normalizeReviewMode(value) {
  const mode = String(value || "adversarial-review").trim();
  if (mode === "review" || mode === "adversarial-review") {
    return mode;
  }
  throw new Error(`--mode must be review or adversarial-review, got: ${mode}`);
}

function emptyTierCounts() {
  return {
    proposed: 0,
    cross_checked: 0,
    deterministically_validated: 0,
    rejected: 0
  };
}

function countFindingTiers(findings) {
  const counts = emptyTierCounts();
  if (!Array.isArray(findings)) {
    return counts;
  }
  for (const finding of findings) {
    const tier = finding?.confidence_tier;
    if (tier === "cross-checked") {
      counts.cross_checked += 1;
    } else if (tier === "deterministically-validated") {
      counts.deterministically_validated += 1;
    } else if (tier === "rejected") {
      counts.rejected += 1;
    } else {
      counts.proposed += 1;
    }
  }
  return counts;
}

function ensureCsv(outPath) {
  const dir = path.dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(outPath)) {
    writeFileSync(outPath, CSV_HEADER + "\n");
    return;
  }
  const existingHeader = readFileSync(outPath, "utf8").split(/\r?\n/, 1)[0];
  if (existingHeader !== CSV_HEADER) {
    throw new Error(`CSV header mismatch for ${outPath}; choose a new --out path or migrate the existing file.`);
  }
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function buildPayloadSidecarPath(outPath, fixtureId, mode, temperature, topP, seed, runIndex, reflect) {
  const dir = path.join(path.dirname(outPath), "payloads");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cellTag = [
    fixtureId,
    mode,
    reflect ? "reflect-on" : "reflect-off",
    `t${temperature ?? "unset"}`,
    `tp${topP ?? "unset"}`,
    `s${seed ?? "unset"}`,
    `r${runIndex}`,
    new Date().toISOString().replace(/[:.]/g, "-")
  ].join("_");
  return path.join(dir, `${cellTag}.json`);
}

function runOne({
  fixtureId,
  mode,
  base,
  temperature,
  topP,
  seed,
  thinking,
  runIndex,
  groundTruth,
  workspaceRoot,
  head,
  outPath,
  adversarialFocus,
  reflect,
  reflectModel
}) {
  const companionArgs = [
    COMPANION,
    mode,
    "--cwd", workspaceRoot,
    "--base", base,
    "--scope", "branch",
    "--json",
    "--thinking", thinking,
    "--model", "glm-5.1"
  ];
  if (temperature !== undefined) companionArgs.push("--temperature", String(temperature));
  if (topP !== undefined) companionArgs.push("--top-p", String(topP));
  if (seed !== undefined) companionArgs.push("--seed", String(seed));
  if (reflect) companionArgs.push("--reflect");
  if (reflectModel) companionArgs.push("--reflect-model", reflectModel);
  if (mode === "adversarial-review" && adversarialFocus) {
    companionArgs.push(adversarialFocus);
  }

  const started = Date.now();
  // The companion implementation comes from REPO_ROOT, but the target
  // repo under review is the fixture worktree passed via --cwd.
  const proc = spawnSync("node", companionArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env }
  });
  const latencyMs = Date.now() - started;

  const sidecarPath = buildPayloadSidecarPath(outPath, fixtureId, mode, temperature, topP, seed, runIndex, reflect);
  const sidecarRelative = path.relative(path.dirname(outPath), sidecarPath);

  let payload;
  try {
    payload = JSON.parse(proc.stdout);
  } catch (err) {
    // Persist raw stdout/stderr so the failure is inspectable later.
    writeFileSync(sidecarPath, JSON.stringify({
      error: "COMPANION_NON_JSON",
      parseError: err?.message ?? String(err),
      stdoutHead: String(proc.stdout || "").slice(0, RAW_OUTPUT_HEAD_BYTES),
      stderrHead: String(proc.stderr || "").slice(0, RAW_OUTPUT_HEAD_BYTES),
      exitCode: proc.status,
      signal: proc.signal
    }, null, 2));
    return {
      schema_compliance: 0,
      schema_empty_string: 0,
      schema_echo: 0,
      invalid_shape: 0,
      findings_count: 0,
      citation_accuracy: 0,
      citation_false_file_hits: 0,
      input_tokens: 0,
      output_tokens: 0,
      latency_ms: latencyMs,
      model_duration_ms: 0,
      validation_status: "skipped",
      validation_duration_ms: 0,
      tier_proposed: 0,
      tier_cross_checked: 0,
      tier_deterministically_validated: 0,
      tier_rejected: 0,
      rejected_count: 0,
      error_code: "COMPANION_NON_JSON",
      correction_attempted: 0,
      raw_payload_path: sidecarRelative
    };
  }

  const result = payload?.result || {};
  const parsed = result?.parsed;
  const rawOutput = typeof result?.rawOutput === "string" ? result.rawOutput : "";
  const reasoningSummary = typeof result?.reasoningSummary === "string" ? result.reasoningSummary : "";
  const errorCode = result?.errorCode || "";
  const correctionAttempted = result?.correctionAttempted ? 1 : 0;

  // schema_compliance: type-valid per the plugin's own classifyReviewPayload
  // (typeof verdict === "string", typeof summary === "string",
  // Array.isArray(findings)). Empty strings pass this check — that's the
  // plugin's actual validity judgment.
  const typesValid =
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    typeof parsed.verdict === "string" &&
    typeof parsed.summary === "string" &&
    Array.isArray(parsed.findings);
  // schema_empty_string: separate signal for the case where types are
  // valid but verdict or summary is literally the empty string. Empty
  // content isn't a schema failure per classifyReviewPayload but also
  // isn't useful review output — tracking it independently lets us
  // distinguish model degenerate states from harness strictness artifacts.
  const hasEmptyContent = typesValid && (parsed.verdict === "" || parsed.summary === "");
  const schemaCompliance = typesValid ? 1 : 0;
  const schemaEmptyString = hasEmptyContent ? 1 : 0;
  const schemaEcho = errorCode === "SCHEMA_ECHO" ? 1 : 0;
  const invalidShape = errorCode === "INVALID_SHAPE" ? 1 : 0;
  const findings = Array.isArray(parsed?.findings) ? parsed.findings : [];
  const citation = scoreCitations(findings, groundTruth, workspaceRoot);
  const tierCounts = countFindingTiers(findings);
  const passes = payload?.passes && typeof payload.passes === "object" ? payload.passes : {};
  const modelDurationMs = Number(passes.model?.durationMs);
  const validationDurationMs = Number(passes.validation?.durationMs);
  const validationStatus = typeof passes.validation?.status === "string" ? passes.validation.status : "";
  const rerank = passes.rerank && typeof passes.rerank === "object" ? passes.rerank : null;
  const rerankStatus = typeof rerank?.status === "string" ? rerank.status : "";
  const rerankDurationMs = Number(rerank?.durationMs);
  const rerankInitial = rerank?.initial && typeof rerank.initial === "object" ? rerank.initial : {};
  const rerankFinal = rerank?.final && typeof rerank.final === "object" ? rerank.final : {};
  const rerankInitialTiers = rerankInitial.tierCounts && typeof rerankInitial.tierCounts === "object" ? rerankInitial.tierCounts : {};
  const rerankFinalTiers = rerankFinal.tierCounts && typeof rerankFinal.tierCounts === "object" ? rerankFinal.tierCounts : {};

  // Usage extraction: companion doesn't currently pass through BigModel's
  // usage block, so these are often 0. Captured for future use if we
  // extend glm-client to surface it.
  const inputTokens = result?.usage?.prompt_tokens ?? 0;
  const outputTokens = result?.usage?.completion_tokens ?? 0;

  // Persist parsed payload + rawOutput head + metadata for offline audit.
  // Saves the full parsed JSON (validated shape, bounded size) plus a
  // capped rawOutput slice (defense against pathological model output).
  writeFileSync(sidecarPath, JSON.stringify({
    cell: {
      fixtureId,
      base,
      head,
      mode,
      adversarialFocus: mode === "adversarial-review" ? adversarialFocus : "",
      reflect: Boolean(reflect),
      reflectModel: reflectModel || null,
      temperature: temperature ?? null,
      topP: topP ?? null,
      seed: seed ?? null,
      thinking,
      runIndex
    },
    metrics: {
      schema_compliance: schemaCompliance,
      schema_empty_string: schemaEmptyString,
      schema_echo: schemaEcho,
      invalid_shape: invalidShape,
      findings_count: findings.length,
      citation_accuracy: Number(citation.accuracy.toFixed(3)),
      citation_false_file_hits: citation.falseFileHits,
      latency_ms: latencyMs,
      model_duration_ms: Number.isFinite(modelDurationMs) ? modelDurationMs : 0,
      validation_status: validationStatus,
      validation_duration_ms: Number.isFinite(validationDurationMs) ? validationDurationMs : 0,
      rerank_status: rerankStatus,
      rerank_duration_ms: Number.isFinite(rerankDurationMs) ? rerankDurationMs : 0,
      rerank_initial_findings: numberOrZero(rerankInitial.totalFindings),
      rerank_final_findings: numberOrZero(rerankFinal.totalFindings),
      rerank_initial_tier_distribution: {
        proposed: numberOrZero(rerankInitialTiers.proposed),
        cross_checked: numberOrZero(rerankInitialTiers.cross_checked),
        deterministically_validated: numberOrZero(rerankInitialTiers.deterministically_validated),
        rejected: numberOrZero(rerankInitialTiers.rejected)
      },
      rerank_final_tier_distribution: {
        proposed: numberOrZero(rerankFinalTiers.proposed),
        cross_checked: numberOrZero(rerankFinalTiers.cross_checked),
        deterministically_validated: numberOrZero(rerankFinalTiers.deterministically_validated),
        rejected: numberOrZero(rerankFinalTiers.rejected)
      },
      tier_distribution: tierCounts,
      rejected_count: tierCounts.rejected,
      error_code: errorCode
    },
    passes,
    parsed,
    rawOutputHead: rawOutput.slice(0, RAW_OUTPUT_HEAD_BYTES),
    rawOutputTruncated: rawOutput.length > RAW_OUTPUT_HEAD_BYTES,
    reasoningSummaryHead: reasoningSummary.slice(0, RAW_OUTPUT_HEAD_BYTES / 2),
    errorCode,
    correctionAttempted: Boolean(result?.correctionAttempted),
    capturedAt: new Date().toISOString()
  }, null, 2));

  return {
    schema_compliance: schemaCompliance,
    schema_empty_string: schemaEmptyString,
    schema_echo: schemaEcho,
    invalid_shape: invalidShape,
    findings_count: findings.length,
    citation_accuracy: Number(citation.accuracy.toFixed(3)),
    citation_false_file_hits: citation.falseFileHits,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    latency_ms: latencyMs,
    model_duration_ms: Number.isFinite(modelDurationMs) ? modelDurationMs : 0,
    validation_status: validationStatus,
    validation_duration_ms: Number.isFinite(validationDurationMs) ? validationDurationMs : 0,
    rerank_status: rerankStatus,
    rerank_duration_ms: Number.isFinite(rerankDurationMs) ? rerankDurationMs : 0,
    rerank_initial_findings: numberOrZero(rerankInitial.totalFindings),
    rerank_final_findings: numberOrZero(rerankFinal.totalFindings),
    rerank_initial_proposed: numberOrZero(rerankInitialTiers.proposed),
    rerank_initial_cross_checked: numberOrZero(rerankInitialTiers.cross_checked),
    rerank_initial_deterministically_validated: numberOrZero(rerankInitialTiers.deterministically_validated),
    rerank_initial_rejected: numberOrZero(rerankInitialTiers.rejected),
    rerank_final_proposed: numberOrZero(rerankFinalTiers.proposed),
    rerank_final_cross_checked: numberOrZero(rerankFinalTiers.cross_checked),
    rerank_final_deterministically_validated: numberOrZero(rerankFinalTiers.deterministically_validated),
    rerank_final_rejected: numberOrZero(rerankFinalTiers.rejected),
    tier_proposed: tierCounts.proposed,
    tier_cross_checked: tierCounts.cross_checked,
    tier_deterministically_validated: tierCounts.deterministically_validated,
    tier_rejected: tierCounts.rejected,
    rejected_count: tierCounts.rejected,
    error_code: errorCode,
    correction_attempted: correctionAttempted,
    raw_payload_path: sidecarRelative
  };
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtureId = args.fixture || "C2-v046-aftercare";
  const mode = normalizeReviewMode(args.mode);
  const fixtureMeta = loadFixtureMeta(fixtureId);
  const fixtureBase = normalizeFixtureRef(fixtureMeta.base_ref, "base_ref");
  const fixtureHead = normalizeFixtureRef(fixtureMeta.head_ref, "head_ref");
  const base = normalizeFixtureRef(args.base || fixtureBase, "base");
  const head = normalizeFixtureRef(args.head || fixtureHead, "head");
  const temperature = args.temperature !== undefined ? Number(args.temperature) : undefined;
  const topP = args["top-p"] !== undefined ? Number(args["top-p"]) : undefined;
  const seed = args.seed !== undefined ? Number(args.seed) : undefined;
  const thinking = args.thinking || "on";
  const reflect = args.reflect === true || String(args.reflect || "").toLowerCase() === "true" || String(args.reflect || "").toLowerCase() === "on";
  const reflectModel = typeof args["reflect-model"] === "string" ? args["reflect-model"].trim() : "";
  const runs = Number(args.runs || 3);
  const outPath = path.resolve(args.out || path.join(__dirname, "../results/v0.4.8/m3-measurement-v2.csv"));
  const adversarialFocus = typeof args["adversarial-focus"] === "string" ? args["adversarial-focus"].trim() : "";

  const groundTruth = loadGroundTruth(fixtureId);
  ensureCsv(outPath);

  const fixtureWorktree = createFixtureWorktree({ fixtureId, headRef: head });
  try {
    console.log(`[run-experiment] fixture=${fixtureId}, mode=${mode}, base=${base}, head=${head}, temp=${temperature ?? "unset"}, top_p=${topP ?? "unset"}, seed=${seed ?? "unset"}, thinking=${thinking}, reflect=${reflect ? "on" : "off"}, reflect_model=${reflectModel || "unset"}, runs=${runs}, adversarial_focus=${adversarialFocus ? "set" : "unset"}`);
    console.log(`[run-experiment] worktree: ${fixtureWorktree.worktreePath}`);
    console.log(`[run-experiment] output: ${outPath}`);

    for (let i = 1; i <= runs; i++) {
      process.stdout.write(`  run ${i}/${runs} ... `);
      const metrics = runOne({
        fixtureId,
        mode,
        base,
        temperature,
        topP,
        seed,
        thinking,
        runIndex: i,
        groundTruth,
        workspaceRoot: fixtureWorktree.worktreePath,
        head,
        outPath,
        adversarialFocus,
        reflect,
        reflectModel
      });
      const row = [
        new Date().toISOString(),
        fixtureId,
        base,
        head,
        mode,
        mode === "adversarial-review" ? adversarialFocus : "",
        temperature ?? "",
        topP ?? "",
        seed ?? "",
        thinking,
        reflect ? "on" : "off",
        reflectModel,
        i,
        metrics.schema_compliance,
        metrics.schema_empty_string,
        metrics.schema_echo,
        metrics.invalid_shape,
        metrics.findings_count,
        metrics.citation_accuracy,
        metrics.citation_false_file_hits,
        metrics.input_tokens,
        metrics.output_tokens,
        metrics.latency_ms,
        metrics.model_duration_ms,
        metrics.validation_status,
        metrics.validation_duration_ms,
        metrics.rerank_status,
        metrics.rerank_duration_ms,
        metrics.rerank_initial_findings,
        metrics.rerank_final_findings,
        metrics.rerank_initial_proposed,
        metrics.rerank_initial_cross_checked,
        metrics.rerank_initial_deterministically_validated,
        metrics.rerank_initial_rejected,
        metrics.rerank_final_proposed,
        metrics.rerank_final_cross_checked,
        metrics.rerank_final_deterministically_validated,
        metrics.rerank_final_rejected,
        metrics.tier_proposed,
        metrics.tier_cross_checked,
        metrics.tier_deterministically_validated,
        metrics.tier_rejected,
        metrics.rejected_count,
        metrics.error_code,
        metrics.correction_attempted,
        metrics.raw_payload_path
      ].map(csvEscape).join(",");
      appendFileSync(outPath, row + "\n");
      const emptyFlag = metrics.schema_empty_string ? " [empty-str]" : "";
      const rerankFlag = reflect ? ` rerank=${metrics.rerank_status || "missing"}` : "";
      console.log(`schema=${metrics.schema_compliance}${emptyFlag} echo=${metrics.schema_echo} cite=${metrics.citation_accuracy}${rerankFlag} err=${metrics.error_code || "ok"} ${metrics.latency_ms}ms`);
    }
  } finally {
    removeFixtureWorktree(fixtureWorktree);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
