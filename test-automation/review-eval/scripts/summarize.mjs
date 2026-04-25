#!/usr/bin/env node
/**
 * Read one or more review-eval CSVs and emit a per-cell summary table.
 *
 * Usage:
 *   node summarize.mjs ../results/v0.4.7/sanity-sweep.csv
 *
 * Aggregation key: (mode, fixture_id, temperature, top_p, seed, thinking, reflect, reflect_model).
 * For each cell, reports:
 *   - N: number of runs
 *   - schema_compliance rate (mean)
 *   - schema_echo rate (mean)
 *   - invalid_shape rate (mean)
 *   - citation_accuracy mean ± stdev
 *   - false_file_hit total (any citation to known_false_files)
 *   - tier distribution and rejected total
 *   - model / validation pass duration
 *   - latency_ms mean ± stdev
 *
 * Prints a plain-text table suitable for pasting into a PR body or
 * CHANGELOG. NOT commit-formatted — this is operator-facing output.
 *
 * Decision helper: highlights cells that meet the review-eval success
 * criteria (schema_compliance >= 0.95, schema_echo = 0,
 * citation_accuracy >= 0.90).
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { current += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { cells.push(current); current = ""; }
      else { current += c; }
    }
  }
  cells.push(current);
  return cells;
}

function mean(nums) {
  const arr = nums.filter((n) => Number.isFinite(n));
  if (arr.length === 0) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdev(nums) {
  const arr = nums.filter((n) => Number.isFinite(n));
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function parseArgs(argv) {
  const files = [];
  let dogfoodPacket = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dogfood-packet") {
      dogfoodPacket = argv[i + 1];
      if (!dogfoodPacket || dogfoodPacket.startsWith("--")) {
        throw new Error("--dogfood-packet requires a markdown output path.");
      }
      i++;
    } else {
      files.push(arg);
    }
  }
  return { files, dogfoodPacket };
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMeanStd(meanValue, stdValue, round = false) {
  if (!Number.isFinite(meanValue)) {
    return "n/a";
  }
  if (round) {
    return `${Math.round(meanValue)} (±${Math.round(stdValue)})`;
  }
  return `${meanValue.toFixed(2)} (±${stdValue.toFixed(2)})`;
}

function readSampleFindings(rows, csvFiles, maxPerMode = 3) {
  const samples = [];
  const seenModes = new Map();
  const csvDirs = csvFiles.map((file) => path.dirname(path.resolve(file)));
  for (const row of rows) {
    const mode = row.mode || "adversarial-review";
    const countForMode = seenModes.get(mode) ?? 0;
    if (countForMode >= maxPerMode || !row.raw_payload_path) {
      continue;
    }
    let sidecarPath = null;
    for (const dir of csvDirs) {
      const candidate = path.resolve(dir, row.raw_payload_path);
      if (existsSync(candidate)) {
        sidecarPath = candidate;
        break;
      }
    }
    if (!sidecarPath) {
      continue;
    }
    try {
      const payload = JSON.parse(readFileSync(sidecarPath, "utf8"));
      const findings = Array.isArray(payload.parsed?.findings) ? payload.parsed.findings : [];
      for (const finding of findings) {
        if (samples.filter((sample) => sample.mode === mode).length >= maxPerMode) {
          break;
        }
        samples.push({
          mode,
          fixture: row.fixture_id,
          sidecarPath,
          title: finding.title ?? "(untitled)",
          severity: finding.severity ?? "unknown",
          tier: finding.confidence_tier ?? "proposed",
          file: finding.file ?? "",
          line: finding.line_start ?? ""
        });
      }
      seenModes.set(mode, samples.filter((sample) => sample.mode === mode).length);
    } catch {
      continue;
    }
  }
  return samples;
}

function currentGitRef() {
  try {
    const branch = execSync("git branch --show-current", { encoding: "utf8" }).trim();
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    return branch ? `${branch}@${sha}` : sha;
  } catch {
    return "unknown";
  }
}

function writeDogfoodPacket({ outPath, csvFiles, rows, summaryRows }) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  const samples = readSampleFindings(rows, csvFiles);
  const lines = [
    "# GLM Review M3 Dogfood Packet",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Candidate: ${currentGitRef()}`,
    `Inputs: ${csvFiles.map((file) => path.relative(process.cwd(), path.resolve(file))).join(", ")}`,
    "",
    "## Summary Cells",
    "",
    "| mode | fixture | reflect | N | schema | rejected | tiers | rerank | latency_ms | validation_ms | pass |",
    "|---|---|---|---:|---:|---:|---|---|---:|---:|---|"
  ];
  for (const row of summaryRows) {
    lines.push(
      `| ${row.mode} | ${row.fixture} | ${row.reflect} | ${row.N} | ${row.schema.toFixed(2)} | ${row.rejected} | ${row.tierSummary} | ${row.rerankSummary} | ${Math.round(row.latencyMean)} | ${Math.round(row.validationMean)} | ${row.passes ? "yes" : "no"} |`
    );
  }

  lines.push("", "## Sampled Findings", "");
  if (samples.length === 0) {
    lines.push("No sampled findings were available from sidecars.");
  } else {
    for (const sample of samples) {
      lines.push(
        `- [${sample.mode}] ${sample.severity} / ${sample.tier}: ${sample.title} (${sample.file}${sample.line ? `:${sample.line}` : ""})`
      );
      lines.push(`  - sidecar: ${path.relative(process.cwd(), sample.sidecarPath)}`);
    }
  }

  lines.push(
    "",
    "## Human Spot-Check Notes",
    "",
    "- [ ] Confirm every sampled file path exists in the candidate PR.",
    "- [ ] Confirm every sampled line range still points at the cited code.",
    "- [ ] Mark whether each sampled finding is actionable, weak, or fabricated.",
    "- [ ] Record whether balanced review hid any useful low-tier finding that adversarial review kept.",
    ""
  );

  writeFileSync(outPath, lines.join("\n"));
}

function main() {
  const { files, dogfoodPacket } = parseArgs(process.argv.slice(2));
  if (files.length === 0) {
    console.error("Usage: summarize.mjs [--dogfood-packet <markdown>] <csv> [csv ...]");
    process.exit(1);
  }
  const allRows = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    allRows.push(...parseCsv(text));
  }

  // Group by cell
  const cells = new Map();
  for (const row of allRows) {
    const key = [
      row.mode || "adversarial-review",
      row.fixture_id,
      row.temperature || "unset",
      row.top_p || "unset",
      row.seed || "unset",
      row.thinking,
      row.reflect || "off",
      row.reflect_model || "unset"
    ].join("|");
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(row);
  }

  console.log("");
  console.log("Sanity-sweep summary");
  console.log("====================");
  console.log("");
  console.log(
    "fixture | mode | temp | top_p | seed | think | reflect | refl_model | N | schema | empty_str | echo | invalid | cite_acc (±sd) | false_file | tiers | rejected | rerank | model_ms (±sd) | validation_ms (±sd) | latency_ms (±sd) | PASS?"
  );
  console.log(
    "--------|------|------|-------|------|-------|---------|------------|---|--------|-----------|------|---------|----------------|-----------|-------|----------|--------|---------------|--------------------|-----------------|------"
  );

  const summaryRows = [];
  for (const [key, rows] of cells) {
    const [mode, fixture, temp, topP, seed, thinking, reflect, reflectModel] = key.split("|");
    const N = rows.length;
    const sc = mean(rows.map((r) => Number(r.schema_compliance)));
    // schema_empty_string column may be absent in older CSVs; treat NaN as 0
    const emptyStr = mean(rows.map((r) => {
      const v = Number(r.schema_empty_string);
      return Number.isFinite(v) ? v : 0;
    }));
    const se = mean(rows.map((r) => Number(r.schema_echo)));
    const is_ = mean(rows.map((r) => Number(r.invalid_shape)));
    const caMean = mean(rows.map((r) => Number(r.citation_accuracy)));
    const caStd = stdev(rows.map((r) => Number(r.citation_accuracy)));
    const ff = rows.reduce((a, r) => a + numberOrZero(r.citation_false_file_hits), 0);
    const latMean = mean(rows.map((r) => Number(r.latency_ms)));
    const latStd = stdev(rows.map((r) => Number(r.latency_ms)));
    const modelMean = mean(rows.map((r) => numberOrZero(r.model_duration_ms)));
    const modelStd = stdev(rows.map((r) => numberOrZero(r.model_duration_ms)));
    const validationMean = mean(rows.map((r) => numberOrZero(r.validation_duration_ms)));
    const validationStd = stdev(rows.map((r) => numberOrZero(r.validation_duration_ms)));
    const rerankMean = mean(rows.map((r) => numberOrZero(r.rerank_duration_ms)));
    const rerankCompleted = rows.filter((r) => r.rerank_status === "completed").length;
    const rerankFailed = rows.filter((r) => r.rerank_status === "failed").length;
    const rerankSkipped = rows.filter((r) => r.rerank_status === "skipped").length;
    const proposed = rows.reduce((a, r) => a + numberOrZero(r.tier_proposed), 0);
    const crossChecked = rows.reduce((a, r) => a + numberOrZero(r.tier_cross_checked), 0);
    const deterministic = rows.reduce((a, r) => a + numberOrZero(r.tier_deterministically_validated), 0);
    const rejected = rows.reduce((a, r) => a + numberOrZero(r.tier_rejected || r.rejected_count), 0);
    const tierSummary = `P${proposed}/C${crossChecked}/D${deterministic}/R${rejected}`;
    const rerankInitial = rows.reduce((a, r) => a + numberOrZero(r.rerank_initial_findings), 0);
    const rerankFinal = rows.reduce((a, r) => a + numberOrZero(r.rerank_final_findings), 0);
    const rerankSummary =
      reflect === "on"
        ? `C${rerankCompleted}/F${rerankFailed}/S${rerankSkipped}; ${rerankInitial}->${rerankFinal}; ${formatMeanStd(rerankMean, 0, true)}`
        : "off";

    // Success criteria: schema_compliance is aligned with
    // classifyReviewPayload (type-valid). schema_empty_string is tracked
    // but does NOT block PASS — empty-content payloads are a content-
    // quality concern, not a plugin-level validity failure.
    const passes =
      sc >= 0.95 &&
      se === 0 &&
      caMean >= 0.90 &&
      ff === 0;

    console.log(
      [
        fixture,
        mode,
        temp,
        topP,
        seed,
        thinking,
        reflect,
        reflectModel,
        N,
        sc.toFixed(2),
        emptyStr.toFixed(2),
        se.toFixed(2),
        is_.toFixed(2),
        `${caMean.toFixed(2)} (±${caStd.toFixed(2)})`,
        ff,
        tierSummary,
        rejected,
        rerankSummary,
        formatMeanStd(modelMean, modelStd, true),
        formatMeanStd(validationMean, validationStd, true),
        `${Math.round(latMean)} (±${Math.round(latStd)})`,
        passes ? "YES" : "no"
      ].join(" | ")
    );
    summaryRows.push({
      key,
      mode,
      fixture,
      reflect,
      reflectModel,
      N,
      passes,
      schema: sc,
      emptyStr,
      se,
      caMean,
      ff,
      tierSummary,
      rejected,
      rerankSummary,
      modelMean,
      validationMean,
      latencyMean: latMean
    });
  }

  console.log("");
  const passing = summaryRows.filter((r) => r.passes);
  if (passing.length === 0) {
    console.log("No cell meets the v0.4.7 success criteria (schema_compliance >= 0.95, schema_echo = 0, citation_accuracy >= 0.90, false_file_hits = 0).");
    console.log("Recommendation: DO NOT change default sampling parameters in this release. Record negative result in CHANGELOG.");
  } else {
    console.log(`Cells passing success criteria: ${passing.length}/${summaryRows.length}`);
    console.log("Recommendation: review the passing cell(s) below and pick the one with lowest temperature + best latency.");
    for (const p of passing) console.log(`  ${p.key}`);
  }
  if (dogfoodPacket) {
    writeDogfoodPacket({ outPath: dogfoodPacket, csvFiles: files, rows: allRows, summaryRows });
    console.log(`Dogfood packet written: ${dogfoodPacket}`);
  }
  console.log("");
}

main();
