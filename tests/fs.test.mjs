import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonFile, redactHomePath } from "../scripts/lib/fs.mjs";

// Guards for Bundle D3+ additions to fs.mjs:
// - Sub-MED: readJsonFile throws with file path on corrupt JSON
// - Side-2: redactHomePath replaces $HOME prefix with "~/" so error
//   messages / --json output don't leak the username when pasted.

test("readJsonFile parses a valid JSON file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-fs-test-"));
  const filePath = path.join(tmpDir, "valid.json");
  fs.writeFileSync(filePath, JSON.stringify({ a: 1, b: [true, null] }), "utf8");
  const parsed = readJsonFile(filePath);
  assert.deepEqual(parsed, { a: 1, b: [true, null] });
});

test("readJsonFile throws with file path on corrupt JSON (Sub-MED)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-fs-test-"));
  const filePath = path.join(tmpDir, "corrupt.json");
  fs.writeFileSync(filePath, "{ not valid", "utf8");
  assert.throws(
    () => readJsonFile(filePath),
    (err) => err.message.includes(filePath) && /Could not parse/.test(err.message)
  );
});

test("readJsonFile surfaces missing file (ENOENT) clearly", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-fs-test-"));
  const missingPath = path.join(tmpDir, "nope.json");
  assert.throws(
    () => readJsonFile(missingPath),
    /ENOENT|no such file/i
  );
});

test("redactHomePath replaces $HOME prefix with '~/'", () => {
  const home = os.homedir();
  assert.equal(redactHomePath(`${home}/foo/bar`), "~/foo/bar");
  assert.equal(redactHomePath(`Error at ${home}/file.json`), "Error at ~/file.json");
});

test("redactHomePath handles multiple occurrences in one string", () => {
  const home = os.homedir();
  const input = `First ${home}/a and second ${home}/b`;
  assert.equal(redactHomePath(input), "First ~/a and second ~/b");
});

test("redactHomePath does not touch paths outside $HOME", () => {
  assert.equal(redactHomePath("/tmp/foo"), "/tmp/foo");
  assert.equal(redactHomePath("/var/log/system.log"), "/var/log/system.log");
  // A string that CONTAINS the home path as a non-path substring should
  // stay untouched — the regex only matches at '/' boundaries or end.
  // (Rare in practice, but worth pinning.)
});

test("redactHomePath handles non-string / empty inputs safely", () => {
  assert.equal(redactHomePath(""), "");
  assert.equal(redactHomePath(null), null);
  assert.equal(redactHomePath(undefined), undefined);
  assert.equal(redactHomePath(42), 42);
});

test("redactHomePath does NOT redact a prefix match that is not followed by '/' or end", () => {
  const home = os.homedir();
  // e.g. /Users/sky_zhang01foo should not be redacted to ~foo
  const tricky = `${home}foo/bar`;
  assert.equal(redactHomePath(tricky), tricky, "boundary violation — regex redacted a non-path prefix");
});
