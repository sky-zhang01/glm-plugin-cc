import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const runExperimentScript = path.join(repoRoot, "test-automation/review-eval/scripts/run-experiment.mjs");
const summarizeScript = path.join(repoRoot, "test-automation/review-eval/scripts/summarize.mjs");

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 10_000,
    ...options
  });
}

test("run-experiment supports review mode without making remote calls when runs=0", () => {
  const tmp = makeTmpDir("glm-review-eval-run-");
  const outPath = path.join(tmp, "measurement.csv");
  const result = runNode([
    runExperimentScript,
    "--mode", "review",
    "--fixture", "C2-v046-aftercare",
    "--runs", "0",
    "--out", outPath
  ]);

  assert.equal(result.status, 0, result.stderr);
  const header = fs.readFileSync(outPath, "utf8").trim();
  assert.match(header, /timestamp_utc,fixture_id,base_ref,head_ref,mode,adversarial_focus,temperature/);
  assert.match(header, /model_duration_ms,validation_status,validation_duration_ms/);
  assert.match(header, /tier_proposed,tier_cross_checked,tier_deterministically_validated,tier_rejected,rejected_count/);
  assert.match(result.stdout, /mode=review/);
  assert.match(result.stdout, /base=8fc1b98, head=d5fa754/);
  assert.match(result.stdout, /adversarial_focus=unset/);
  const worktreeMatch = result.stdout.match(/\[run-experiment\] worktree: (.+)/);
  assert.ok(worktreeMatch, result.stdout);
  assert.equal(fs.existsSync(worktreeMatch[1].trim()), false);
});

test("run-experiment defaults adversarial mode to no focus for mode parity", () => {
  const tmp = makeTmpDir("glm-review-eval-adversarial-focus-");
  const outPath = path.join(tmp, "measurement.csv");
  const result = runNode([
    runExperimentScript,
    "--mode", "adversarial-review",
    "--fixture", "C2-v046-aftercare",
    "--runs", "0",
    "--out", outPath
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /mode=adversarial-review/);
  assert.match(result.stdout, /adversarial_focus=unset/);
});

test("run-experiment normalizes parenthesized fixture refs", () => {
  const tmp = makeTmpDir("glm-review-eval-fixture-refs-");
  const outPath = path.join(tmp, "measurement.csv");
  const result = runNode([
    runExperimentScript,
    "--mode", "review",
    "--fixture", "C3-v04x-cumulative",
    "--runs", "0",
    "--out", outPath
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /base=v0\.4\.0, head=v0\.4\.6/);
});

test("run-experiment allows explicit fixture base/head overrides", () => {
  const tmp = makeTmpDir("glm-review-eval-fixture-ref-override-");
  const outPath = path.join(tmp, "measurement.csv");
  const result = runNode([
    runExperimentScript,
    "--mode", "review",
    "--fixture", "C2-v046-aftercare",
    "--base", "eb47b5f",
    "--head", "7766943",
    "--runs", "0",
    "--out", outPath
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /base=eb47b5f, head=7766943/);
});

test("run-experiment defaults PA2 output to the v2 measurement CSV", () => {
  const source = fs.readFileSync(runExperimentScript, "utf8");

  assert.match(source, /m3-measurement-v2\.csv/);
});

test("run-experiment records explicit adversarial focus opt-in", () => {
  const tmp = makeTmpDir("glm-review-eval-adversarial-focus-optin-");
  const outPath = path.join(tmp, "measurement.csv");
  const result = runNode([
    runExperimentScript,
    "--mode", "adversarial-review",
    "--fixture", "C2-v046-aftercare",
    "--adversarial-focus", "stress risky-path tests",
    "--runs", "0",
    "--out", outPath
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /adversarial_focus=set/);
});

test("run-experiment rejects unknown review modes before dispatch", () => {
  const tmp = makeTmpDir("glm-review-eval-mode-");
  const result = runNode([
    runExperimentScript,
    "--mode", "security-scan",
    "--runs", "0",
    "--out", path.join(tmp, "measurement.csv")
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--mode must be review or adversarial-review/);
});

test("run-experiment refuses to append M3 rows to an incompatible CSV header", () => {
  const tmp = makeTmpDir("glm-review-eval-header-");
  const outPath = path.join(tmp, "legacy.csv");
  fs.writeFileSync(outPath, "timestamp_utc,fixture_id,temperature\n", "utf8");

  const result = runNode([
    runExperimentScript,
    "--mode", "review",
    "--fixture", "C2-v046-aftercare",
    "--runs", "0",
    "--out", outPath
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CSV header mismatch/);
});

test("summarize groups by mode and reports tier/pass timing columns", () => {
  const tmp = makeTmpDir("glm-review-eval-summary-");
  const csvPath = path.join(tmp, "measurement.csv");
  fs.writeFileSync(csvPath, [
    "timestamp_utc,fixture_id,base_ref,head_ref,mode,adversarial_focus,temperature,top_p,seed,thinking,run_index,schema_compliance,schema_empty_string,schema_echo,invalid_shape,findings_count,citation_accuracy,citation_false_file_hits,input_tokens,output_tokens,latency_ms,model_duration_ms,validation_status,validation_duration_ms,tier_proposed,tier_cross_checked,tier_deterministically_validated,tier_rejected,rejected_count,error_code,correction_attempted,raw_payload_path",
    "2026-04-24T00:00:00Z,C2-v046-aftercare,8fc1b98,d5fa754,review,,,,,on,1,1,0,0,0,2,1,0,0,0,1200,1100,completed,7,1,1,0,0,0,,0,",
    "2026-04-24T00:00:01Z,C2-v046-aftercare,8fc1b98,d5fa754,adversarial-review,,,,,on,1,1,0,0,0,3,1,0,0,0,1500,1400,completed,9,2,0,0,1,1,,0,"
  ].join("\n") + "\n");

  const result = runNode([summarizeScript, csvPath]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fixture \| mode \| temp/);
  assert.match(result.stdout, /C2-v046-aftercare \| review .*P1\/C1\/D0\/R0/);
  assert.match(result.stdout, /C2-v046-aftercare \| adversarial-review .*P2\/C0\/D0\/R1/);
  assert.match(result.stdout, /model_ms/);
  assert.match(result.stdout, /validation_ms/);
});

test("summarize writes a dogfood packet with sampled findings from sidecars", () => {
  const tmp = makeTmpDir("glm-review-eval-packet-");
  const payloadDir = path.join(tmp, "payloads");
  fs.mkdirSync(payloadDir);
  const sidecarPath = path.join(payloadDir, "review.json");
  fs.writeFileSync(sidecarPath, JSON.stringify({
    parsed: {
      findings: [
        {
          severity: "medium",
          confidence_tier: "cross-checked",
          title: "Missing retry guard",
          file: "scripts/lib/example.mjs",
          line_start: 42
        }
      ]
    }
  }, null, 2));
  const csvPath = path.join(tmp, "measurement.csv");
  fs.writeFileSync(csvPath, [
    "timestamp_utc,fixture_id,base_ref,head_ref,mode,adversarial_focus,temperature,top_p,seed,thinking,run_index,schema_compliance,schema_empty_string,schema_echo,invalid_shape,findings_count,citation_accuracy,citation_false_file_hits,input_tokens,output_tokens,latency_ms,model_duration_ms,validation_status,validation_duration_ms,tier_proposed,tier_cross_checked,tier_deterministically_validated,tier_rejected,rejected_count,error_code,correction_attempted,raw_payload_path",
    "2026-04-24T00:00:00Z,C2-v046-aftercare,8fc1b98,d5fa754,review,,,,,on,1,1,0,0,0,1,1,0,0,0,1200,1100,completed,7,0,1,0,0,0,,0,payloads/review.json"
  ].join("\n") + "\n");
  const packetPath = path.join(tmp, "nested", "dogfood.md");

  const result = runNode([summarizeScript, "--dogfood-packet", packetPath, csvPath]);

  assert.equal(result.status, 0, result.stderr);
  const packet = fs.readFileSync(packetPath, "utf8");
  assert.match(packet, /GLM Review M3 Dogfood Packet/);
  assert.match(packet, /Candidate:/);
  assert.match(packet, /Missing retry guard/);
  assert.match(packet, /Human Spot-Check Notes/);
});
