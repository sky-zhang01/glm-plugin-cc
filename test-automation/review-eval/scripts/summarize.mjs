#!/usr/bin/env node
/**
 * Read one or more sanity-sweep CSVs and emit a per-cell summary table.
 *
 * Usage:
 *   node summarize.mjs ../results/v0.4.7/sanity-sweep.csv
 *
 * Aggregation key: (fixture_id, temperature, top_p, seed, thinking).
 * For each cell, reports:
 *   - N: number of runs
 *   - schema_compliance rate (mean)
 *   - schema_echo rate (mean)
 *   - invalid_shape rate (mean)
 *   - citation_accuracy mean ± stdev
 *   - false_file_hit total (any citation to known_false_files)
 *   - latency_ms mean ± stdev
 *
 * Prints a plain-text table suitable for pasting into a PR body or
 * CHANGELOG. NOT commit-formatted — this is operator-facing output.
 *
 * Decision helper: highlights cells that meet the issue #7 success
 * criteria (schema_compliance >= 0.95, schema_echo = 0,
 * citation_accuracy >= 0.90).
 */

import { readFileSync } from "node:fs";

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

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: summarize.mjs <csv> [csv ...]");
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
      row.fixture_id,
      row.temperature || "unset",
      row.top_p || "unset",
      row.seed || "unset",
      row.thinking
    ].join("|");
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(row);
  }

  console.log("");
  console.log("Sanity-sweep summary");
  console.log("====================");
  console.log("");
  console.log(
    "fixture | temp | top_p | seed | think | N | schema | empty_str | echo | invalid | cite_acc (±sd) | false_file | latency_ms (±sd) | PASS?"
  );
  console.log(
    "--------|------|-------|------|-------|---|--------|-----------|------|---------|----------------|-----------|-----------------|------"
  );

  const summaryRows = [];
  for (const [key, rows] of cells) {
    const [fixture, temp, topP, seed, thinking] = key.split("|");
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
    const ff = rows.reduce((a, r) => a + Number(r.citation_false_file_hits), 0);
    const latMean = mean(rows.map((r) => Number(r.latency_ms)));
    const latStd = stdev(rows.map((r) => Number(r.latency_ms)));

    // Success criteria (issue #7): schema_compliance is aligned with
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
        temp,
        topP,
        seed,
        thinking,
        N,
        sc.toFixed(2),
        emptyStr.toFixed(2),
        se.toFixed(2),
        is_.toFixed(2),
        `${caMean.toFixed(2)} (±${caStd.toFixed(2)})`,
        ff,
        `${Math.round(latMean)} (±${Math.round(latStd)})`,
        passes ? "YES" : "no"
      ].join(" | ")
    );
    summaryRows.push({ key, passes, sc, emptyStr, se, caMean, ff });
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
  console.log("");
}

main();
