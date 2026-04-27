import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseArgs, splitRawArgumentString } from "../scripts/lib/args.mjs";

test("parseArgs: value option long form --key <value>", () => {
  const { options, positionals } = parseArgs(["--cwd", "/some/path"], {
    valueOptions: ["cwd"]
  });
  assert.equal(options.cwd, "/some/path");
  assert.deepEqual(positionals, []);
});

test("parseArgs: value option inline form --key=value", () => {
  const { options, positionals } = parseArgs(["--cwd=/some/path"], {
    valueOptions: ["cwd"]
  });
  assert.equal(options.cwd, "/some/path");
  assert.deepEqual(positionals, []);
});

test("parseArgs: inline value preserves '=' in value (regression: H-5)", () => {
  // Pre-fix: split("=", 2) truncated at the FIRST '=' and DROPPED the tail.
  // --base-url=https://x.com/path?foo=bar used to parse to "https://x.com/path?foo".
  const { options } = parseArgs(
    ["--base-url=https://open.bigmodel.cn/api/coding/paas/v4?foo=bar&baz=qux"],
    { valueOptions: ["base-url"] }
  );
  assert.equal(
    options["base-url"],
    "https://open.bigmodel.cn/api/coding/paas/v4?foo=bar&baz=qux"
  );
});

test("parseArgs: inline value with empty string", () => {
  const { options } = parseArgs(["--cwd="], { valueOptions: ["cwd"] });
  assert.equal(options.cwd, "");
});

test("parseArgs: alias resolves to canonical key for value option", () => {
  const { options } = parseArgs(["-C", "/some/path"], {
    valueOptions: ["cwd"],
    aliasMap: { C: "cwd" }
  });
  assert.equal(options.cwd, "/some/path");
});

test("parseArgs: value option NOT in valueOptions falls through to positionals", () => {
  // Regression guard — this is the bug we hit before the parseCommandInput
  // fix: `--cwd /path` was ignored because `cwd` was in aliasMap only,
  // not valueOptions. The parser treats unknown long flags as positionals.
  const { options, positionals } = parseArgs(["--cwd", "/some/path"], {
    valueOptions: []
  });
  assert.equal(options.cwd, undefined);
  assert.deepEqual(positionals, ["--cwd", "/some/path"]);
});

test("parseArgs: boolean option long form --flag", () => {
  const { options } = parseArgs(["--json"], { booleanOptions: ["json"] });
  assert.equal(options.json, true);
});

test("parseArgs: boolean option --flag=false", () => {
  const { options } = parseArgs(["--json=false"], { booleanOptions: ["json"] });
  assert.equal(options.json, false);
});

test("parseArgs: positionals preserved", () => {
  const { options, positionals } = parseArgs(
    ["focus", "text", "--json", "extra"],
    { booleanOptions: ["json"] }
  );
  assert.equal(options.json, true);
  assert.deepEqual(positionals, ["focus", "text", "extra"]);
});

test("parseArgs: -- stops flag parsing", () => {
  const { options, positionals } = parseArgs(
    ["--json", "--", "--cwd", "/path"],
    { booleanOptions: ["json"], valueOptions: ["cwd"] }
  );
  assert.equal(options.json, true);
  assert.deepEqual(positionals, ["--cwd", "/path"]);
});

test("parseArgs: missing value throws", () => {
  assert.throws(
    () => parseArgs(["--cwd"], { valueOptions: ["cwd"] }),
    /Missing value for --cwd/
  );
});

test("splitRawArgumentString: simple whitespace", () => {
  assert.deepEqual(splitRawArgumentString("a b c"), ["a", "b", "c"]);
});

test("splitRawArgumentString: single-quoted preserved", () => {
  assert.deepEqual(splitRawArgumentString("'hello world' after"), [
    "hello world",
    "after"
  ]);
});

test("splitRawArgumentString: double-quoted preserved", () => {
  assert.deepEqual(splitRawArgumentString('"a b" c'), ["a b", "c"]);
});

test("splitRawArgumentString: backslash escape", () => {
  assert.deepEqual(splitRawArgumentString("foo\\ bar"), ["foo bar"]);
});
