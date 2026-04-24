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
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const normalized = path.posix.normalize(value.trim().replace(/\\/g, "/"));
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
  return text.split(/\r?\n/).length;
}

function readTextFile(repoRoot, relativePath) {
  const normalized = normalizeRepoPath(relativePath);
  if (!normalized) {
    return { ok: false, reason: "invalid repo-relative path" };
  }
  const absolutePath = path.resolve(repoRoot, normalized);
  const root = path.resolve(repoRoot);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    return { ok: false, reason: "path escapes repo root" };
  }
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return { ok: false, reason: "file is not available on disk" };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: "path is not a file" };
  }
  try {
    return { ok: true, text: fs.readFileSync(absolutePath, "utf8") };
  } catch {
    return { ok: false, reason: "file is not readable as utf8 text" };
  }
}

function extractAnchorCandidates(finding) {
  const text = [finding?.title, finding?.body, finding?.recommendation]
    .filter((value) => typeof value === "string")
    .join("\n");
  const candidates = [];
  for (const match of text.matchAll(/`([^`\n]{3,80})`/g)) {
    candidates.push(match[1].trim());
  }
  for (const match of text.matchAll(/\b[A-Za-z_][A-Za-z0-9_./:-]{4,80}\b/g)) {
    const token = match[0].trim();
    if (!COMMON_ANCHOR_WORDS.has(token.toLowerCase())) {
      candidates.push(token);
    }
  }
  return [...new Set(candidates)].slice(0, 12);
}

function getLineWindow(text, lineStart, lineEnd, radius = 5) {
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, Number.isInteger(lineStart) ? lineStart - radius : 1);
  const end = Math.min(lines.length, Number.isInteger(lineEnd) ? lineEnd + radius : lines.length);
  return lines.slice(start - 1, end).join("\n");
}

function containsKnownFalseReference(finding, knownFalseReferences) {
  const haystack = [
    finding?.file,
    finding?.title,
    finding?.body,
    finding?.recommendation
  ]
    .filter((value) => typeof value === "string")
    .join("\n")
    .toLowerCase();
  return knownFalseReferences.find((reference) => haystack.includes(reference.toLowerCase())) ?? null;
}

export function buildReviewValidationContext(reviewContext, options = {}) {
  return {
    repoRoot: reviewContext.repoRoot ?? reviewContext.cwd,
    changedFiles: new Set((reviewContext.changedFiles ?? []).map(normalizeRepoPath).filter(Boolean)),
    knownFalseReferences: options.knownFalseReferences ?? DEFAULT_KNOWN_FALSE_REFERENCES
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

  const knownFalse = containsKnownFalseReference(finding, context.knownFalseReferences);
  signals.push(
    makeSignal(
      "known_false_reference_absent",
      knownFalse ? "fail" : "pass",
      knownFalse ? `matched known false reference: ${knownFalse}` : undefined
    )
  );

  const fileText = normalizedFile ? readTextFile(context.repoRoot, normalizedFile) : { ok: false, reason: "invalid repo-relative path" };
  let lineHardFail = false;
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
  }

  let anchorSoftFail = false;
  if (!inTarget || !fileText.ok) {
    signals.push(makeSignal("anchor_literal_found", "skip", fileText.reason ?? "file is not in target"));
  } else {
    const candidates = extractAnchorCandidates(finding);
    if (candidates.length === 0) {
      signals.push(makeSignal("anchor_literal_found", "skip", "no stable anchor candidate in finding text"));
    } else {
      const window = getLineWindow(fileText.text, finding.line_start, finding.line_end);
      const matched = candidates.find((candidate) => window.includes(candidate));
      anchorSoftFail = !matched;
      signals.push(
        makeSignal(
          "anchor_literal_found",
          matched ? "pass" : "fail",
          matched ? `matched anchor: ${matched}` : `no candidate anchor found near cited lines: ${candidates.slice(0, 5).join(", ")}`
        )
      );
    }
  }

  let confidenceTier = "proposed";
  if (!inTarget || lineHardFail || knownFalse) {
    confidenceTier = "rejected";
  } else if (!anchorSoftFail) {
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
  if (!parsedResult?.parsed || parsedResult.failureMessage || parsedResult.parseError) {
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
