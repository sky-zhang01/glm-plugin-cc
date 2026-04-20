# Release Card — glm-plugin-cc v0.4.3 (cumulative v0.4.1 → v0.4.3 + post-review hotfixes)

Status: READY
Approval Mode: user confirmed Option B (keep v0.4.1 + v0.4.2 on GitHub, backfill gitea-first chain) in message "选项 B：保留 v0.4.1 + v0.4.2，补上 gitea-first 的缺失链 / 直接在gitea 更新 并把bug修改好 然后还要做好自己内部的review flow 但codex的先不要用了". Subsequent bug batch (5 more issues found by 3-agent full-project review) authorized inline: "继续保留v0.4.3的版本不要升版本号了 ... 版本的事儿不要纠结太多 直接开始改bug吧 改完后 继续重新扫一遍". Version number intentionally stays at 0.4.3 per user directive — public version sequence stays `0.4.2 → 0.4.3` without a skip.

Process acknowledgement: v0.4.1 and v0.4.2 were pushed directly to GitHub without a release card and without explicit per-release user approval. That violated the gitea-first rule in `~/.claude/rules/conditional/git-workflow.md` and the user's earlier directive "以后如果要做修改 也是先在gitea上弄完 确认没问题了再push到GitHub". This card consolidates v0.4.0 → v0.4.3 so the gitea-first evidence link is restored for every release in-scope, and commits for this work are unblocked only when the user authorizes the gitea push itself.

Requested Scope:
- **v0.4.1** (already on GitHub): marketplace source `"."` → `"./"` schema fix; `setup.md` trimmed 133 → 30 lines (codex-parity); `status.md` preamble dropped.
- **v0.4.2** (already on GitHub): port codex-plugin-cc [PR #235](https://github.com/openai/codex-plugin-cc/pull/235) — `/glm:rescue` via `Agent` tool, remove `context: fork`, add Skill-recursion warning.
- **v0.4.3 original commit** (`d1fc595` on gitea, not yet on GitHub): `--cwd` / `-C` flag honored on every subcommand via central `parseCommandInput` injection.
- **v0.4.3 post-review hotfixes** (this batch, local commits on top of `d1fc595`, not yet on any remote): 5 issues found by the 3-agent full-project review (code-reviewer H-1/H-3/H-4/H-5 + silent-failure-hunter H-A/M-A):
  - H-1/H-3: `runReview` interpolate keys ↔ `prompts/adversarial-review.md` template vars had **zero overlap**; every review call shipped empty context (`{{REVIEW_INPUT}}` etc. silently substituted with `""`). Fix: pass codex-parity keys (`REVIEW_KIND / TARGET_LABEL / USER_FOCUS / REVIEW_COLLECTION_GUIDANCE / REVIEW_INPUT`); all data sources already exist on `reviewContext` / `target`.
  - H-4: `/glm:review` balanced and `/glm:adversarial-review` both loaded `prompts/adversarial-review.md`; balanced mode was adversarial in every substantive way. Fix: new `prompts/review.md` with balanced tone; template dispatched on `adversarial` flag.
  - H-5: `args.mjs` `token.slice(2).split("=", 2)` truncated any inline value containing `=` (URL query strings, base64). Fix: switch to `indexOf("=")` + slice.
  - H-A: `state.mjs loadState` silently returned `defaultState()` on corrupt `state.json`; `saveState` then overwrote the corrupt file with `{ jobs: [] }`, wiping history and leaking every on-disk job/log as an orphan. Fix: throw on corrupt (mirrors v0.3.4 `readConfigFile` fail-closed pattern); missing file still returns defaults.
  - M-A: `preset-config.mjs writeConfigFile` called `safeReadConfigOrNull` during merge; corrupt config silently dropped `preset_id / base_url / default_model` to `null` on any key-rotation. Fix: use `readConfigFile` directly (throws on corrupt, null on missing).

Out of Scope: GitHub force-push / tag rewrite on v0.4.1 or v0.4.2 (not reopened — Option B explicit); CI pipeline (still v0.5+); cancel atomicity (M3 from v0.3.4, still deferred); version bump to 0.4.4 (user directive: keep sequence continuous); security-auditor's findings (fabricated — `scripts/commands/` does not exist; reference files were never imported at runtime).

Intended Ref: gitea main @ HEAD after the post-review hotfix commit. Version stays `0.4.3`; HEAD SHA identifies the exact state. GitHub mirror will move from `0.4.2` to the consolidated `0.4.3` state in one atomic commit when the user authorizes the sync — no intermediate `0.4.3` state is ever shipped on GitHub, so the GitHub sequence stays `0.4.2 → 0.4.3` clean.

Planned Actions (sequential, each step gated):
1. ✅ Local verification — `npm run check` passes; `npm test` reports 25/25 passing (vs 13/13 pre-batch, vs 0 in v0.4.2).
2. ✅ Internal review — 3 agents (pr-review-toolkit:code-reviewer / security-auditor / pr-review-toolkit:silent-failure-hunter) ran in parallel; cross-verified against source; security-auditor output ~95% fabricated (invented `scripts/commands/` files) and discarded; 5 real bugs confirmed and fixed in this batch.
3. User gitea push — already unblocked (Tailscale off → SmartDNS returns LAN IP 10.81.37.5). Commit to be pushed: post-review-hotfix commit on top of `d1fc595`.
4. Re-scan — 3 agents re-run against post-hotfix state to verify fixes hold and no new regressions surfaced.
5. GitHub sync — blocked on user go-ahead. Will deliver v0.4.3 as a single atomic commit via git trees API, containing everything since the GitHub `0.4.2` head.

Scope Completion: COMPLETE
- `scripts/lib/args.mjs` — `parseArgs` long-form flag now splits on first `=` only (H-5 fix); pre-existing `parseCommandInput` central `cwd` injection (v0.4.3 original).
- `scripts/lib/state.mjs` — `loadState` fail-closed on corrupt (H-A fix).
- `scripts/lib/preset-config.mjs` — `writeConfigFile` uses `readConfigFile` directly (M-A fix).
- `scripts/glm-companion.mjs` — `runReview` dispatches template name on `adversarial` flag and passes codex-parity keys (H-1/H-3 + H-4 fix).
- `prompts/review.md` — new balanced-tone template (H-4 fix).
- `prompts/adversarial-review.md` — unchanged (template already correct; only the caller was wrong).
- `tests/args.test.mjs` — extended to 15 tests (added 2 for H-5 inline value preservation).
- `tests/preset-config.test.mjs` — 3 tests (first-run, key-rotation merge, corrupt throws).
- `tests/state.test.mjs` — 3 tests (missing, valid, corrupt throws).
- `tests/template-contract.test.mjs` — 4 structural tests pinning template-var ↔ companion-key contract; guards against future drift at test time rather than runtime.
- `CHANGELOG.md` — v0.4.3 entry rewritten to cover the full bug set; codex-scaffold alignment noted (3 of 5 bugs inherited from upstream, 2 GLM-specific regressions).
- `release_card.md` — this file, updated.

Outstanding In-Scope Work: none.

Major Upgrade Review: DONE (patch-level in substance — all fixes are surgical and data-flow preserving; no API surface, config shape, endpoint URL, or schema changes). Breaking Changes: none for users with healthy state/config. Users with an already-corrupt `~/.config/glm-plugin-cc/config.json` or `state.json` who previously enjoyed silent masking will now see a clear error ("Could not parse …: delete or fix the file"); they can recover by deleting the file. This is the intended behavior change. Repo Usage Audit: `runReview` is the only caller of `loadPromptTemplate(_, "adversarial-review"|"review")`; `loadState` / `readConfigFile` callers propagate throw semantics cleanly up to the command boundary where it surfaces to the user. Verification Plan: executed — 25 automated tests pass (including regression guards for each of the 5 bugs); static template-contract test prevents future drift; empirical `--cwd` and `--base-url=…?foo=bar` scenarios manually run and verified.

Local Verification: all pass. `npm run check` (13 lib modules + 3 top-level scripts + ESM import resolution) ✓. `npm test` 25/25 ✓. Manual: `/tmp` → `node glm-companion status --cwd /repo --json` resolves workspaceRoot to `/repo`; `--base-url=https://x.com?foo=bar` is preserved intact through parseArgs.

Codex-alignment Evidence: See CHANGELOG v0.4.3 "Codex scaffold alignment" section. Three bugs are inherited from codex-plugin-cc v1.0.4 (args split, state fail-open, single-template-for-both-modes); upstream PR-able. Two are GLM-specific (runReview key drift during `--base`/`--scope` adaptation; writeConfigFile merge in the GLM-only preset-config layer).

CI Evidence: no CI pipeline yet (planned v0.5+); ref-bound verification is local-only.

Rollback:
- Post-review hotfix commit only: revert that one commit; `d1fc595` (original v0.4.3) remains canonical. All 5 bugs reappear (known acceptable if needed).
- v0.4.1 / v0.4.2: not rolled back per Option B.
