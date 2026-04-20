# Security Policy

## Reporting a Vulnerability

Please report security issues privately — **do not open a public issue**.

- Preferred: open a private [Security Advisory](https://github.com/sky-zhang01/glm-plugin-cc/security/advisories/new) on the GitHub mirror.
- Fallback: open a minimal public issue saying "security report — please contact privately", and a maintainer will coordinate a private channel.

Please include:

- Affected version / commit
- Steps to reproduce
- Impact / realistic attack scenario
- Logs or screenshots (redact any secrets before sharing)

Do not disclose publicly (issues, discussions, social media) before a fix is released.

## Supported Versions

Only the latest minor release receives security patches. Currently: **v0.4.x**.

## Scope

In scope:

- Secret mishandling in `scripts/lib/*` (API-key storage, logs, error output, job records).
- Path traversal in job / state / log file handling.
- Prompt injection or tool misuse via slash-command `$ARGUMENTS`.
- HTTPS enforcement bypass in endpoint resolution.
- Vision-model routing bypass.

Out of scope:

- Issues in the upstream 智谱 BigModel API or the Z.AI endpoint.
- Issues in the [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) scaffold — report upstream.
- Misuse of a valid API key that the user themselves leaked (e.g. committing it to a public repo, pasting it into a chat log).

## Response time

Best-effort from a solo maintainer; no formal SLA. Expect initial acknowledgment within 7 days.
