import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectReviewContext } from "../scripts/lib/git.mjs";
import { renderReviewResult } from "../scripts/lib/render.mjs";
import {
  buildReviewValidationContext,
  validateReviewFinding,
  validateStructuralReviewResult
} from "../scripts/lib/validators/review-structural.mjs";

function makeRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glm-validator-"));
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "src/app.js"),
    [
      "export function loadUser(id) {",
      "  if (!id) return null;",
      "  return fetchUser(id);",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  return repoRoot;
}

function baseFinding(overrides = {}) {
  return {
    severity: "high",
    title: "Missing null guard",
    body: "The `fetchUser` call can run with an invalid id.",
    file: "src/app.js",
    line_start: 3,
    line_end: 3,
    confidence: 0.9,
    recommendation: "Guard before calling `fetchUser`.",
    ...overrides
  };
}

function parsedResult(findings) {
  return {
    parsed: {
      verdict: "needs-attention",
      summary: "validator test",
      findings,
      next_steps: []
    }
  };
}

function context(repoRoot, changedFiles = ["src/app.js"]) {
  return buildReviewValidationContext({ repoRoot, changedFiles });
}

function git(cwd, args) {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
}

describe("review structural validators — finding tiers", () => {
  it("cross-checks a finding with target file, sane line range, and local anchor", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(baseFinding(), context(repoRoot));
    assert.equal(validated.confidence_tier, "cross-checked");
    assert.equal(validated.validation_signals.find((s) => s.kind === "file_in_target").result, "pass");
    assert.equal(validated.validation_signals.find((s) => s.kind === "line_range_in_file").result, "pass");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "pass");
    assert.equal(validated.validation_signals.find((s) => s.kind === "known_false_reference_absent").result, "pass");
  });

  it("rejects a finding whose file is outside the reviewed target set", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(baseFinding({ file: "src/other.js" }), context(repoRoot));
    assert.equal(validated.confidence_tier, "rejected");
    assert.equal(validated.validation_signals.find((s) => s.kind === "file_in_target").result, "fail");
    assert.equal(validated.validation_signals.find((s) => s.kind === "line_range_in_file").result, "skip");
  });

  it("rejects a finding whose line range is outside the cited file", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(baseFinding({ line_start: 99, line_end: 99 }), context(repoRoot));
    assert.equal(validated.confidence_tier, "rejected");
    assert.equal(validated.validation_signals.find((s) => s.kind === "line_range_in_file").result, "fail");
  });

  it("rejects EOF+1 line ranges on newline-terminated files", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(
      baseFinding({
        line_start: 5,
        line_end: 5
      }),
      context(repoRoot)
    );
    assert.equal(validated.confidence_tier, "rejected");
    assert.equal(validated.validation_signals.find((s) => s.kind === "line_range_in_file").result, "fail");
  });

  it("keeps an anchor miss as proposed instead of hard-rejecting the finding", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(
      baseFinding({
        body: "The `totallyMissingSymbol` claim is not present near the cited line.",
        recommendation: "Check `totallyMissingSymbol`."
      }),
      context(repoRoot)
    );
    assert.equal(validated.confidence_tier, "proposed");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "fail");
  });

  it("keeps partial identifier anchor matches proposed instead of cross-checked", () => {
    const repoRoot = makeRepo();
    fs.writeFileSync(
      path.join(repoRoot, "src/app.js"),
      [
        "export function initializeUser(id) {",
        "  return initializeUserSession(id);",
        "}",
        ""
      ].join("\n"),
      "utf8"
    );
    const validated = validateReviewFinding(
      baseFinding({
        body: "The `init` call can run with invalid id.",
        line_start: 2,
        line_end: 2,
        recommendation: "Guard before `init`."
      }),
      context(repoRoot)
    );
    assert.equal(validated.confidence_tier, "proposed");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "fail");
  });

  it("keeps skipped anchor checks as proposed instead of cross-checked", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(
      baseFinding({
        title: "This line",
        body: "This is an issue.",
        recommendation: "Fix it."
      }),
      context(repoRoot)
    );
    assert.equal(validated.confidence_tier, "proposed");
    assert.equal(validated.validation_signals.find((s) => s.kind === "line_range_in_file").result, "pass");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "skip");
  });

  it("keeps unavailable target files as proposed instead of cross-checked", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(
      baseFinding({
        file: "src/deleted.js",
        body: "The `missingSymbol` reference is in a deleted target file.",
        recommendation: "Check `missingSymbol`."
      }),
      context(repoRoot, ["src/deleted.js"])
    );
    assert.equal(validated.confidence_tier, "proposed");
    assert.equal(validated.validation_signals.find((s) => s.kind === "file_in_target").result, "pass");
    assert.equal(validated.validation_signals.find((s) => s.kind === "line_range_in_file").result, "skip");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "skip");
  });

  it("rejects known-false cross-project references", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(
      baseFinding({
        body: "This mentions `workflow_governor`, which is a known false reference for this plugin."
      }),
      context(repoRoot)
    );
    assert.equal(validated.confidence_tier, "rejected");
    assert.equal(validated.validation_signals.find((s) => s.kind === "known_false_reference_absent").result, "fail");
  });

  it("rejects known-false references embedded in non-local path segments", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(
      baseFinding({
        body: "The `fetchUser` call mirrors a stale claim from `src/governance.py`.",
        recommendation: "Guard `fetchUser` without relying on `src/governance.py`."
      }),
      context(repoRoot)
    );
    assert.equal(validated.confidence_tier, "rejected");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "pass");
    assert.equal(validated.validation_signals.find((s) => s.kind === "known_false_reference_absent").result, "fail");
  });

  it("does not reject local symbols that merely contain a known-false token as a substring", () => {
    const repoRoot = makeRepo();
    fs.writeFileSync(
      path.join(repoRoot, "src/local.js"),
      ["export function workflow_governor_v2() {", "  return workflow_governor_v2();", "}", ""].join("\n"),
      "utf8"
    );
    const validated = validateReviewFinding(
      baseFinding({
        title: "Recursive local helper",
        body: "The `workflow_governor_v2` helper recurses forever.",
        file: "src/local.js",
        line_start: 2,
        line_end: 2,
        recommendation: "Stop calling `workflow_governor_v2` recursively."
      }),
      context(repoRoot, ["src/local.js"])
    );
    assert.equal(validated.confidence_tier, "cross-checked");
    assert.equal(validated.validation_signals.find((s) => s.kind === "known_false_reference_absent").result, "pass");
  });

  it("does not reject solely because the canonical file path matches a known-false name", () => {
    const repoRoot = makeRepo();
    fs.writeFileSync(
      path.join(repoRoot, "governance.py"),
      ["def safe_function():", "    return 1", ""].join("\n"),
      "utf8"
    );
    const validated = validateReviewFinding(
      baseFinding({
        title: "Safe function issue",
        body: "The `safe_function` call returns a stale value.",
        file: "governance.py",
        line_start: 1,
        line_end: 1,
        recommendation: "Fix `safe_function`."
      }),
      context(repoRoot, ["governance.py"])
    );
    assert.equal(validated.confidence_tier, "cross-checked");
    assert.equal(validated.validation_signals.find((s) => s.kind === "known_false_reference_absent").result, "pass");
  });

  it("does not reject a known-false literal when it names the local reviewed file", () => {
    const repoRoot = makeRepo();
    fs.writeFileSync(
      path.join(repoRoot, "governance.py"),
      ["def safe_function():", "    return 1", ""].join("\n"),
      "utf8"
    );
    const validated = validateReviewFinding(
      baseFinding({
        title: "Stale return in governance file",
        body: "In `governance.py`, the `safe_function` call returns a stale value.",
        file: "governance.py",
        line_start: 1,
        line_end: 1,
        recommendation: "Fix `safe_function` in `governance.py`."
      }),
      context(repoRoot, ["governance.py"])
    );
    assert.equal(validated.confidence_tier, "cross-checked");
    assert.equal(validated.validation_signals.find((s) => s.kind === "known_false_reference_absent").result, "pass");
  });

  it("rejects mixed local and non-local known-false references", () => {
    const repoRoot = makeRepo();
    fs.writeFileSync(
      path.join(repoRoot, "governance.py"),
      ["def safe_function():", "    return 1", ""].join("\n"),
      "utf8"
    );
    const validated = validateReviewFinding(
      baseFinding({
        title: "Stale return in governance file",
        body: "In `governance.py`, `safe_function` diverges from `workflow_governor`.",
        file: "governance.py",
        line_start: 1,
        line_end: 1,
        recommendation: "Fix `safe_function`, not `workflow_governor`."
      }),
      context(repoRoot, ["governance.py"])
    );
    assert.equal(validated.confidence_tier, "rejected");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "pass");
    assert.equal(validated.validation_signals.find((s) => s.kind === "known_false_reference_absent").result, "fail");
    assert.match(validated.validation_signals.find((s) => s.kind === "known_false_reference_absent").artifact, /workflow_governor/);
  });

  it("does not reject a known-false literal when it names a deleted target file", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(
      baseFinding({
        title: "Deleted governance file",
        body: "The removal of `governance.py` drops a required safeguard.",
        file: "governance.py",
        line_start: 1,
        line_end: 1,
        recommendation: "Restore `governance.py`."
      }),
      context(repoRoot, ["governance.py"])
    );
    assert.equal(validated.confidence_tier, "proposed");
    assert.equal(validated.validation_signals.find((s) => s.kind === "known_false_reference_absent").result, "pass");
    assert.equal(validated.validation_signals.find((s) => s.kind === "line_range_in_file").result, "skip");
  });

  it("does not reject a known-false literal that is explicitly anchored in the cited file", () => {
    const repoRoot = makeRepo();
    fs.writeFileSync(
      path.join(repoRoot, "src/validator.js"),
      ["const DEFAULT_KNOWN_FALSE_REFERENCES = [", "  \"governance.py\"", "];", ""].join("\n"),
      "utf8"
    );
    const validated = validateReviewFinding(
      baseFinding({
        title: "Known false list is too broad",
        body: "The `governance.py` literal is part of the denylist.",
        file: "src/validator.js",
        line_start: 2,
        line_end: 2,
        recommendation: "Scope `governance.py` so legitimate local references survive."
      }),
      context(repoRoot, ["src/validator.js"])
    );
    assert.equal(validated.confidence_tier, "cross-checked");
    assert.equal(validated.validation_signals.find((s) => s.kind === "known_false_reference_absent").result, "pass");
    assert.match(validated.validation_signals.find((s) => s.kind === "known_false_reference_absent").artifact, /locally present/);
  });

  it("does not reject a plain-text known-false literal that is present at the cited lines", () => {
    const repoRoot = makeRepo();
    fs.writeFileSync(
      path.join(repoRoot, "src/validator.js"),
      ["const DEFAULT_KNOWN_FALSE_REFERENCES = [", "  \"governance.py\"", "];", ""].join("\n"),
      "utf8"
    );
    const validated = validateReviewFinding(
      baseFinding({
        title: "Known false list is too broad",
        body: "The governance.py literal is part of the denylist.",
        file: "src/validator.js",
        line_start: 2,
        line_end: 2,
        recommendation: "Scope governance.py so legitimate local references survive."
      }),
      context(repoRoot, ["src/validator.js"])
    );
    assert.equal(validated.confidence_tier, "proposed");
    assert.equal(validated.validation_signals.find((s) => s.kind === "known_false_reference_absent").result, "pass");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "skip");
  });

  it("keeps unquoted prose token matches proposed instead of cross-checked", () => {
    const repoRoot = makeRepo();
    const validated = validateReviewFinding(
      baseFinding({
        body: "This fetch can run with invalid id.",
        recommendation: "Add a guard."
      }),
      context(repoRoot)
    );
    assert.equal(validated.confidence_tier, "proposed");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "skip");
  });

  it("does not follow symlinks that resolve outside the repo root", () => {
    const repoRoot = makeRepo();
    const outsidePath = path.join(os.tmpdir(), `glm-validator-outside-${Date.now()}.txt`);
    fs.writeFileSync(outsidePath, ["secret", "anchorValue", ""].join("\n"), "utf8");
    fs.symlinkSync(outsidePath, path.join(repoRoot, "linked.txt"));

    const validated = validateReviewFinding(
      baseFinding({
        title: "Linked file issue",
        body: "The `anchorValue` literal is exposed.",
        file: "linked.txt",
        line_start: 2,
        line_end: 2,
        recommendation: "Remove `anchorValue`."
      }),
      context(repoRoot, ["linked.txt"])
    );

    assert.equal(validated.confidence_tier, "proposed");
    assert.equal(validated.validation_signals.find((s) => s.kind === "file_in_target").result, "pass");
    assert.equal(validated.validation_signals.find((s) => s.kind === "line_range_in_file").result, "skip");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "skip");
    assert.match(validated.validation_signals.find((s) => s.kind === "line_range_in_file").artifact, /path escapes repo root/);
  });
});

describe("review target collection — rename coverage", () => {
  it("includes both source and destination paths for staged renames", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glm-validator-git-"));
    git(repoRoot, ["init", "-q"]);
    git(repoRoot, ["config", "user.email", "test@example.com"]);
    git(repoRoot, ["config", "user.name", "Test User"]);
    fs.writeFileSync(path.join(repoRoot, "old.js"), "export const value = 1;\n", "utf8");
    git(repoRoot, ["add", "old.js"]);
    git(repoRoot, ["commit", "-qm", "init"]);
    git(repoRoot, ["mv", "old.js", "new.js"]);

    const reviewContext = collectReviewContext(
      repoRoot,
      { mode: "working-tree", label: "working tree diff" },
      { includeDiff: false }
    );

    assert.deepEqual(reviewContext.changedFiles, ["new.js", "old.js"]);
  });

  it("keeps git-quoted path names decoded in changed-file validation", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glm-validator-git-"));
    git(repoRoot, ["init", "-q"]);
    git(repoRoot, ["config", "user.email", "test@example.com"]);
    git(repoRoot, ["config", "user.name", "Test User"]);
    const quotedPath = 'quote"file.js';
    const tabPath = "tab\tfile.js";
    fs.writeFileSync(path.join(repoRoot, quotedPath), "export const quotedSymbol = true;\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, tabPath), "export const tabSymbol = true;\n", "utf8");
    git(repoRoot, ["add", quotedPath, tabPath]);

    const reviewContext = collectReviewContext(
      repoRoot,
      { mode: "working-tree", label: "working tree diff" },
      { includeDiff: false }
    );
    const validationContext = buildReviewValidationContext(reviewContext);
    const validated = validateReviewFinding(
      baseFinding({
        body: "The `quotedSymbol` anchor is present.",
        file: quotedPath,
        line_start: 1,
        line_end: 1,
        recommendation: "Check `quotedSymbol`."
      }),
      validationContext
    );

    assert.deepEqual(reviewContext.changedFiles, [quotedPath, tabPath]);
    assert.equal(validated.validation_signals.find((s) => s.kind === "file_in_target").result, "pass");
    assert.equal(validated.confidence_tier, "cross-checked");
  });

  it("preserves leading and trailing spaces in changed-file validation paths", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glm-validator-git-"));
    git(repoRoot, ["init", "-q"]);
    git(repoRoot, ["config", "user.email", "test@example.com"]);
    git(repoRoot, ["config", "user.name", "Test User"]);
    const leadingPath = " lead.js";
    const trailingPath = "trail.js ";
    fs.writeFileSync(path.join(repoRoot, leadingPath), "export const leadingSymbol = true;\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, trailingPath), "export const trailingSymbol = true;\n", "utf8");
    git(repoRoot, ["add", leadingPath, trailingPath]);

    const reviewContext = collectReviewContext(
      repoRoot,
      { mode: "working-tree", label: "working tree diff" },
      { includeDiff: false }
    );
    const validationContext = buildReviewValidationContext(reviewContext);
    const validated = validateReviewFinding(
      baseFinding({
        body: "The `leadingSymbol` anchor is present.",
        file: leadingPath,
        line_start: 1,
        line_end: 1,
        recommendation: "Check `leadingSymbol`."
      }),
      validationContext
    );

    assert.deepEqual(reviewContext.changedFiles, [leadingPath, trailingPath]);
    assert.equal(validated.validation_signals.find((s) => s.kind === "file_in_target").result, "pass");
    assert.equal(validated.confidence_tier, "cross-checked");
  });

  it("validates branch reviews against HEAD instead of dirty working-tree bytes", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glm-validator-git-"));
    git(repoRoot, ["init", "-q", "-b", "main"]);
    git(repoRoot, ["config", "user.email", "test@example.com"]);
    git(repoRoot, ["config", "user.name", "Test User"]);
    fs.writeFileSync(path.join(repoRoot, "src.js"), "const base = 0;\n", "utf8");
    git(repoRoot, ["add", "src.js"]);
    git(repoRoot, ["commit", "-qm", "init"]);
    git(repoRoot, ["checkout", "-qb", "feature"]);
    fs.writeFileSync(path.join(repoRoot, "src.js"), "const branchAnchor = 1;\n", "utf8");
    git(repoRoot, ["commit", "-am", "feature change", "-q"]);
    fs.writeFileSync(path.join(repoRoot, "src.js"), "const dirtyOnly = 2;\n", "utf8");

    const reviewContext = collectReviewContext(
      repoRoot,
      { mode: "branch", label: "branch diff against main", baseRef: "main" },
      { includeDiff: false }
    );
    const validationContext = buildReviewValidationContext(reviewContext);
    const validated = validateReviewFinding(
      baseFinding({
        body: "The `branchAnchor` constant is present in the reviewed branch.",
        file: "src.js",
        line_start: 1,
        line_end: 1,
        recommendation: "Check `branchAnchor`."
      }),
      validationContext
    );

    assert.equal(validated.confidence_tier, "cross-checked");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "pass");
  });

  it("honors explicit readRef override instead of branch defaults", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glm-validator-git-"));
    git(repoRoot, ["init", "-q", "-b", "main"]);
    git(repoRoot, ["config", "user.email", "test@example.com"]);
    git(repoRoot, ["config", "user.name", "Test User"]);
    fs.writeFileSync(path.join(repoRoot, "src.js"), "const baseAnchor = 0;\n", "utf8");
    git(repoRoot, ["add", "src.js"]);
    git(repoRoot, ["commit", "-qm", "init"]);
    git(repoRoot, ["checkout", "-qb", "alt"]);
    fs.writeFileSync(path.join(repoRoot, "src.js"), "const altAnchor = 1;\n", "utf8");
    git(repoRoot, ["commit", "-am", "alt change", "-q"]);
    git(repoRoot, ["checkout", "main", "-q"]);
    git(repoRoot, ["checkout", "-qb", "feature"]);
    fs.writeFileSync(path.join(repoRoot, "src.js"), "const branchAnchor = 2;\n", "utf8");
    git(repoRoot, ["commit", "-am", "feature change", "-q"]);

    const reviewContext = collectReviewContext(
      repoRoot,
      { mode: "branch", label: "branch diff against main", baseRef: "main" },
      { includeDiff: false }
    );
    const validationContext = buildReviewValidationContext(reviewContext, { readRef: "alt" });
    const validated = validateReviewFinding(
      baseFinding({
        body: "The `altAnchor` constant is present in the override ref.",
        file: "src.js",
        line_start: 1,
        line_end: 1,
        recommendation: "Check `altAnchor`."
      }),
      validationContext
    );

    assert.deepEqual(validationContext.readRefs, ["alt"]);
    assert.equal(validated.confidence_tier, "cross-checked");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "pass");
  });

  it("validates the old side of branch renames against the merge base", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glm-validator-git-"));
    git(repoRoot, ["init", "-q", "-b", "main"]);
    git(repoRoot, ["config", "user.email", "test@example.com"]);
    git(repoRoot, ["config", "user.name", "Test User"]);
    fs.writeFileSync(path.join(repoRoot, "old.js"), "export const renameAnchor = 1;\n", "utf8");
    git(repoRoot, ["add", "old.js"]);
    git(repoRoot, ["commit", "-qm", "init"]);
    git(repoRoot, ["checkout", "-qb", "feature"]);
    git(repoRoot, ["mv", "old.js", "new.js"]);
    git(repoRoot, ["commit", "-qm", "rename"]);

    const reviewContext = collectReviewContext(
      repoRoot,
      { mode: "branch", label: "branch diff against main", baseRef: "main" },
      { includeDiff: false }
    );
    const validationContext = buildReviewValidationContext(reviewContext);
    const validated = validateReviewFinding(
      baseFinding({
        body: "The `renameAnchor` export moved during the rename.",
        file: "old.js",
        line_start: 1,
        line_end: 1,
        recommendation: "Check `renameAnchor`."
      }),
      validationContext
    );

    assert.deepEqual(reviewContext.changedFiles, ["new.js", "old.js"]);
    assert.equal(validated.confidence_tier, "cross-checked");
    assert.equal(validated.validation_signals.find((s) => s.kind === "anchor_literal_found").result, "pass");
  });

  it("counts rename records once for inline-diff gating while retaining both paths for validation", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glm-validator-git-"));
    git(repoRoot, ["init", "-q", "-b", "main"]);
    git(repoRoot, ["config", "user.email", "test@example.com"]);
    git(repoRoot, ["config", "user.name", "Test User"]);
    fs.writeFileSync(path.join(repoRoot, "a.js"), "a\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "b.js"), "b\n", "utf8");
    git(repoRoot, ["add", "a.js", "b.js"]);
    git(repoRoot, ["commit", "-qm", "init"]);
    git(repoRoot, ["mv", "a.js", "a2.js"]);
    git(repoRoot, ["mv", "b.js", "b2.js"]);

    const reviewContext = collectReviewContext(
      repoRoot,
      { mode: "working-tree", label: "working tree diff" }
    );

    assert.equal(reviewContext.inputMode, "inline-diff");
    assert.deepEqual(reviewContext.changedFiles, ["a.js", "a2.js", "b.js", "b2.js"]);
  });

  it("counts partially staged files once for inline-diff gating", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glm-validator-git-"));
    git(repoRoot, ["init", "-q", "-b", "main"]);
    git(repoRoot, ["config", "user.email", "test@example.com"]);
    git(repoRoot, ["config", "user.name", "Test User"]);
    fs.writeFileSync(path.join(repoRoot, "a.js"), "const a = 1;\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "b.js"), "const b = 1;\n", "utf8");
    git(repoRoot, ["add", "a.js", "b.js"]);
    git(repoRoot, ["commit", "-qm", "init"]);
    fs.writeFileSync(path.join(repoRoot, "a.js"), "const a = 2;\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "b.js"), "const b = 2;\n", "utf8");
    git(repoRoot, ["add", "a.js", "b.js"]);
    fs.writeFileSync(path.join(repoRoot, "a.js"), "const a = 3;\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "b.js"), "const b = 3;\n", "utf8");

    const reviewContext = collectReviewContext(
      repoRoot,
      { mode: "working-tree", label: "working tree diff" }
    );

    assert.equal(reviewContext.inputMode, "inline-diff");
    assert.deepEqual(reviewContext.changedFiles, ["a.js", "b.js"]);
  });
});

describe("validateStructuralReviewResult — storage and render contract", () => {
  it("annotates stored findings with validation signals and pass telemetry", () => {
    const repoRoot = makeRepo();
    const { result, pass } = validateStructuralReviewResult(
      parsedResult([baseFinding(), baseFinding({ file: "src/other.js" })]),
      context(repoRoot)
    );

    assert.equal(result.validationApplied, true);
    assert.equal(result.parsed.findings[0].confidence_tier, "cross-checked");
    assert.equal(result.parsed.findings[1].confidence_tier, "rejected");
    assert.equal(result.parsed.findings[0].validation_signals.length, 4);
    assert.equal(pass.status, "completed");
    assert.equal(pass.totalFindings, 2);
    assert.equal(pass.tierCounts.cross_checked, 1);
    assert.equal(pass.tierCounts.rejected, 1);
  });

  it("skips validation without failing the whole job when the model payload failed parsing", () => {
    const repoRoot = makeRepo();
    const failure = { parsed: null, parseError: "TRUNCATED_JSON", rawOutput: "{" };
    const { result, pass } = validateStructuralReviewResult(failure, context(repoRoot));
    assert.equal(result, failure);
    assert.equal(pass.status, "skipped");
    assert.equal(pass.totalFindings, 0);
  });

  it("skips validation instead of throwing on malformed parsed findings", () => {
    const repoRoot = makeRepo();
    const malformed = {
      parsed: {
        verdict: "needs-attention",
        summary: "malformed",
        findings: null,
        next_steps: []
      }
    };
    const { result, pass } = validateStructuralReviewResult(malformed, context(repoRoot));
    assert.equal(result, malformed);
    assert.equal(pass.status, "skipped");
    assert.equal(pass.totalFindings, 0);
  });

  it("preserves pipeline-assigned cross-checked tier in human output", () => {
    const repoRoot = makeRepo();
    const { result } = validateStructuralReviewResult(parsedResult([baseFinding()]), context(repoRoot));
    const rendered = renderReviewResult(result, { reviewLabel: "Review", targetLabel: "test diff" });
    assert.match(rendered, /tier cross-checked/);
    assert.doesNotMatch(rendered, /tier proposed/);
  });

  it("hides rejected findings from default human output while retaining them in JSON/storage", () => {
    const repoRoot = makeRepo();
    const { result } = validateStructuralReviewResult(
      parsedResult([baseFinding({ file: "src/other.js", title: "Outside target" })]),
      context(repoRoot)
    );
    const rendered = renderReviewResult(result, { reviewLabel: "Review", targetLabel: "test diff" });
    assert.equal(result.parsed.findings[0].confidence_tier, "rejected");
    assert.doesNotMatch(rendered, /Outside target/);
    assert.match(rendered, /No material findings visible in default output/);
    assert.doesNotMatch(rendered, /No material findings\./);
    assert.match(rendered, /Rejected findings hidden from default output: 1/);
  });
});
