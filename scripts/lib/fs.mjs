import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function ensureAbsolutePath(cwd, maybePath) {
  return path.isAbsolute(maybePath) ? maybePath : path.resolve(cwd, maybePath);
}

// Normalize a caught `unknown` (Error | string | anything) into a plain
// string message suitable for rendering in --json error fields or
// stderr. Thin wrapper that (a) pulls `.message` from Error instances,
// (b) falls back to String() for exotic throws, (c) redacts the user's
// home path before returning. Four call sites used to repeat this
// pattern by hand; centralizing keeps the redaction guarantee uniform.
export function formatUserFacingError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return redactHomePath(message);
}

// Replace the user's home directory prefix with "~/" so error messages
// and --json output don't leak the username when the user pastes them
// into an issue / Slack / log. Only touches the home prefix; filenames
// and other path components are preserved. Call at emission points
// (stderr writes, JSON error fields) — NOT at throw sites, so local
// debugging still sees the full path.
export function redactHomePath(text) {
  if (typeof text !== "string" || !text) {
    return text;
  }
  const home = os.homedir();
  if (!home || home === "/") {
    return text;
  }
  // Escape regex metacharacters in the home path before building the pattern.
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`${escaped}(?=/|$)`, "g"), "~");
}

export function createTempDir(prefix = "glm-plugin-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function readJsonFile(filePath) {
  // Mirror the fail-closed pattern used by loadState / readConfigFile /
  // readJobFile: if the file is corrupt, surface the file path + a
  // recovery hint. Without this, callers like readOutputSchema (which
  // loads the shipped review-output.schema.json) throw a bare
  // `SyntaxError: Unexpected token ...` with no filename — users cannot
  // tell which file to fix.
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not parse ${filePath}: ${error.message}. Delete or fix the file to recover.`
    );
  }
}

export function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function safeReadFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

export function isProbablyText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const value of sample) {
    if (value === 0) {
      return false;
    }
  }
  return true;
}

export function readStdinIfPiped() {
  if (process.stdin.isTTY) {
    return "";
  }
  return fs.readFileSync(0, "utf8");
}
