import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadRepoCheckDefinitions,
  runRepoChecks
} from "../scripts/lib/repo-checks.mjs";

function makeRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glm-repo-checks-"));
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, ".glm", "checks"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "src", "app.js"),
    ["export function run() {", "  return 'safe';", "}", ""].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(repoRoot, "src", "other.js"),
    ["export const stale = 'workflow_governor';", ""].join("\n"),
    "utf8"
  );
  return repoRoot;
}

describe("repo-owned checks loader", () => {
  it("skips cleanly when .glm/checks is absent", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glm-repo-checks-empty-"));
    const result = runRepoChecks({ repoRoot, changedFiles: ["src/app.js"] });

    assert.equal(result.status, "skipped");
    assert.deepEqual(result.checks, []);
    assert.deepEqual(result.errors, []);
  });

  it("loads hard-schema JSON and simple YAML definitions", () => {
    const repoRoot = makeRepo();
    fs.writeFileSync(
      path.join(repoRoot, ".glm", "checks", "exists.json"),
      JSON.stringify({
        id: "safe-token-exists",
        kind: "grep-exists",
        path_globs: ["src/**/*.js"],
        pattern: "safe",
        message: "Expected safe token."
      }, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(repoRoot, ".glm", "checks", "notpresent.yaml"),
      [
        "id: no-cross-project-token",
        "kind: grep-notpresent",
        "path_globs:",
        "  - \"src/**/*.js\"",
        "pattern: \"workflow_governor\"",
        "message: \"No workflow-governor references in reviewed files.\"",
        ""
      ].join("\n"),
      "utf8"
    );

    const loaded = loadRepoCheckDefinitions(repoRoot);

    assert.equal(loaded.errors.length, 0);
    assert.deepEqual(loaded.checks.map((check) => check.id), [
      "safe-token-exists",
      "no-cross-project-token"
    ]);
  });

  it("reports schema errors without executing anything", () => {
    const repoRoot = makeRepo();
    fs.writeFileSync(
      path.join(repoRoot, ".glm", "checks", "bad.json"),
      JSON.stringify({
        id: "bad",
        kind: "test-passes",
        path_globs: ["src/**/*.js"],
        pattern: "safe"
      }),
      "utf8"
    );

    const result = runRepoChecks({ repoRoot, changedFiles: ["src/app.js"] });

    assert.equal(result.status, "failed");
    assert.match(result.errors[0], /unsupported kind test-passes/);
    assert.deepEqual(result.checks, []);
  });
});

describe("repo-owned checks runner", () => {
  it("passes grep-exists when the literal appears in a reviewed file", () => {
    const repoRoot = makeRepo();
    fs.writeFileSync(
      path.join(repoRoot, ".glm", "checks", "exists.json"),
      JSON.stringify({
        id: "safe-token-exists",
        kind: "grep-exists",
        path_globs: ["src/**/*.js"],
        pattern: "safe"
      }),
      "utf8"
    );

    const result = runRepoChecks({ repoRoot, changedFiles: ["src/app.js"] });

    assert.equal(result.status, "completed");
    assert.equal(result.checks[0].result, "pass");
    assert.equal(result.checks[0].match_count, 1);
    assert.equal(result.checks[0].violations.length, 0);
  });

  it("fails grep-exists when the literal is absent from reviewed files", () => {
    const repoRoot = makeRepo();
    fs.writeFileSync(
      path.join(repoRoot, ".glm", "checks", "exists.json"),
      JSON.stringify({
        id: "missing-token",
        kind: "grep-exists",
        path_globs: ["src/**/*.js"],
        pattern: "required_token"
      }),
      "utf8"
    );

    const result = runRepoChecks({ repoRoot, changedFiles: ["src/app.js"] });

    assert.equal(result.checks[0].result, "fail");
    assert.equal(result.checks[0].violations.length, 0);
  });

  it("fails grep-notpresent only for matching reviewed files", () => {
    const repoRoot = makeRepo();
    fs.writeFileSync(
      path.join(repoRoot, ".glm", "checks", "notpresent.json"),
      JSON.stringify({
        id: "no-cross-project-token",
        kind: "grep-notpresent",
        path_globs: ["src/**/*.js"],
        pattern: "workflow_governor"
      }),
      "utf8"
    );

    const cleanResult = runRepoChecks({ repoRoot, changedFiles: ["src/app.js"] });
    const dirtyResult = runRepoChecks({ repoRoot, changedFiles: ["src/other.js"] });

    assert.equal(cleanResult.checks[0].result, "pass");
    assert.equal(dirtyResult.checks[0].result, "fail");
    assert.deepEqual(dirtyResult.checks[0].violations, [
      {
        file: "src/other.js",
        line: 1,
        match: "export const stale = 'workflow_governor';"
      }
    ]);
  });
});
