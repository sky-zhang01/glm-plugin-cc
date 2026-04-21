#!/usr/bin/env node
/**
 * Run one (fixture, sampling-cell) combo N times against /glm:adversarial-review
 * and append one row per run to a CSV.
 *
 * Usage:
 *   node run-experiment.mjs --fixture C2-v046-aftercare --temperature 0.2 \
 *        --top-p 0.85 --seed 42 --runs 3 --out ../results/v0.4.7/sanity-sweep.csv
 *
 * Philosophy (per Gitea issue #7):
 *   - Small, targeted experiments. 9 calls not 900.
 *   - Every row is self-describing: the CSV includes the parameter
 *     cell + the metrics + a timestamp, so future releases can diff
 *     against historical rows.
 *   - No parameter defaults assumed. Missing knob = unset (server default).
 *
 * Metrics written per row:
 *   schema_compliance (0/1)        — parsed JSON has verdict + summary + findings
 *   schema_echo (0/1)              — payload is the schema definition itself
 *   invalid_shape (0/1)            — parsed but missing required fields
 *   findings_count (int)           — number of findings in output
 *   citation_accuracy (float)      — fraction of findings whose cited file exists + keywords match
 *   citation_false_file_hits (int) — findings citing files in ground-truth.known_false_files
 *   input_tokens (int)             — from BigModel usage block if present
 *   output_tokens (int)            — same
 *   latency_ms (int)               — wall-clock round-trip
 *   error_code (string)            — companion errorCode, or "" on success
 *   correction_attempted (0/1)     — whether runChatRequestWithCorrectionRetry fired
 */

import { execSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  "temperature",
  "top_p",
  "seed",
  "thinking",
  "run_index",
  "schema_compliance",
  "schema_echo",
  "invalid_shape",
  "findings_count",
  "citation_accuracy",
  "citation_false_file_hits",
  "input_tokens",
  "output_tokens",
  "latency_ms",
  "error_code",
  "correction_attempted"
].join(",");

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

function scoreCitation(finding, gt) {
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
  const absPath = path.join(REPO_ROOT, cited);
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

function scoreCitations(findings, gt) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return { accuracy: 1.0, falseFileHits: 0 };
  }
  let ok = 0;
  let falseFileHits = 0;
  for (const f of findings) {
    const r = scoreCitation(f, gt);
    if (r.ok) ok++;
    if (r.falseFile) falseFileHits++;
  }
  return { accuracy: ok / findings.length, falseFileHits };
}

function ensureCsv(outPath) {
  const dir = path.dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(outPath)) {
    writeFileSync(outPath, CSV_HEADER + "\n");
  }
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function runOne({ fixtureId, temperature, topP, seed, thinking, runIndex, groundTruth }) {
  const companionArgs = [
    COMPANION,
    "adversarial-review",
    "--base", "main",
    "--scope", "branch",
    "--json",
    "--thinking", thinking,
    "--model", "glm-5.1"
  ];
  if (temperature !== undefined) companionArgs.push("--temperature", String(temperature));
  if (topP !== undefined) companionArgs.push("--top-p", String(topP));
  if (seed !== undefined) companionArgs.push("--seed", String(seed));
  companionArgs.push(`v0.4.7 sampling-sweep run ${runIndex} (${fixtureId})`);

  const started = Date.now();
  // Run from the repo root — companion expects cwd to be the target repo.
  const proc = spawnSync("node", companionArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env }
  });
  const latencyMs = Date.now() - started;

  let payload;
  try {
    payload = JSON.parse(proc.stdout);
  } catch {
    return {
      schema_compliance: 0,
      schema_echo: 0,
      invalid_shape: 0,
      findings_count: 0,
      citation_accuracy: 0,
      citation_false_file_hits: 0,
      input_tokens: 0,
      output_tokens: 0,
      latency_ms: latencyMs,
      error_code: "COMPANION_NON_JSON",
      correction_attempted: 0
    };
  }

  const result = payload?.result || {};
  const parsed = result?.parsed;
  const errorCode = result?.errorCode || "";
  const correctionAttempted = result?.correctionAttempted ? 1 : 0;

  const schemaCompliance = parsed && parsed.verdict && parsed.summary && Array.isArray(parsed.findings) ? 1 : 0;
  const schemaEcho = errorCode === "SCHEMA_ECHO" ? 1 : 0;
  const invalidShape = errorCode === "INVALID_SHAPE" ? 1 : 0;
  const findings = Array.isArray(parsed?.findings) ? parsed.findings : [];
  const citation = scoreCitations(findings, groundTruth);

  // Usage extraction: companion doesn't currently pass through BigModel's
  // usage block, so these are often 0. Captured for future use if we
  // extend glm-client to surface it.
  const inputTokens = result?.usage?.prompt_tokens ?? 0;
  const outputTokens = result?.usage?.completion_tokens ?? 0;

  return {
    schema_compliance: schemaCompliance,
    schema_echo: schemaEcho,
    invalid_shape: invalidShape,
    findings_count: findings.length,
    citation_accuracy: Number(citation.accuracy.toFixed(3)),
    citation_false_file_hits: citation.falseFileHits,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    latency_ms: latencyMs,
    error_code: errorCode,
    correction_attempted: correctionAttempted
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtureId = args.fixture || "C2-v046-aftercare";
  const temperature = args.temperature !== undefined ? Number(args.temperature) : undefined;
  const topP = args["top-p"] !== undefined ? Number(args["top-p"]) : undefined;
  const seed = args.seed !== undefined ? Number(args.seed) : undefined;
  const thinking = args.thinking || "on";
  const runs = Number(args.runs || 3);
  const outPath = path.resolve(args.out || path.join(__dirname, "../results/v0.4.7/sanity-sweep.csv"));

  const groundTruth = loadGroundTruth(fixtureId);
  ensureCsv(outPath);

  console.log(`[run-experiment] fixture=${fixtureId}, temp=${temperature ?? "unset"}, top_p=${topP ?? "unset"}, seed=${seed ?? "unset"}, thinking=${thinking}, runs=${runs}`);
  console.log(`[run-experiment] output: ${outPath}`);

  for (let i = 1; i <= runs; i++) {
    process.stdout.write(`  run ${i}/${runs} ... `);
    const metrics = runOne({ fixtureId, temperature, topP, seed, thinking, runIndex: i, groundTruth });
    const row = [
      new Date().toISOString(),
      fixtureId,
      temperature ?? "",
      topP ?? "",
      seed ?? "",
      thinking,
      i,
      metrics.schema_compliance,
      metrics.schema_echo,
      metrics.invalid_shape,
      metrics.findings_count,
      metrics.citation_accuracy,
      metrics.citation_false_file_hits,
      metrics.input_tokens,
      metrics.output_tokens,
      metrics.latency_ms,
      metrics.error_code,
      metrics.correction_attempted
    ].map(csvEscape).join(",");
    appendFileSync(outPath, row + "\n");
    console.log(`schema=${metrics.schema_compliance} echo=${metrics.schema_echo} cite=${metrics.citation_accuracy} err=${metrics.error_code || "ok"} ${metrics.latency_ms}ms`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
