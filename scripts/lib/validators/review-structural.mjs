import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_KNOWN_FALSE_REFERENCES = [
  "reference_runtime",
  "reference_runtime.py",
  "governance.py",
  "workflow_governor"
];

const COMMON_ANCHOR_WORDS = new Set([
  "about",
  "after",
  "against",
  "because",
  "before",
  "between",
  "change",
  "changes",
  "could",
  "error",
  "file",
  "finding",
  "function",
  "instead",
  "issue",
  "line",
  "lines",
  "missing",
  "should",
  "there",
  "these",
  "this",
  "through",
  "value",
  "would"
]);

function normalizeRepoPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.trim().length === 0) {
    return null;
  }
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.posix.isAbsolute(normalized)
  ) {
    return null;
  }
  return normalized;
}

function makeSignal(kind, result, artifact) {
  const signal = { kind, result };
  if (artifact) {
    signal.artifact = artifact;
  }
  return signal;
}

function countLines(text) {
  if (text === "") return 0;
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.length;
}

function isInsidePath(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function readTextFile(repoRoot, relativePath) {
  const normalized = normalizeRepoPath(relativePath);
  if (!normalized) {
    return { ok: false, reason: "invalid repo-relative path" };
  }
  const absolutePath = path.resolve(repoRoot, normalized);
  const root = path.resolve(repoRoot);
  if (!isInsidePath(absolutePath, root)) {
    return { ok: false, reason: "path escapes repo root" };
  }
  let realRoot;
  let realPath;
  try {
    realRoot = fs.realpathSync.native(root);
    realPath = fs.realpathSync.native(absolutePath);
  } catch {
    return { ok: false, reason: "file is not available on disk" };
  }
  if (!isInsidePath(realPath, realRoot)) {
    return { ok: false, reason: "path escapes repo root" };
  }
  let stat;
  try {
    stat = fs.statSync(realPath);
  } catch {
    return { ok: false, reason: "file is not available on disk" };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: "path is not a file" };
  }
  try {
    return { ok: true, text: fs.readFileSync(realPath, "utf8") };
  } catch {
    return { ok: false, reason: "file is not readable as utf8 text" };
  }
}

function readTextFileFromGitRef(repoRoot, relativePath, ref) {
  const normalized = normalizeRepoPath(relativePath);
  if (!normalized) {
    return { ok: false, reason: "invalid repo-relative path" };
  }
  const result = spawnSync("git", ["show", `${ref}:${normalized}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0 || result.error) {
    return { ok: false, reason: "file is not available in reviewed ref" };
  }
  return { ok: true, text: result.stdout ?? "" };
}

function readReviewTextFile(context, relativePath) {
  if (Array.isArray(context.readRefs) && context.readRefs.length > 0) {
    let lastFailure = null;
    for (const ref of context.readRefs) {
      const result = readTextFileFromGitRef(context.repoRoot, relativePath, ref);
      if (result.ok) {
        return result;
      }
      lastFailure = result;
    }
    return lastFailure ?? { ok: false, reason: "file is not available in reviewed refs" };
  }
  return context.readRef
    ? readTextFileFromGitRef(context.repoRoot, relativePath, context.readRef)
    : readTextFile(context.repoRoot, relativePath);
}

function extractAnchorCandidates(finding) {
  const text = [finding?.title, finding?.body, finding?.recommendation]
    .filter((value) => typeof value === "string")
    .join("\n");
  const candidates = [];
  for (const match of text.matchAll(/`([^`\n]{3,80})`/g)) {
    candidates.push({ value: match[1].trim(), explicit: true });
  }
  for (const match of text.matchAll(/\b[A-Za-z_][A-Za-z0-9_./:-]{4,80}\b/g)) {
    const token = match[0].trim();
    if (!COMMON_ANCHOR_WORDS.has(token.toLowerCase())) {
      candidates.push({ value: token, explicit: false });
    }
  }
  const seen = new Set();
  const unique = [];
  for (const candidate of candidates) {
    if (!candidate.value || seen.has(candidate.value)) {
      continue;
    }
    seen.add(candidate.value);
    unique.push(candidate);
  }
  return unique.slice(0, 12);
}

function getLineWindow(text, lineStart, lineEnd, radius = 5) {
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, Number.isInteger(lineStart) ? lineStart - radius : 1);
  const end = Math.min(lines.length, Number.isInteger(lineEnd) ? lineEnd + radius : lines.length);
  return lines.slice(start - 1, end).join("\n");
}

function findKnownFalseReferences(finding, knownFalseReferences) {
  const haystack = [
    finding?.title,
    finding?.body,
    finding?.recommendation
  ]
    .filter((value) => typeof value === "string")
    .join("\n")
    .toLowerCase();
  return knownFalseReferences.filter((reference) => containsReferenceToken(haystack, reference));
}

function isReferenceChar(value) {
  return typeof value === "string" && /^[A-Za-z0-9_./:-]$/.test(value);
}

function containsReferenceToken(text, reference) {
  const haystack = String(text ?? "").toLowerCase();
  const needle = String(reference ?? "").toLowerCase();
  if (!needle) {
    return false;
  }
  const needleIsPath = needle.includes("/");
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const before = haystack[index - 1];
    const after = haystack[index + needle.length];
    const beforeOk = !isReferenceChar(before) || (!needleIsPath && before === "/");
    const afterOk = !isReferenceChar(after) || (!needleIsPath && after === "/");
    if (beforeOk && afterOk) {
      return true;
    }
    index = haystack.indexOf(needle, index + needle.length);
  }
  return false;
}

function isSameReference(left, right) {
  return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
}

function isLocalReferencePath(reference, normalizedFile) {
  const known = String(reference ?? "").toLowerCase();
  const file = String(normalizedFile ?? "").toLowerCase();
  return Boolean(known && (file === known || path.posix.basename(file) === known));
}

export function buildReviewValidationContext(reviewContext, options = {}) {
  const readRefs = options.readRefs ??
    (options.readRef
      ? [options.readRef]
      : reviewContext.mode === "branch"
      ? ["HEAD", reviewContext.comparison?.mergeBase].filter(Boolean)
      : null);
  return {
    repoRoot: reviewContext.repoRoot ?? reviewContext.cwd,
    changedFiles: new Set((reviewContext.changedFiles ?? []).map(normalizeRepoPath).filter(Boolean)),
    knownFalseReferences: options.knownFalseReferences ?? DEFAULT_KNOWN_FALSE_REFERENCES,
    readRef: options.readRef ?? (Array.isArray(readRefs) ? readRefs[0] : null),
    readRefs
  };
}

export function validateReviewFinding(finding, context) {
  const signals = [];
  const normalizedFile = normalizeRepoPath(finding?.file);
  const inTarget = Boolean(normalizedFile && context.changedFiles.has(normalizedFile));
  signals.push(
    makeSignal(
      "file_in_target",
      inTarget ? "pass" : "fail",
      inTarget ? normalizedFile : `${finding?.file ?? "(missing)"} is not in the reviewed target set`
    )
  );

  const knownFalseReferences = findKnownFalseReferences(finding, context.knownFalseReferences);

  const fileText = normalizedFile ? readReviewTextFile(context, normalizedFile) : { ok: false, reason: "invalid repo-relative path" };
  let lineHardFail = false;
  let lineRangeResult = "skip";
  if (!inTarget || !fileText.ok) {
    signals.push(makeSignal("line_range_in_file", "skip", fileText.reason ?? "file is not in target"));
  } else {
    const lineCount = countLines(fileText.text);
    const lineStart = finding?.line_start;
    const lineEnd = finding?.line_end;
    const saneRange =
      Number.isInteger(lineStart) &&
      Number.isInteger(lineEnd) &&
      lineStart >= 1 &&
      lineEnd >= lineStart &&
      lineEnd <= lineCount;
    lineHardFail = !saneRange;
    signals.push(
      makeSignal(
        "line_range_in_file",
        saneRange ? "pass" : "fail",
        saneRange ? `lines ${lineStart}-${lineEnd} within ${lineCount}` : `lines ${lineStart}-${lineEnd} outside 1-${lineCount}`
      )
    );
    lineRangeResult = saneRange ? "pass" : "fail";
  }

  let anchorSoftFail = false;
  let anchorResult = "skip";
  let matchedAnchor = null;
  let lineWindow = "";
  if (!inTarget || !fileText.ok) {
    signals.push(makeSignal("anchor_literal_found", "skip", fileText.reason ?? "file is not in target"));
  } else {
    const candidates = extractAnchorCandidates(finding);
    const explicitCandidates = candidates.filter((candidate) => candidate.explicit);
    if (explicitCandidates.length === 0) {
      signals.push(makeSignal("anchor_literal_found", "skip", "no stable anchor candidate in finding text"));
    } else {
      lineWindow = getLineWindow(fileText.text, finding.line_start, finding.line_end);
      const matched = explicitCandidates.find((candidate) => containsReferenceToken(lineWindow, candidate.value));
      anchorSoftFail = !matched;
      anchorResult = matched ? "pass" : "fail";
      matchedAnchor = matched?.value ?? null;
      signals.push(
        makeSignal(
          "anchor_literal_found",
          matched ? "pass" : "fail",
          matched
            ? `matched anchor: ${matched.value}`
            : `no explicit anchor found near cited lines: ${explicitCandidates.map((candidate) => candidate.value).slice(0, 5).join(", ")}`
        )
      );
    }
  }

  if (lineWindow === "" && lineRangeResult === "pass" && fileText.ok) {
    lineWindow = getLineWindow(fileText.text, finding.line_start, finding.line_end);
  }
  const locallyPresentKnownFalseReferences = knownFalseReferences.filter((reference) =>
    Boolean(
      (inTarget && isLocalReferencePath(reference, normalizedFile)) ||
        (lineRangeResult === "pass" &&
          (isSameReference(reference, matchedAnchor) || containsReferenceToken(lineWindow, reference)))
    )
  );
  const missingKnownFalseReferences = knownFalseReferences.filter(
    (reference) => !locallyPresentKnownFalseReferences.includes(reference)
  );
  const knownFalseHardFail = missingKnownFalseReferences.length > 0;
  signals.splice(
    1,
    0,
    makeSignal(
      "known_false_reference_absent",
      knownFalseHardFail ? "fail" : "pass",
      knownFalseHardFail
        ? `matched known false reference: ${missingKnownFalseReferences.join(", ")}`
        : knownFalseReferences.length > 0
          ? `known false reference is locally present: ${knownFalseReferences.join(", ")}`
          : undefined
    )
  );

  let confidenceTier = "proposed";
  if (!inTarget || lineHardFail || knownFalseHardFail) {
    confidenceTier = "rejected";
  } else if (lineRangeResult === "pass" && anchorResult === "pass" && !anchorSoftFail) {
    confidenceTier = "cross-checked";
  }

  return {
    ...finding,
    confidence_tier: confidenceTier,
    validation_signals: signals
  };
}

export function validateStructuralReviewResult(parsedResult, context) {
  const startedAt = Date.now();
  if (
    !parsedResult?.parsed ||
    parsedResult.failureMessage ||
    parsedResult.parseError ||
    !Array.isArray(parsedResult.parsed.findings)
  ) {
    return {
      result: parsedResult,
      pass: {
        status: "skipped",
        durationMs: Date.now() - startedAt,
        reason: "no valid parsed review payload",
        totalFindings: 0,
        tierCounts: { proposed: 0, cross_checked: 0, deterministically_validated: 0, rejected: 0 },
        signalCounts: { pass: 0, fail: 0, skip: 0 }
      }
    };
  }

  const findings = parsedResult.parsed.findings.map((finding) => validateReviewFinding(finding, context));
  const tierCounts = { proposed: 0, cross_checked: 0, deterministically_validated: 0, rejected: 0 };
  const signalCounts = { pass: 0, fail: 0, skip: 0 };
  for (const finding of findings) {
    if (finding.confidence_tier === "cross-checked") {
      tierCounts.cross_checked += 1;
    } else if (finding.confidence_tier === "deterministically-validated") {
      tierCounts.deterministically_validated += 1;
    } else if (finding.confidence_tier === "rejected") {
      tierCounts.rejected += 1;
    } else {
      tierCounts.proposed += 1;
    }
    for (const signal of finding.validation_signals ?? []) {
      if (signal.result in signalCounts) {
        signalCounts[signal.result] += 1;
      }
    }
  }

  return {
    result: {
      ...parsedResult,
      validationApplied: true,
      parsed: {
        ...parsedResult.parsed,
        findings
      }
    },
    pass: {
      status: "completed",
      durationMs: Date.now() - startedAt,
      totalFindings: findings.length,
      tierCounts,
      signalCounts
    }
  };
}
