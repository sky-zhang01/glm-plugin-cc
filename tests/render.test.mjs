import { strict as assert } from "node:assert";
import { test } from "node:test";
import { renderReviewResult } from "../scripts/lib/render.mjs";

// Regression guards for the render layer:
//
// - m-3: `normalizeReviewFinding` previously dropped the schema-required
//   `confidence` field (0-1) from normalized findings, so the terminal
//   output stripped every confidence signal silently. Post-fix: confidence
//   survives normalization AND appears in the rendered severity prefix.
//
// - I-2: `meta.targetLabel` must be the ONLY source of the target line in
//   the rendered report. Previous impl pulled `meta.base` / `meta.scope`
//   as well, which were always undefined (resolveReviewTarget never set
//   them) and silently produced a "working tree" fallback even on a real
//   branch comparison. The fix removed those fields; this test locks in
//   the contract that rendering trusts targetLabel.

const baseParsedResult = {
  parsed: {
    verdict: "needs-attention",
    summary: "Two real issues, one high-confidence.",
    findings: [
      {
        severity: "high",
        title: "Unhandled null in parseResponse",
        body: "The parseResponse helper can return null; caller does not guard.",
        file: "src/client.ts",
        line_start: 42,
        line_end: 42,
        confidence: 0.95,
        recommendation: "Return early with a typed error."
      },
      {
        severity: "low",
        title: "Dead import",
        body: "`lodash/merge` is no longer used after the refactor.",
        file: "src/util.ts",
        line_start: 3,
        line_end: 3,
        confidence: 0.5,
        recommendation: "Remove the import."
      }
    ],
    next_steps: ["Fix the unhandled null.", "Drop the dead import."]
  }
};

test("renderReviewResult includes confidence suffix in finding line (regression: m-3)", () => {
  const rendered = renderReviewResult(baseParsedResult, {
    reviewLabel: "Review",
    targetLabel: "branch diff against main"
  });
  assert.match(rendered, /\[high · conf 0\.95\] Unhandled null/);
  assert.match(rendered, /\[low · conf 0\.50\] Dead import/);
});

test("renderReviewResult omits confidence suffix when finding has no numeric confidence", () => {
  const noConfResult = {
    parsed: {
      ...baseParsedResult.parsed,
      findings: [
        {
          ...baseParsedResult.parsed.findings[0],
          confidence: undefined
        }
      ],
      next_steps: []
    }
  };
  const rendered = renderReviewResult(noConfResult, {
    reviewLabel: "Review",
    targetLabel: "working tree diff"
  });
  // No "conf" suffix when GLM didn't supply a valid score.
  assert.doesNotMatch(rendered, /conf /);
  // Severity label still present.
  assert.match(rendered, /\[high\] Unhandled null/);
});

test("renderReviewResult uses meta.targetLabel verbatim (regression: I-2)", () => {
  const rendered = renderReviewResult(baseParsedResult, {
    reviewLabel: "Adversarial Review",
    // Simulate what buildTargetLabel now produces: target.label +
    // optional focus. Before I-2, meta.base / meta.scope fed into
    // targetLabel but were always undefined, so tests of rendering
    // couldn't detect the drift. Locking the contract here.
    targetLabel: "branch diff against main · focus=auth flow"
  });
  assert.match(rendered, /Target: branch diff against main · focus=auth flow/);
});

test("renderReviewResult handles confidence at boundaries (0 and 1)", () => {
  const boundaryResult = {
    parsed: {
      verdict: "approve",
      summary: "Boundary test.",
      findings: [
        {
          severity: "low",
          title: "Zero confidence finding",
          body: "Reviewer uncertain.",
          file: "a.ts",
          line_start: 1,
          line_end: 1,
          confidence: 0,
          recommendation: ""
        },
        {
          severity: "critical",
          title: "Certain finding",
          body: "Reviewer fully certain.",
          file: "b.ts",
          line_start: 1,
          line_end: 1,
          confidence: 1,
          recommendation: ""
        }
      ],
      next_steps: []
    }
  };
  const rendered = renderReviewResult(boundaryResult, {
    reviewLabel: "Review",
    targetLabel: "working tree diff"
  });
  assert.match(rendered, /\[critical · conf 1\.00\]/);
  assert.match(rendered, /\[low · conf 0\.00\]/);
});
