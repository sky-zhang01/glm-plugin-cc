import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const checker = path.join(repoRoot, "scripts", "ci", "check-public-surface.mjs");

function makePublicTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "glm-public-surface-"));
  for (const [relativePath, body] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, body, "utf8");
  }
  return root;
}

function runPublicCheck(root) {
  return spawnSync(process.execPath, [checker, "--public-tree", "--root", root], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

test("public-surface forbidden pattern globs fail public-facing copy only", () => {
  const root = makePublicTree({
    "README.md": "This public copy still mentions 智谱.\n"
  });

  const result = runPublicCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /legacy provider brand in public-facing copy: README\.md:1/);
});

test("public-surface scoped provider wording does not rewrite source semantics", () => {
  const root = makePublicTree({
    "scripts/lib/example.mjs": "// Internal code comments may mention 国内 network semantics.\n"
  });

  const result = runPublicCheck(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK — public surface clean/);
});
