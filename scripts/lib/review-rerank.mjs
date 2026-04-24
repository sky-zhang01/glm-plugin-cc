function normalizeFindingSummary(finding = {}) {
  return {
    severity: typeof finding.severity === "string" ? finding.severity : null,
    title: typeof finding.title === "string" ? finding.title : null,
    file: typeof finding.file === "string" ? finding.file : null,
    line_start: Number.isInteger(finding.line_start) ? finding.line_start : null,
    line_end: Number.isInteger(finding.line_end) ? finding.line_end : null,
    confidence: typeof finding.confidence === "number" ? finding.confidence : null,
    confidence_tier: typeof finding.confidence_tier === "string" ? finding.confidence_tier : null
  };
}

function tierKey(tier) {
  if (tier === "cross-checked") return "cross_checked";
  if (tier === "deterministically-validated") return "deterministically_validated";
  if (tier === "rejected") return "rejected";
  return "proposed";
}

export function summarizeReviewResultForRerank(result) {
  const parsed = result?.parsed;
  const findings = Array.isArray(parsed?.findings) ? parsed.findings : [];
  const tierCounts = {
    proposed: 0,
    cross_checked: 0,
    deterministically_validated: 0,
    rejected: 0
  };
  for (const finding of findings) {
    tierCounts[tierKey(finding?.confidence_tier)] += 1;
  }
  return {
    verdict: typeof parsed?.verdict === "string" ? parsed.verdict : null,
    summary: typeof parsed?.summary === "string" ? parsed.summary : null,
    totalFindings: findings.length,
    tierCounts,
    findings: findings.map(normalizeFindingSummary)
  };
}

export function buildReflectionPrompt({ targetLabel, reviewMode, initialResult, validationPass, repoChecks }) {
  const initialParsed = initialResult?.parsed ?? null;
  const initialFindingCount = Array.isArray(initialParsed?.findings) ? initialParsed.findings.length : 0;
  return [
    "You are running an optional second-pass reflection/rerank for an already-parsed code review.",
    "",
    "Your job is to improve precision, not to broaden scope.",
    "Use the first-pass findings and local validation telemetry below.",
    "Drop findings that are weak, duplicated, unsupported, or too vague.",
    "Keep or sharpen findings that remain actionable and evidence-grounded.",
    "Do not add new findings unless they are directly implied by the first-pass material.",
    "Do not self-assign `confidence_tier` or `validation_signals`; the local pipeline will assign those after your response.",
    "Return the same review-output JSON shape: verdict, summary, findings, next_steps.",
    `Keep findings concise; output at most ${Math.max(initialFindingCount, 0)} finding(s).`,
    "",
    `Target: ${targetLabel ?? "unknown target"}`,
    `Mode: ${reviewMode ?? "review"}`,
    "",
    "First-pass parsed result:",
    "```json",
    JSON.stringify(initialParsed, null, 2),
    "```",
    "",
    "Local validation pass telemetry:",
    "```json",
    JSON.stringify(validationPass ?? null, null, 2),
    "```",
    "",
    "Repo-owned check output:",
    "```json",
    JSON.stringify(repoChecks ?? null, null, 2),
    "```"
  ].join("\n");
}

export function buildRerankPassMetadata({
  status,
  startedAtMs,
  completedAtMs,
  model,
  initialResult,
  finalResult,
  failureMessage
}) {
  const durationMs =
    Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)
      ? Math.max(0, completedAtMs - startedAtMs)
      : 0;
  const metadata = {
    status,
    durationMs,
    model: model ?? null,
    initial: summarizeReviewResultForRerank(initialResult),
    final: summarizeReviewResultForRerank(finalResult)
  };
  if (failureMessage) {
    metadata.failureMessage = String(failureMessage);
  }
  return metadata;
}

export function attachRerankMetadata(result, metadata) {
  return {
    ...result,
    rerank: metadata
  };
}
