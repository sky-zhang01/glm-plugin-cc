/**
 * M0 focus-text rejection tests — v0.4.8
 *
 * Guards the breaking behavior change in runReview:
 *   - /glm:review with focus text => usage error + non-zero exit
 *   - /glm:review without focus text => proceeds normally (regression guard)
 *   - /glm:adversarial-review with focus text => still accepted (regression guard)
 *
 * These tests spawn the companion script in a subprocess to exercise
 * the real exit-code path, similar to tests/result-propagation.test.mjs.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const companionScript = path.join(repoRoot, "scripts", "glm-companion.mjs");

function makeTempEnv() {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "glm-focus-rej-data-"));
  const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), "glm-focus-rej-repo-"));
  fs.mkdirSync(path.join(fakeRepo, ".git"), { recursive: true });
  const xdgConfig = fs.mkdtempSync(path.join(os.tmpdir(), "glm-focus-rej-cfg-"));
  // Need a minimal git config so git commands don't fail
  fs.writeFileSync(path.join(fakeRepo, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  return { pluginData, fakeRepo, xdgConfig };
}

function runCompanion(args, { pluginData, fakeRepo, xdgConfig }) {
  return spawnSync(
    process.execPath,
    [companionScript, ...args],
    {
      cwd: fakeRepo,
      env: {
        ...process.env,
        CLAUDE_PLUGIN_DATA: pluginData,
        XDG_CONFIG_HOME: xdgConfig
      },
      encoding: "utf8",
      timeout: 15_000
    }
  );
}

// ── /glm:review with focus text → usage error + non-zero exit ───────────────

describe("/glm:review — focus text rejected", () => {
  it("exits non-zero when focus text is provided to review command", () => {
    const env = makeTempEnv();
    const result = runCompanion(["review", "working-tree", "some focus text"], env);
    assert.notEqual(result.status, 0, `expected non-zero exit, got ${result.status}`);
  });

  it("emits the expected usage error message to stderr", () => {
    const env = makeTempEnv();
    const result = runCompanion(["review", "working-tree", "some focus text"], env);
    assert.match(
      result.stderr,
      /\/glm:review does not accept focus text/,
      `expected usage error on stderr, got: ${result.stderr}`
    );
  });

  it("mentions /glm:adversarial-review in the error message", () => {
    const env = makeTempEnv();
    const result = runCompanion(["review", "working-tree", "custom framing"], env);
    assert.match(
      result.stderr,
      /\/glm:adversarial-review/,
      "error message should mention adversarial-review as the alternative"
    );
  });

  it("does not write to stdout when focus text is rejected", () => {
    const env = makeTempEnv();
    const result = runCompanion(["review", "some focus text"], env);
    assert.equal(
      result.stdout,
      "",
      "stdout must be empty when review focus text is rejected"
    );
  });

  it("rejects focus text even when only one positional argument is provided", () => {
    const env = makeTempEnv();
    const result = runCompanion(["review", "focus-only"], env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\/glm:review does not accept focus text/);
  });

  it("rejects multi-word focus text", () => {
    const env = makeTempEnv();
    const result = runCompanion(["review", "auth", "flow", "security"], env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\/glm:review does not accept focus text/);
  });
});

// ── /glm:review without focus text → proceeds (regression guard) ─────────────

describe("/glm:review — no focus text proceeds normally", () => {
  it("review without focus text does NOT emit the usage error", () => {
    const env = makeTempEnv();
    // Without any focus text, the command proceeds into git/GLM checks.
    // It will fail for other reasons (no auth, no git history, etc.) but
    // must NOT emit the focus-text usage error.
    const result = runCompanion(["review"], env);
    assert.doesNotMatch(
      result.stderr,
      /\/glm:review does not accept focus text/,
      "no focus-text rejection error should appear when review has no focus text"
    );
  });

  it("review with only flags (--scope working-tree) does NOT emit the usage error", () => {
    const env = makeTempEnv();
    const result = runCompanion(["review", "--scope", "working-tree"], env);
    assert.doesNotMatch(
      result.stderr,
      /\/glm:review does not accept focus text/
    );
  });
});

// ── /glm:adversarial-review with focus text → still accepted ─────────────────

describe("/glm:adversarial-review — focus text still accepted", () => {
  it("adversarial-review with focus text does NOT emit the review focus-rejection error", () => {
    const env = makeTempEnv();
    const result = runCompanion(["adversarial-review", "auth flow"], env);
    assert.doesNotMatch(
      result.stderr,
      /\/glm:review does not accept focus text/,
      "adversarial-review must not trigger the review focus-rejection error"
    );
  });
});
