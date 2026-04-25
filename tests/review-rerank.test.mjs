import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  attachRerankMetadata,
  buildReflectionPrompt,
  buildRerankPassMetadata,
  summarizeReviewResultForRerank
} from "../scripts/lib/review-rerank.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const initialResult = {
  parsed: {
    verdict: "needs-attention",
    summary: "Two findings before rerank.",
    findings: [
      {
        severity: "high",
        title: "Grounded bug",
        body: "`parseThing` can return null.",
        file: "scripts/glm-companion.mjs",
        line_start: 10,
        line_end: 10,
        confidence: 0.9,
        confidence_tier: "cross-checked",
        recommendation: "Guard the null return."
      },
      {
        severity: "low",
        title: "Weak concern",
        body: "This might be confusing.",
        file: "commands/review.md",
        line_start: 1,
        line_end: 1,
        confidence: 0.4,
        confidence_tier: "proposed",
        recommendation: "Consider rewording."
      }
    ],
    next_steps: ["Fix the null guard."]
  }
};

const finalResult = {
  parsed: {
    ...initialResult.parsed,
    summary: "One finding after rerank.",
    findings: [initialResult.parsed.findings[0]]
  }
};

describe("summarizeReviewResultForRerank", () => {
  it("preserves per-finding confidence metadata for audit", () => {
    const summary = summarizeReviewResultForRerank(initialResult);
    assert.equal(summary.totalFindings, 2);
    assert.equal(summary.tierCounts.cross_checked, 1);
    assert.equal(summary.tierCounts.proposed, 1);
    assert.deepEqual(summary.findings[0], {
      severity: "high",
      title: "Grounded bug",
      file: "scripts/glm-companion.mjs",
      line_start: 10,
      line_end: 10,
      confidence: 0.9,
      confidence_tier: "cross-checked"
    });
  });
});

describe("buildReflectionPrompt", () => {
  it("asks for precision improvement without allowing model-owned evidence fields", () => {
    const prompt = buildReflectionPrompt({
      targetLabel: "branch diff against develop",
      reviewMode: "adversarial-review",
      initialResult,
      validationPass: { status: "completed", totalFindings: 2 },
      repoChecks: { status: "completed", checks: [] }
    });

    assert.match(prompt, /optional second-pass reflection\/rerank/);
    assert.match(prompt, /Drop findings that are weak/);
    assert.match(prompt, /Do not self-assign `confidence_tier` or `validation_signals`/);
    assert.match(prompt, /at most 2 finding\(s\)/);
    assert.match(prompt, /"Grounded bug"/);
  });
});

describe("buildRerankPassMetadata", () => {
  it("records initial and final finding summaries plus pass timing", () => {
    const metadata = buildRerankPassMetadata({
      status: "completed",
      startedAtMs: 100,
      completedAtMs: 250,
      model: "glm-5.1",
      initialResult,
      finalResult
    });

    assert.equal(metadata.status, "completed");
    assert.equal(metadata.durationMs, 150);
    assert.equal(metadata.model, "glm-5.1");
    assert.equal(metadata.initial.totalFindings, 2);
    assert.equal(metadata.final.totalFindings, 1);
    assert.equal(metadata.initial.findings[1].confidence_tier, "proposed");
  });

  it("records failure reason while keeping final summary equal to the earlier result", () => {
    const metadata = buildRerankPassMetadata({
      status: "failed",
      startedAtMs: 300,
      completedAtMs: 290,
      model: null,
      initialResult,
      finalResult: initialResult,
      failureMessage: "reflection pass did not return JSON"
    });

    assert.equal(metadata.durationMs, 0);
    assert.equal(metadata.failureMessage, "reflection pass did not return JSON");
    assert.equal(metadata.final.totalFindings, metadata.initial.totalFindings);
  });
});

describe("attachRerankMetadata", () => {
  it("adds rerank metadata without mutating the parsed payload", () => {
    const metadata = { status: "completed" };
    const attached = attachRerankMetadata(finalResult, metadata);
    assert.equal(attached.rerank, metadata);
    assert.equal(attached.parsed.findings.length, 1);
    assert.equal(finalResult.rerank, undefined);
  });
});

describe("runReview wiring guards", () => {
  const companionSource = fs.readFileSync(path.join(repoRoot, "scripts/glm-companion.mjs"), "utf8");

  it("CLI parser exposes opt-in reflection flags but leaves default path gated", () => {
    assert.match(companionSource, /"reflect-model"/);
    assert.match(companionSource, /booleanOptions:\s*\[[^\]]*"reflect"/s);
    assert.match(companionSource, /if\s*\(\s*options\.reflect\s*\|\|\s*options\["reflect-model"\]\s*\)/);
  });

  it("runReview persists rerank pass metadata in stored jobs", () => {
    assert.match(companionSource, /passes\.rerank\s*=\s*rerankPass/);
    assert.match(companionSource, /attachRerankMetadata\s*\(/);
  });

  it("job summary is derived from the final result after optional rerank", () => {
    assert.match(
      companionSource,
      /summary:\s*firstMeaningfulLine\s*\(\s*storedResultWithRepoChecks\.rawOutput/s
    );
  });
});
