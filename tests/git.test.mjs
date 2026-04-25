import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  collectReviewContext,
  ReviewContextDiffTooLargeError
} from "../scripts/lib/git.mjs";

function git(cwd, args) {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
}

function makeRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glm-git-pa1-"));
  git(repoRoot, ["init", "-q", "-b", "main"]);
  git(repoRoot, ["config", "user.email", "test@example.com"]);
  git(repoRoot, ["config", "user.name", "Test User"]);
  return repoRoot;
}

function commitInitial(repoRoot, files) {
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(repoRoot, name), body, "utf8");
  }
  git(repoRoot, ["add", ...Object.keys(files)]);
  git(repoRoot, ["commit", "-qm", "init"]);
}

function makeBranchWithChanges(repoRoot, branchName, fileMutations) {
  git(repoRoot, ["checkout", "-q", "-b", branchName]);
  for (const [name, body] of Object.entries(fileMutations)) {
    fs.writeFileSync(path.join(repoRoot, name), body, "utf8");
    git(repoRoot, ["add", name]);
  }
  git(repoRoot, ["commit", "-qm", `change-${branchName}`]);
}

const branchTarget = (baseRef = "main") => ({
  mode: "branch",
  label: `branch diff against ${baseRef}`,
  baseRef
});

describe("collectReviewContext — PA1 fail-closed on big diff", () => {
  it("returns inline-diff for a small branch diff", () => {
    const repo = makeRepo();
    commitInitial(repo, { "a.js": "const a = 1;\n" });
    makeBranchWithChanges(repo, "feature", { "a.js": "const a = 2;\n" });

    const ctx = collectReviewContext(repo, branchTarget());
    assert.equal(ctx.inputMode, "inline-diff");
    assert.equal(ctx.collectionGuidance, "Use the repository context below as primary evidence.");
    assert.match(ctx.content, /diff --git a\/a\.js b\/a\.js/);
    assert.equal(ctx.fileCount, 1);
    assert.ok(ctx.diffBytes > 0);
  });

  it("throws ReviewContextDiffTooLargeError when file count exceeds threshold", () => {
    const repo = makeRepo();
    const initial = {};
    for (let i = 0; i < 5; i++) initial[`f${i}.js`] = `const f${i} = 0;\n`;
    commitInitial(repo, initial);

    const mutations = {};
    for (let i = 0; i < 5; i++) mutations[`f${i}.js`] = `const f${i} = 1;\n`;
    makeBranchWithChanges(repo, "many-files", mutations);

    assert.throws(
      () => collectReviewContext(repo, branchTarget(), { maxInlineFiles: 2 }),
      (err) => {
        assert.ok(err instanceof ReviewContextDiffTooLargeError);
        assert.equal(err.kind, "DIFF_TOO_LARGE");
        assert.equal(err.fileCount, 5);
        assert.equal(err.maxInlineFiles, 2);
        assert.match(err.message, /file count 5 > 2/);
        assert.match(err.message, /--max-diff-files/);
        return true;
      }
    );
  });

  it("throws ReviewContextDiffTooLargeError when diff bytes exceed threshold", () => {
    const repo = makeRepo();
    commitInitial(repo, { "a.js": "x\n" });
    const big = "x".repeat(2048) + "\n";
    makeBranchWithChanges(repo, "fat-diff", { "a.js": big });

    assert.throws(
      () => collectReviewContext(repo, branchTarget(), { maxInlineDiffBytes: 100 }),
      (err) => {
        assert.ok(err instanceof ReviewContextDiffTooLargeError);
        assert.equal(err.kind, "DIFF_TOO_LARGE");
        assert.ok(err.diffBytes > 100);
        assert.equal(err.maxInlineDiffBytes, 100);
        assert.match(err.message, /diff bytes \d+ > 100/);
        assert.match(err.message, /--max-diff-bytes/);
        return true;
      }
    );
  });

  it("counts formatted untracked file bodies toward the byte budget", () => {
    const repo = makeRepo();
    commitInitial(repo, { "a.js": "const a = 1;\n" });
    fs.writeFileSync(path.join(repo, "new-large.txt"), "x".repeat(1024) + "\n", "utf8");

    assert.throws(
      () => collectReviewContext(repo, { mode: "working-tree", label: "working tree diff" }, { maxInlineDiffBytes: 100 }),
      (err) => {
        assert.ok(err instanceof ReviewContextDiffTooLargeError);
        assert.equal(err.kind, "DIFF_TOO_LARGE");
        assert.ok(err.diffBytes > 100);
        assert.equal(err.maxInlineDiffBytes, 100);
        assert.match(err.message, /diff bytes \d+ > 100/);
        return true;
      }
    );
  });

  it("respects per-call overrides that widen the budget", () => {
    const repo = makeRepo();
    const initial = {};
    for (let i = 0; i < 5; i++) initial[`f${i}.js`] = `const f${i} = 0;\n`;
    commitInitial(repo, initial);

    const mutations = {};
    for (let i = 0; i < 5; i++) mutations[`f${i}.js`] = `const f${i} = 1;\n`;
    makeBranchWithChanges(repo, "wide-budget", mutations);

    const ctx = collectReviewContext(repo, branchTarget(), { maxInlineFiles: 100 });
    assert.equal(ctx.inputMode, "inline-diff");
    assert.equal(ctx.fileCount, 5);
  });

  it("clamps non-finite or negative threshold overrides to defaults", () => {
    const repo = makeRepo();
    const initial = {};
    for (let i = 0; i < 60; i++) initial[`f${i}.js`] = `const f${i} = 0;\n`;
    commitInitial(repo, initial);

    const mutations = {};
    for (let i = 0; i < 60; i++) mutations[`f${i}.js`] = `const f${i} = 1;\n`;
    makeBranchWithChanges(repo, "default-fallback", mutations);

    assert.throws(
      () => collectReviewContext(repo, branchTarget(), { maxInlineFiles: -1 }),
      ReviewContextDiffTooLargeError
    );
  });

  it("error includes both fileCount and diffBytes reasons when both budgets are exceeded", () => {
    const repo = makeRepo();
    const initial = {};
    for (let i = 0; i < 4; i++) initial[`f${i}.js`] = "x\n";
    commitInitial(repo, initial);

    const big = "x".repeat(2048) + "\n";
    const mutations = {};
    for (let i = 0; i < 4; i++) mutations[`f${i}.js`] = big;
    makeBranchWithChanges(repo, "both-exceed", mutations);

    assert.throws(
      () => collectReviewContext(repo, branchTarget(), { maxInlineFiles: 1, maxInlineDiffBytes: 50 }),
      (err) => {
        assert.match(err.message, /file count 4 > 1/);
        assert.match(err.message, /diff bytes \d+ > 50/);
        return true;
      }
    );
  });

  it("never returns inputMode 'self-collect' under any successful path", () => {
    const repo = makeRepo();
    commitInitial(repo, { "a.js": "const a = 1;\n" });
    makeBranchWithChanges(repo, "feature-2", { "a.js": "const a = 2;\n" });

    const ctx = collectReviewContext(repo, branchTarget());
    assert.notEqual(ctx.inputMode, "self-collect");
    assert.equal(ctx.inputMode, "inline-diff");
  });
});
