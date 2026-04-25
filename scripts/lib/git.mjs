import fs from "node:fs";
import path from "node:path";

import { isProbablyText } from "./fs.mjs";
import { formatCommandFailure, runCommand, runCommandChecked } from "./process.mjs";

const MAX_UNTRACKED_BYTES = 24 * 1024;
// PA1 (v0.4.8) raised these from 2 / 256 KB. Pre-PA1, exceeding the budget
// silently fell back to a "self-collect" mode that shipped only commit log,
// diff stat, and changed-file list to the model. The remote BigModel runtime
// has no git access, so self-collect produced honest refusals (review mode)
// or fabricated whole-file findings (adversarial mode). PA1 covers normal PRs
// (≤50 files / ≤384 KB ≈ 110K tokens, leaving ~18K-token headroom under
// 128K-token glm-4.6/5.1 input contexts) and fails closed beyond that. Override
// per call via collectReviewContext options or companion --max-diff-* flags.
// See docs/plans/2026-04-25-pa1-review-context-fix-design.md.
const DEFAULT_INLINE_DIFF_MAX_FILES = 50;
const DEFAULT_INLINE_DIFF_MAX_BYTES = 384 * 1024;
const INLINE_DIFF_COLLECTION_GUIDANCE = "Use the repository context below as primary evidence.";

/**
 * Thrown by `collectReviewContext` when the diff exceeds the inline-diff
 * budget. Replaces the pre-PA1 silent self-collect fallback. Callers (e.g.
 * glm-companion review entry) catch this and surface an actionable failure
 * shape rather than shipping a stat-only review the model cannot act on.
 */
export class ReviewContextDiffTooLargeError extends Error {
  constructor({ fileCount, diffBytes, maxInlineFiles, maxInlineDiffBytes }) {
    const reasons = [];
    if (fileCount > maxInlineFiles) reasons.push(`file count ${fileCount} > ${maxInlineFiles}`);
    if (diffBytes > maxInlineDiffBytes) reasons.push(`diff bytes ${diffBytes} > ${maxInlineDiffBytes}`);
    const reasonText = reasons.length > 0 ? reasons.join(" and ") : "size limit";
    super(
      `Review diff exceeds inline budget (${reasonText}). ` +
        "Narrow the scope (pass --base <closer-ref> or split the change), or raise " +
        "the limits with --max-diff-files <N> / --max-diff-bytes <BYTES>."
    );
    this.name = "ReviewContextDiffTooLargeError";
    this.kind = "DIFF_TOO_LARGE";
    this.fileCount = fileCount;
    this.diffBytes = diffBytes;
    this.maxInlineFiles = maxInlineFiles;
    this.maxInlineDiffBytes = maxInlineDiffBytes;
  }
}

function git(cwd, args, options = {}) {
  return runCommand("git", args, { cwd, ...options });
}

function gitChecked(cwd, args, options = {}) {
  return runCommandChecked("git", args, { cwd, ...options });
}

function listUniqueFiles(...groups) {
  return [...new Set(groups.flat().filter(Boolean))].sort();
}

function parseDiffNameStatusEntries(output) {
  const entries = [];
  for (const line of output.trim().split("\n").filter(Boolean)) {
    const [status, firstPath, secondPath] = line.split("\t");
    if ((status.startsWith("R") || status.startsWith("C")) && secondPath) {
      entries.push([firstPath, secondPath]);
    } else if (firstPath) {
      entries.push([firstPath]);
    }
  }
  return entries;
}

function parseDiffNameStatusEntriesZ(output) {
  const records = output.split("\0").filter(Boolean);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const status = records[index];
    const firstPath = records[index + 1];
    if (!firstPath) {
      break;
    }
    if (status.startsWith("R") || status.startsWith("C")) {
      const secondPath = records[index + 2];
      if (secondPath) {
        entries.push([firstPath, secondPath]);
        index += 2;
      } else {
        entries.push([firstPath]);
        index += 1;
      }
    } else {
      entries.push([firstPath]);
      index += 1;
    }
  }
  return entries;
}

function withNullTerminatedNameStatus(args) {
  const index = args.indexOf("--name-status");
  if (index === -1 || args.includes("-z")) {
    return args;
  }
  return [...args.slice(0, index + 1), "-z", ...args.slice(index + 1)];
}

function listDiffNameStatusFiles(cwd, args) {
  return listUniqueFiles(readDiffNameStatusEntries(cwd, args).flat());
}

function readDiffNameStatusEntries(cwd, args) {
  const zArgs = withNullTerminatedNameStatus(args);
  const output = gitChecked(cwd, zArgs).stdout;
  return zArgs.includes("-z") ? parseDiffNameStatusEntriesZ(output) : parseDiffNameStatusEntries(output);
}

function nameStatusEntryKey(entry) {
  return entry.join("\0");
}

function countUniqueNameStatusEntries(...entryGroups) {
  return new Set(entryGroups.flat().map(nameStatusEntryKey)).size;
}

function countDiffNameStatusRecords(cwd, args) {
  return readDiffNameStatusEntries(cwd, args).length;
}

function normalizeMaxInlineFiles(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_INLINE_DIFF_MAX_FILES;
  }
  return Math.floor(parsed);
}

function normalizeMaxInlineDiffBytes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_INLINE_DIFF_MAX_BYTES;
  }
  return Math.floor(parsed);
}

function measureGitOutputBytes(cwd, args, maxBytes) {
  const result = git(cwd, args, { maxBuffer: maxBytes + 1 });
  if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === "ENOBUFS") {
    return maxBytes + 1;
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return Buffer.byteLength(result.stdout, "utf8");
}

function measureCombinedGitOutputBytes(cwd, argSets, maxBytes) {
  let totalBytes = 0;
  for (const args of argSets) {
    const remainingBytes = maxBytes - totalBytes;
    if (remainingBytes < 0) {
      return maxBytes + 1;
    }
    totalBytes += measureGitOutputBytes(cwd, args, remainingBytes);
    if (totalBytes > maxBytes) {
      return totalBytes;
    }
  }
  return totalBytes;
}

function buildBranchComparison(cwd, baseRef) {
  const mergeBase = gitChecked(cwd, ["merge-base", "HEAD", baseRef]).stdout.trim();
  return {
    mergeBase,
    commitRange: `${mergeBase}..HEAD`,
    reviewRange: `${baseRef}...HEAD`
  };
}

export function ensureGitRepository(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  const errorCode = result.error && "code" in result.error ? result.error.code : null;
  if (errorCode === "ENOENT") {
    throw new Error("git is not installed. Install Git and retry.");
  }
  if (result.status !== 0) {
    throw new Error("This command must run inside a Git repository.");
  }
  return result.stdout.trim();
}

export function getRepoRoot(cwd) {
  return gitChecked(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim();
}

export function detectDefaultBranch(cwd) {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const remoteHead = symbolic.stdout.trim();
    if (remoteHead.startsWith("refs/remotes/origin/")) {
      return remoteHead.replace("refs/remotes/origin/", "");
    }
  }

  const candidates = ["main", "master", "trunk"];
  for (const candidate of candidates) {
    const local = git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
    if (local.status === 0) {
      return candidate;
    }
    const remote = git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]);
    if (remote.status === 0) {
      return `origin/${candidate}`;
    }
  }

  throw new Error("Unable to detect the repository default branch. Pass --base <ref> or use --scope working-tree.");
}

export function getCurrentBranch(cwd) {
  return gitChecked(cwd, ["branch", "--show-current"]).stdout.trim() || "HEAD";
}

export function getWorkingTreeState(cwd) {
  const stagedEntries = readDiffNameStatusEntries(cwd, ["diff", "--cached", "--name-status"]);
  const unstagedEntries = readDiffNameStatusEntries(cwd, ["diff", "--name-status"]);
  const staged = listUniqueFiles(stagedEntries.flat());
  const unstaged = listUniqueFiles(unstagedEntries.flat());
  const untracked = gitChecked(cwd, ["ls-files", "--others", "--exclude-standard"]).stdout.trim().split("\n").filter(Boolean);

  return {
    staged,
    unstaged,
    untracked,
    changeCount: countUniqueNameStatusEntries(stagedEntries, unstagedEntries) + untracked.length,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0
  };
}

export function resolveReviewTarget(cwd, options = {}) {
  ensureGitRepository(cwd);

  const requestedScope = options.scope ?? "auto";
  const baseRef = options.base ?? null;
  const state = getWorkingTreeState(cwd);
  const supportedScopes = new Set(["auto", "working-tree", "branch"]);

  if (baseRef) {
    return {
      mode: "branch",
      label: `branch diff against ${baseRef}`,
      baseRef,
      explicit: true
    };
  }

  if (requestedScope === "working-tree") {
    return {
      mode: "working-tree",
      label: "working tree diff",
      explicit: true
    };
  }

  if (!supportedScopes.has(requestedScope)) {
    throw new Error(
      `Unsupported review scope "${requestedScope}". Use one of: auto, working-tree, branch, or pass --base <ref>.`
    );
  }

  if (requestedScope === "branch") {
    const detectedBase = detectDefaultBranch(cwd);
    return {
      mode: "branch",
      label: `branch diff against ${detectedBase}`,
      baseRef: detectedBase,
      explicit: true
    };
  }

  if (state.isDirty) {
    return {
      mode: "working-tree",
      label: "working tree diff",
      explicit: false
    };
  }

  const detectedBase = detectDefaultBranch(cwd);
  return {
    mode: "branch",
    label: `branch diff against ${detectedBase}`,
    baseRef: detectedBase,
    explicit: false
  };
}

function formatSection(title, body) {
  return [`## ${title}`, "", body.trim() ? body.trim() : "(none)", ""].join("\n");
}

function formatUntrackedFile(cwd, relativePath) {
  const absolutePath = path.join(cwd, relativePath);
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return `### ${relativePath}\n(skipped: broken symlink or unreadable file)`;
  }
  if (stat.isDirectory()) {
    return `### ${relativePath}\n(skipped: directory)`;
  }
  if (stat.size > MAX_UNTRACKED_BYTES) {
    return `### ${relativePath}\n(skipped: ${stat.size} bytes exceeds ${MAX_UNTRACKED_BYTES} byte limit)`;
  }

  let buffer;
  try {
    buffer = fs.readFileSync(absolutePath);
  } catch {
    return `### ${relativePath}\n(skipped: broken symlink or unreadable file)`;
  }
  if (!isProbablyText(buffer)) {
    return `### ${relativePath}\n(skipped: binary file)`;
  }

  return [`### ${relativePath}`, "```", buffer.toString("utf8").trimEnd(), "```"].join("\n");
}

function formatUntrackedFiles(cwd, untrackedFiles) {
  return untrackedFiles.map((file) => formatUntrackedFile(cwd, file)).join("\n\n");
}

function collectWorkingTreeContext(cwd, state) {
  const status = gitChecked(cwd, ["status", "--short", "--untracked-files=all"]).stdout.trim();
  const changedFiles = listUniqueFiles(state.staged, state.unstaged, state.untracked);
  const stagedDiff = gitChecked(cwd, ["diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff"]).stdout;
  const unstagedDiff = gitChecked(cwd, ["diff", "--binary", "--no-ext-diff", "--submodule=diff"]).stdout;
  const untrackedBody = formatUntrackedFiles(cwd, state.untracked);
  const parts = [
    formatSection("Git Status", status),
    formatSection("Staged Diff", stagedDiff),
    formatSection("Unstaged Diff", unstagedDiff),
    formatSection("Untracked Files", untrackedBody)
  ];

  return {
    mode: "working-tree",
    summary: `Reviewing ${state.staged.length} staged, ${state.unstaged.length} unstaged, and ${state.untracked.length} untracked file(s).`,
    content: parts.join("\n"),
    changedFiles
  };
}

function collectBranchContext(cwd, baseRef, options = {}) {
  const comparison = options.comparison ?? buildBranchComparison(cwd, baseRef);
  const currentBranch = getCurrentBranch(cwd);
  const changedFiles = listDiffNameStatusFiles(cwd, ["diff", "--name-status", comparison.commitRange]);
  const logOutput = gitChecked(cwd, ["log", "--oneline", "--decorate", comparison.commitRange]).stdout.trim();
  const diffStat = gitChecked(cwd, ["diff", "--stat", comparison.commitRange]).stdout.trim();
  const branchDiff = gitChecked(cwd, ["diff", "--binary", "--no-ext-diff", "--submodule=diff", comparison.commitRange]).stdout;

  return {
    mode: "branch",
    summary: `Reviewing branch ${currentBranch} against ${baseRef} from merge-base ${comparison.mergeBase}.`,
    content: [
      formatSection("Commit Log", logOutput),
      formatSection("Diff Stat", diffStat),
      formatSection("Branch Diff", branchDiff)
    ].join("\n"),
    changedFiles,
    comparison
  };
}

export function collectReviewContext(cwd, target, options = {}) {
  const repoRoot = getRepoRoot(cwd);
  const currentBranch = getCurrentBranch(repoRoot);
  const maxInlineFiles = normalizeMaxInlineFiles(options.maxInlineFiles);
  const maxInlineDiffBytes = normalizeMaxInlineDiffBytes(options.maxInlineDiffBytes);

  let details;
  let diffBytes;
  let fileCount;

  if (target.mode === "working-tree") {
    const state = getWorkingTreeState(repoRoot);
    const untrackedBody = formatUntrackedFiles(repoRoot, state.untracked);
    diffBytes = measureCombinedGitOutputBytes(
      repoRoot,
      [
        ["diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff"],
        ["diff", "--binary", "--no-ext-diff", "--submodule=diff"]
      ],
      maxInlineDiffBytes
    );
    diffBytes += Buffer.byteLength(untrackedBody, "utf8");
    fileCount = state.changeCount;
    if (fileCount > maxInlineFiles || diffBytes > maxInlineDiffBytes) {
      throw new ReviewContextDiffTooLargeError({
        fileCount,
        diffBytes,
        maxInlineFiles,
        maxInlineDiffBytes
      });
    }
    details = collectWorkingTreeContext(repoRoot, state);
  } else {
    const comparison = buildBranchComparison(repoRoot, target.baseRef);
    fileCount = countDiffNameStatusRecords(repoRoot, ["diff", "--name-status", comparison.commitRange]);
    diffBytes = measureGitOutputBytes(
      repoRoot,
      ["diff", "--binary", "--no-ext-diff", "--submodule=diff", comparison.commitRange],
      maxInlineDiffBytes
    );
    if (fileCount > maxInlineFiles || diffBytes > maxInlineDiffBytes) {
      throw new ReviewContextDiffTooLargeError({
        fileCount,
        diffBytes,
        maxInlineFiles,
        maxInlineDiffBytes
      });
    }
    details = collectBranchContext(repoRoot, target.baseRef, { comparison });
  }

  return {
    cwd: repoRoot,
    repoRoot,
    branch: currentBranch,
    target,
    fileCount: details.changedFiles.length,
    diffBytes,
    inputMode: "inline-diff",
    collectionGuidance: INLINE_DIFF_COLLECTION_GUIDANCE,
    ...details
  };
}
