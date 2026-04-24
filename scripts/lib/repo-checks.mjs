import fs from "node:fs";
import path from "node:path";

import { isProbablyText } from "./fs.mjs";

const CHECKS_DIR = ".glm/checks";
const ALLOWED_KINDS = new Set(["grep-exists", "grep-notpresent"]);
const MAX_MATCHES_PER_CHECK = 50;

function normalizeRepoPath(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const normalized = path.posix.normalize(value.trim().replace(/\\/g, "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    return null;
  }
  return normalized;
}

function unquoteYamlScalar(value) {
  const trimmed = String(value ?? "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSimpleYaml(text, sourceFile) {
  const out = {};
  let listKey = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const listMatch = line.match(/^-\s+(.+)$/);
    if (listMatch) {
      if (!listKey || !Array.isArray(out[listKey])) {
        throw new Error(`${sourceFile}: list item without list key`);
      }
      out[listKey].push(unquoteYamlScalar(listMatch[1]));
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!keyMatch) {
      throw new Error(`${sourceFile}: unsupported YAML line: ${rawLine}`);
    }
    const [, key, rawValue = ""] = keyMatch;
    if (rawValue === "") {
      out[key] = [];
      listKey = key;
    } else {
      out[key] = unquoteYamlScalar(rawValue);
      listKey = null;
    }
  }
  return out;
}

function parseCheckFile(filePath, repoRoot) {
  const sourceFile = path.posix.relative(repoRoot, filePath).replace(/\\/g, "/");
  const text = fs.readFileSync(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(text);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((item, index) => ({
      raw: item,
      sourceFile,
      sourceIndex: index
    }));
  }
  return [{ raw: parseSimpleYaml(text, sourceFile), sourceFile, sourceIndex: 0 }];
}

function validateCheck(raw, sourceFile, sourceIndex) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `${sourceFile}: check ${sourceIndex + 1} must be an object` };
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const kind = typeof raw.kind === "string" ? raw.kind.trim() : "";
  const pattern = typeof raw.pattern === "string" ? raw.pattern : "";
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  const pathGlobs = Array.isArray(raw.path_globs) ? raw.path_globs.map(normalizeRepoPath) : [];

  if (!id) {
    return { error: `${sourceFile}: check ${sourceIndex + 1} missing string id` };
  }
  if (!/^[A-Za-z0-9_.:-]+$/.test(id)) {
    return { error: `${sourceFile}: check ${id} has unsupported id characters` };
  }
  if (!ALLOWED_KINDS.has(kind)) {
    return { error: `${sourceFile}: check ${id} has unsupported kind ${kind || "(missing)"}` };
  }
  if (pathGlobs.length === 0 || pathGlobs.some((value) => !value)) {
    return { error: `${sourceFile}: check ${id} requires non-empty repo-relative path_globs` };
  }
  if (!pattern) {
    return { error: `${sourceFile}: check ${id} requires non-empty literal pattern` };
  }
  return {
    check: {
      id,
      kind,
      path_globs: pathGlobs,
      pattern,
      message,
      source_file: sourceFile
    }
  };
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(glob) {
  let pattern = "";
  for (let index = 0; index < glob.length;) {
    if (glob.slice(index, index + 3) === "**/") {
      pattern += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (glob.slice(index, index + 2) === "**") {
      pattern += ".*";
      index += 2;
      continue;
    }
    const char = glob[index];
    if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += escapeRegExp(char);
    }
    index += 1;
  }
  return new RegExp(`^${pattern}$`);
}

function readCandidateFile(repoRoot, relativePath) {
  const normalized = normalizeRepoPath(relativePath);
  if (!normalized) {
    return null;
  }
  const absolutePath = path.resolve(repoRoot, normalized);
  const root = path.resolve(repoRoot);
  if (!(absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`))) {
    return null;
  }
  let buffer;
  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      return null;
    }
    buffer = fs.readFileSync(absolutePath);
  } catch {
    return null;
  }
  if (!isProbablyText(buffer)) {
    return null;
  }
  return buffer.toString("utf8");
}

function collectMatches(text, file, pattern) {
  const matches = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes(pattern)) {
      matches.push({ file, line: index + 1, match: line.trim() });
      if (matches.length >= MAX_MATCHES_PER_CHECK) {
        break;
      }
    }
  }
  return matches;
}

function runSingleCheck(check, repoRoot, changedFiles) {
  const globRegexes = check.path_globs.map(globToRegExp);
  const candidateFiles = [...new Set((changedFiles ?? []).map(normalizeRepoPath).filter(Boolean))]
    .filter((file) => globRegexes.some((regex) => regex.test(file)))
    .sort();
  const matches = [];
  let scannedFiles = 0;
  for (const file of candidateFiles) {
    const text = readCandidateFile(repoRoot, file);
    if (text === null) {
      continue;
    }
    scannedFiles += 1;
    matches.push(...collectMatches(text, file, check.pattern));
    if (matches.length >= MAX_MATCHES_PER_CHECK) {
      break;
    }
  }

  const result =
    check.kind === "grep-exists"
      ? matches.length > 0 ? "pass" : "fail"
      : matches.length === 0 ? "pass" : "fail";
  return {
    id: check.id,
    kind: check.kind,
    result,
    message: check.message || "",
    path_globs: check.path_globs,
    scanned_files: scannedFiles,
    match_count: matches.length,
    violations: result === "fail" ? matches : []
  };
}

export function loadRepoCheckDefinitions(repoRoot) {
  const checksDir = path.join(repoRoot, CHECKS_DIR);
  let entries;
  try {
    entries = fs.readdirSync(checksDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { checks: [], errors: [], checksDir };
    }
    return { checks: [], errors: [`${CHECKS_DIR}: ${error.message}`], checksDir };
  }

  const files = entries
    .filter((entry) => entry.isFile() && /\.(json|ya?ml)$/i.test(entry.name))
    .map((entry) => path.join(checksDir, entry.name))
    .sort();
  const checks = [];
  const errors = [];
  for (const file of files) {
    let parsedItems;
    try {
      parsedItems = parseCheckFile(file, repoRoot);
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    for (const item of parsedItems) {
      const validation = validateCheck(item.raw, item.sourceFile, item.sourceIndex);
      if (validation.error) {
        errors.push(validation.error);
      } else {
        checks.push(validation.check);
      }
    }
  }
  return { checks, errors, checksDir };
}

export function runRepoChecks({ repoRoot, changedFiles }) {
  const startedAt = Date.now();
  const { checks, errors } = loadRepoCheckDefinitions(repoRoot);
  if (checks.length === 0 && errors.length === 0) {
    return {
      status: "skipped",
      durationMs: Date.now() - startedAt,
      checks: [],
      errors: []
    };
  }
  const results = checks.map((check) => runSingleCheck(check, repoRoot, changedFiles));
  return {
    status: errors.length > 0 ? "failed" : "completed",
    durationMs: Date.now() - startedAt,
    checks: results,
    errors
  };
}
