#!/usr/bin/env node
// Advisory probe: when the PR is authored by one AI identity
// (claude-code or codex), look for independent review commentary from
// the *other* AI identity in the PR comment thread.
//
// Does not block merge. Prints one of:
//
//   OK       — PR author is human or cross-AI review is present
//   ADVISORY — PR from AI-A but no cross-review from AI-B yet
//   SKIP     — not enough environment (missing token or PR metadata)
//
// Works against compatible forge APIs — both expose the same issue-comments
// REST shape at /api/v1|/api/v3 /repos/{owner}/{name}/issues/{n}/comments.

const AI_IDENTITIES = ["claude-code", "codex"];

const REVIEW_SIGNALS = [
  /\bapprove(d|s)?\b/i,
  /\bLGTM\b/,
  /\blooks good\b/i,
  /\bship it\b/i,
  /\bno blocker/i,
  /\bno concern/i,
  /\bpass(es|ed)?\b/i,
  /\b(ok|okay) to merge\b/i,
  /\b同意\b|\bapprove\b/i,
  /\b可以合(并|入)\b/,
];

const CHALLENGE_SIGNALS = [
  /\bconcern/i,
  /\bblocker/i,
  /\bmust fix\b/i,
  /\brequest(ed)? change/i,
  /\bneeds fix/i,
  /\bquestion:/i,
  /\bpush ?back\b/i,
  /\bnit[:\s]/i,
];

const env = process.env;
const prNumber = env.PR_NUMBER;
const prAuthor = env.PR_AUTHOR;
const repoOwner = env.REPO_OWNER;
const repoName = env.REPO_NAME;
const serverUrl = env.SERVER_URL || "";
const token = env.GH_TOKEN || env.GITHUB_TOKEN;

function log(tag, msg) {
  console.log(`${tag} — ${msg}`);
}

function skip(reason) {
  log("SKIP", reason);
  process.exit(0);
}

if (!prNumber || !prAuthor || !repoOwner || !repoName) {
  skip("missing PR metadata");
}

if (!AI_IDENTITIES.includes(prAuthor)) {
  log("OK", `PR author '${prAuthor}' is not an AI identity — check skipped.`);
  process.exit(0);
}

const counterpart = AI_IDENTITIES.find((id) => id !== prAuthor);

const isGithub = /github\.com$/.test(new URL(serverUrl).hostname);
const apiBase = isGithub
  ? `https://api.github.com/repos/${repoOwner}/${repoName}`
  : `${serverUrl}/api/v1/repos/${repoOwner}/${repoName}`;

const commentsUrl = `${apiBase}/issues/${prNumber}/comments?per_page=100`;

try {
  const headers = {
    Accept: "application/json",
    "User-Agent": "glm-plugin-cc-ci",
  };
  if (token) headers.Authorization = `token ${token}`;
  const res = await fetch(commentsUrl, { headers });
  if (!res.ok) {
    skip(`comments fetch returned HTTP ${res.status} — advisory skipped`);
  }
  const comments = await res.json();
  if (!Array.isArray(comments)) {
    skip("comments response not an array — advisory skipped");
  }

  const fromCounterpart = comments.filter((c) => c.user?.login === counterpart);
  if (fromCounterpart.length === 0) {
    log(
      "ADVISORY",
      `PR #${prNumber} authored by '${prAuthor}' has no comment from '${counterpart}' yet.`
    );
    console.log(
      `          Human approver should either request a cross-AI review or` +
        ` merge explicitly.`
    );
    process.exit(0);
  }

  const reviewHits = fromCounterpart.filter((c) =>
    REVIEW_SIGNALS.some((re) => re.test(c.body || ""))
  );
  const challengeHits = fromCounterpart.filter((c) =>
    CHALLENGE_SIGNALS.some((re) => re.test(c.body || ""))
  );

  log(
    "OK",
    `'${counterpart}' posted ${fromCounterpart.length} comment(s) on PR #${prNumber} — ` +
      `${reviewHits.length} with review-signal, ${challengeHits.length} with challenge-signal.`
  );
  if (reviewHits.length === 0 && challengeHits.length === 0) {
    console.log(
      `          (advisory) '${counterpart}' replied but none of the comments contained an` +
        ` explicit approve/challenge signal — consider asking for a substantive review.`
    );
  }
} catch (err) {
  skip(`advisory check errored: ${err.message}`);
}
