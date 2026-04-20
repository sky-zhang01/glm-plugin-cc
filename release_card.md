# Release Card — glm-plugin-cc v0.4.3 (cumulative v0.4.1 → v0.4.3 + post-review hotfixes)

Status: READY
Approval Mode: user confirmed Option B (keep v0.4.1 + v0.4.2 on GitHub, backfill gitea-first chain) in message "选项 B：保留 v0.4.1 + v0.4.2，补上 gitea-first 的缺失链 / 直接在gitea 更新 并把bug修改好 然后还要做好自己内部的review flow 但codex的先不要用了". Subsequent bug batch (5 more issues found by 3-agent full-project review) authorized inline: "继续保留v0.4.3的版本不要升版本号了 ... 版本的事儿不要纠结太多 直接开始改bug吧 改完后 继续重新扫一遍". Bundle C (7 more issues found by round-2 review) authorized inline: "Bundle C（全部）". Bundle D3+ (9 more issues + test-coverage backfills found by round-3 review using Anthropic-official agents after retiring the in-house `security-auditor`) authorized inline: "Bundle D3（D2 + 完整）". Version number intentionally stays at 0.4.3 per user directive — public version sequence stays `0.4.2 → 0.4.3` without a skip.

Process acknowledgement: v0.4.1 and v0.4.2 were pushed directly to GitHub without a release card and without explicit per-release user approval. That violated the gitea-first rule in `~/.claude/rules/conditional/git-workflow.md` and the user's earlier directive "以后如果要做修改 也是先在gitea上弄完 确认没问题了再push到GitHub". This card consolidates v0.4.0 → v0.4.3 so the gitea-first evidence link is restored for every release in-scope, and commits for this work are unblocked only when the user authorizes the gitea push itself.

Requested Scope:
- **v0.4.1** (already on GitHub): marketplace source `"."` → `"./"` schema fix; `setup.md` trimmed 133 → 30 lines (codex-parity); `status.md` preamble dropped.
- **v0.4.2** (already on GitHub): port codex-plugin-cc [PR #235](https://github.com/openai/codex-plugin-cc/pull/235) — `/glm:rescue` via `Agent` tool, remove `context: fork`, add Skill-recursion warning.
- **v0.4.3 original commit** (`d1fc595` on gitea, not yet on GitHub): `--cwd` / `-C` flag honored on every subcommand via central `parseCommandInput` injection.
- **v0.4.3 post-review hotfixes first pass** (local commits on top of `d1fc595`): 5 issues found by the 3-agent full-project review (code-reviewer H-1/H-3/H-4/H-5 + silent-failure-hunter H-A/M-A):
  - H-1/H-3: `runReview` interpolate keys ↔ `prompts/adversarial-review.md` template vars had **zero overlap**; every review call shipped empty context (`{{REVIEW_INPUT}}` etc. silently substituted with `""`). Fix: pass codex-parity keys (`REVIEW_KIND / TARGET_LABEL / USER_FOCUS / REVIEW_COLLECTION_GUIDANCE / REVIEW_INPUT`); all data sources already exist on `reviewContext` / `target`.
  - H-4: `/glm:review` balanced and `/glm:adversarial-review` both loaded `prompts/adversarial-review.md`; balanced mode was adversarial in every substantive way. Fix: new `prompts/review.md` with balanced tone; template dispatched on `adversarial` flag.
  - H-5: `args.mjs` `token.slice(2).split("=", 2)` truncated any inline value containing `=` (URL query strings, base64). Fix: switch to `indexOf("=")` + slice.
  - H-A: `state.mjs loadState` silently returned `defaultState()` on corrupt `state.json`; `saveState` then overwrote the corrupt file with `{ jobs: [] }`, wiping history and leaking every on-disk job/log as an orphan. Fix: throw on corrupt (mirrors v0.3.4 `readConfigFile` fail-closed pattern); missing file still returns defaults.
  - M-A: `preset-config.mjs writeConfigFile` called `safeReadConfigOrNull` during merge; corrupt config silently dropped `preset_id / base_url / default_model` to `null` on any key-rotation. Fix: use `readConfigFile` directly (throws on corrupt, null on missing).
- **v0.4.3 post-review hotfixes second pass — Bundle C** (commits `c8295d6` on gitea): 7 issues found by round-2 3-agent review (code-reviewer I-1/I-2/m-1/m-2/m-3 + silent-failure-hunter MED-1/MED-2/MED-3; security-auditor round-2 discarded — 100% fabricated):
  - **I-1** (regression from our first-pass H-A fix): `buildSetupReport:179 getConfig(workspaceRoot)` was unwrapped. After H-A made `loadState` throw on corrupt state.json, `/glm:setup` crashed before rendering the recovery guidance — the exact command the user would run to recover. Fix: wrap the read, expose `report.state.error`, add fix hint to `nextSteps`.
  - **MED-1**: `safeReadConfigOrNull` was left defined after the first-pass M-A fix (only referenced in a comment), leaving the regression vector open. Fix: deleted entirely + structural test guard.
  - **MED-2**: `readJobFile` threw bare `SyntaxError` with no filename when a job file was corrupt — `/glm:result <id>` gave the user no clue which file to delete. Fix: mirror the `loadState` / `readConfigFile` actionable-error pattern; `readStoredJobOrNull` inherits the improvement.
  - **MED-3 / m-2**: `safeReadSchema` silently fell back to a hard-coded verdict enum (`ready|needs_fixes|blocked`) that didn't match the shipped schema (`approve|needs-attention`), shipping a drifted vocabulary to GLM whenever the shipped schema was missing/corrupt. Fix: remove the wrapper, always load via `readOutputSchema` (fail-closed) + structural test guard against the drifted string.
  - **m-3**: `normalizeReviewFinding` dropped the schema-required `confidence` field from rendered output, so every finding lost its confidence signal in the terminal. Fix: preserve valid `[0, 1]` values and render as ` · conf 0.xx` suffix on the severity prefix.
  - **I-2**: `target.base` / `target.scope` references at `glm-companion.mjs:157-158, 359-360` were always undefined (`resolveReviewTarget` returns `{ mode, label, baseRef, explicit }`), so `buildTargetLabel` silently fell through to "working tree" regardless of the actual review target. Fix: use `target.label` directly; job meta carries `targetMode` / `baseRef`.
  - **m-1**: `README.md:134` and `commands/review.md:41` still referenced `GLM_MODEL` env var, which was dropped as an override in v0.3.0. Fix: point at `default_model` in the config file.
- **v0.4.3 post-review hotfixes third pass — Bundle D3+** (local commits on top of `c8295d6`, not yet on any remote): 9 issues found by round-3 3-agent review using Anthropic-official agents only (in-house `security-auditor` retired after two rounds of fabricated output):
  - **Side-1** (regression-symmetric to Bundle C I-1): `/glm:status buildStatusSnapshot` at `scripts/lib/job-control.mjs:208-211` had the SAME unwrapped-getConfig pattern we fixed for `/glm:setup`. Corrupt `state.json` crashed the status command. Fix: wrap both `getConfig` and `listJobs`, surface `snapshot.stateError`, render the error + "job list unavailable until state file is fixed" block.
  - **Sub-MED** (silent-failure-hunter follow-up to MED-3): `scripts/lib/fs.mjs readJsonFile` was still bare `JSON.parse(fs.readFileSync(...))` — corrupt shipped schema threw a `SyntaxError` with no filename. Fix: wrap with file-path + recovery-hint error, matching `loadState` / `readConfigFile` / `readJobFile`.
  - **NEW-1** (silent-failure-hunter follow-up to MED-2): `scripts/lib/tracked-jobs.mjs runTrackedJob` catch handler called `readStoredJobOrNull` which now throws (MED-2 fix). If it threw, the secondary error would shadow the primary runner error. Fix: wrap the read, fold any persist warning into `errorMessage`, make sure the primary error propagates cleanly; persistence failure never swallows the user-visible error.
  - **Side-2** (code-reviewer cosmetic hardening): absolute home paths (e.g. `/Users/<name>/.local/state/...`) leaked into stderr crash lines and `--json` `state.error` / `config.error` fields. Info-leak only, not a vulnerability, but trivially redactable. Fix: new `redactHomePath` utility in `scripts/lib/fs.mjs`; wired into `main().catch` stderr and `buildSetupReport` / `buildStatusSnapshot` error capture points. Redaction runs at emission, not the throw site, so local debug still sees the full path.
  - **GAP-4** (test-analyzer backfill): `buildTargetLabel` had no unit test (only indirect coverage via `renderReviewResult` meta contract). Fix: added `export` + new `tests/target-label.test.mjs` with 5 tests including an explicit drift guard that deliberately populates `target.base` / `target.scope` to catch a pre-fix regression.
  - **GAP-4 enabler** (infrastructure): `scripts/glm-companion.mjs main().catch` wrapped in direct-invocation guard (`fileURLToPath(import.meta.url) === process.argv[1]`); importing the module no longer fires `main()` with the test runner's argv. Enables in-process unit testing of any future CLI-module helper.
  - **GAP-1** (test-analyzer backfill): MED-3 had only structural test guards (grep for absent strings). Added `tests/schema-load.test.mjs` with 3 dynamic tests — shipped schema loads + verdict enum + confidence required; corrupt fixture fails closed with filename; missing fixture emits ENOENT clearly.
  - **GAP-2** (test-analyzer backfill): MED-2 had a direct throw test but no propagation test through `/glm:result`. Added `tests/result-propagation.test.mjs` subprocess test asserting exit 1, clean stderr with file path + recovery hint, no stacktrace, no raw `SyntaxError`.
  - **GAP-3** (test-analyzer backfill): m-3 had good in-range coverage (0, 0.5, 0.95, 1) but no out-of-range / non-numeric tests. Added 5 boundary tests in `tests/render.test.mjs`: `> 1`, `< 0`, `NaN`, numeric string (intentionally NOT coerced), `null`. All must omit the confidence suffix so a misleading value never reaches the user.
  - **typo**: CHANGELOG second-pass section said "32 tests", actual was 33. Corrected.

Out of Scope: GitHub force-push / tag rewrite on v0.4.1 or v0.4.2 (not reopened — Option B explicit); CI pipeline (still v0.5+); cancel atomicity (M3 from v0.3.4, still deferred); version bump to 0.4.4 (user directive: keep sequence continuous); security-auditor's findings (fabricated — `scripts/commands/` does not exist; reference files were never imported at runtime).

Intended Ref: gitea main @ HEAD after the post-review hotfix commit. Version stays `0.4.3`; HEAD SHA identifies the exact state. GitHub mirror will move from `0.4.2` to the consolidated `0.4.3` state in one atomic commit when the user authorizes the sync — no intermediate `0.4.3` state is ever shipped on GitHub, so the GitHub sequence stays `0.4.2 → 0.4.3` clean.

Planned Actions (sequential, each step gated):
1. ✅ Local verification — `npm run check` passes; `npm test` reports 56/56 passing (vs 33/33 after Bundle C, vs 25/25 after first-pass hotfixes, vs 13/13 pre-hotfix, vs 0 in v0.4.2).
2. ✅ First-pass internal review — 3 agents (pr-review-toolkit:code-reviewer / security-auditor / pr-review-toolkit:silent-failure-hunter) ran in parallel; cross-verified against source; security-auditor output ~95% fabricated (invented `scripts/commands/` files) and discarded; 5 real bugs confirmed and fixed in first-pass hotfix.
3. ✅ Second-pass internal review (Bundle C) — same 3 agents re-run against first-pass state; security-auditor round-2 again fabricated everything (wrong hooks.json event types, wrong package.json version, wrong prompts/review.md vars, wrong commit messages — entire parallel-universe output discarded). Code-reviewer + silent-failure-hunter together flagged 7 real issues including 1 regression from our own H-A fix; all 7 resolved in Bundle C hotfix.
4. ✅ In-house `security-auditor` agent retired after two rounds of fabricated output. Deleted `~/.claude/agents/security-auditor.md`; cleaned refs in `rules/conditional/agents.md` + `rules/security.md` + `plans/agent-inventory.md`. Security-review route now: `pr-review-toolkit:silent-failure-hunter` + `pr-review-toolkit:code-reviewer` (Anthropic official).
5. ✅ Third-pass internal review (Bundle D3+) — 3 Anthropic-official agents only: `pr-review-toolkit:code-reviewer`, `pr-review-toolkit:silent-failure-hunter`, `pr-review-toolkit:pr-test-analyzer`. All three VERIFIED Bundle C, then flagged 9 more real issues (1 symmetric regression, 2 silent-failure follow-ups, 1 cosmetic hardening, 5 test-coverage gaps). All 9 resolved in Bundle D3+ commit.
6. User gitea push — unblocked. Commit to be pushed: Bundle D3+ hotfix commit on top of `c8295d6`.
7. Simplify pass — after Bundle D3+ lands, run `pr-review-toolkit:code-simplifier` across the repo to catch code-quality / clarity gaps introduced across the three hotfix passes.
8. GitHub sync — blocked on user go-ahead. Will deliver v0.4.3 as a single atomic commit via git trees API, containing everything since the GitHub `0.4.2` head.

Scope Completion: COMPLETE
First pass (d1fc595 → df413dc):
- `scripts/lib/args.mjs` — `parseArgs` long-form flag now splits on first `=` only (H-5 fix); pre-existing `parseCommandInput` central `cwd` injection (v0.4.3 original).
- `scripts/lib/state.mjs` — `loadState` fail-closed on corrupt (H-A fix).
- `scripts/lib/preset-config.mjs` — `writeConfigFile` uses `readConfigFile` directly (M-A fix).
- `scripts/glm-companion.mjs` — `runReview` dispatches template name on `adversarial` flag and passes codex-parity keys (H-1/H-3 + H-4 fix).
- `prompts/review.md` — new balanced-tone template (H-4 fix).
- `prompts/adversarial-review.md` — unchanged (template already correct; only the caller was wrong).
- `tests/args.test.mjs` — extended to 15 tests (added 2 for H-5 inline value preservation).
- `tests/preset-config.test.mjs` — 3 tests (first-run, key-rotation merge, corrupt throws).
- `tests/state.test.mjs` — 3 tests (missing, valid, corrupt throws).
- `tests/template-contract.test.mjs` — 4 structural tests pinning template-var ↔ companion-key contract.

Second pass — Bundle C (df413dc → c8295d6):
- `scripts/glm-companion.mjs` — `buildSetupReport` wraps `getConfig(workspaceRoot)` in try/catch; `report.state.error` surfaced; `ready` gated on `!stateError` (I-1 fix). `buildTargetLabel` uses `target.label` directly; job meta carries `targetMode` / `baseRef` instead of always-undefined `base` / `scope` (I-2 fix). `safeReadSchema` wrapper removed; `readOutputSchema(REVIEW_SCHEMA_PATH)` called directly; `buildReviewSystemPrompt` no longer emits a drifted fallback verdict enum (MED-3 / m-2 fix).
- `scripts/lib/preset-config.mjs` — `safeReadConfigOrNull` deleted (MED-1 fix).
- `scripts/lib/state.mjs` — `readJobFile` wrapped to throw with file path + recovery hint (MED-2 fix; `readStoredJobOrNull` inherits).
- `scripts/lib/render.mjs` — `normalizeReviewFinding` preserves valid `confidence ∈ [0, 1]`; `renderReviewResult` emits ` · conf 0.xx` suffix on severity prefix (m-3 fix). `renderSetupReport` shows a "State file" block when `report.state.error` is set.
- `README.md` / `commands/review.md` — stale `GLM_MODEL` env var references replaced with `default_model` config pointer (m-1 fix).
- `tests/template-contract.test.mjs` — now 6 tests (added MED-1 dead-code guard + MED-3 drifted-enum guard).
- `tests/render.test.mjs` (new) — 4 tests covering m-3 confidence rendering (present, omitted, boundary values) + I-2 target-label contract.
- `tests/setup-resilience.test.mjs` (new) — 1 integration test subprocess-running `/glm:setup --json` against a pre-corrupted `state.json`; asserts exit 0, report rendered, `state.error` surfaced, `ready` false.
- `tests/state.test.mjs` — 1 new test for `readJobFile` corrupt-file throw path.
- `CHANGELOG.md` — v0.4.3 entry now lists both passes (13 issues after Bundle C) with "Fixed (first pass)" / "Fixed (second pass)" subsections.
- `release_card.md` — updated to cover both passes.

Third pass — Bundle D3+ (c8295d6 → HEAD):
- `scripts/lib/job-control.mjs` — `buildStatusSnapshot` wraps state reads; surfaces `snapshot.stateError` (Side-1 fix). Imports `redactHomePath`.
- `scripts/lib/render.mjs` — `renderStatusReport` emits a "State file:" block when `stateError` present; `report.config?.stopReviewGate` (null-safe for corrupt-state case).
- `scripts/lib/fs.mjs` — `readJsonFile` fail-closed with file path + recovery hint (Sub-MED fix). New `redactHomePath(text)` utility (Side-2 fix).
- `scripts/lib/tracked-jobs.mjs` — `runTrackedJob` catch no longer lets a `readStoredJobOrNull` throw shadow the primary runner error; persist warning folded into `errorMessage`; persistence failure doesn't swallow the user-visible error (NEW-1 fix).
- `scripts/glm-companion.mjs` — `main().catch` wrapped in direct-invocation guard (enables in-process unit testing); `export` added to `buildTargetLabel` (GAP-4 enabler). `redactHomePath` wired into main stderr emission + `buildSetupReport` stateError/configError capture.
- `CHANGELOG.md` — v0.4.3 entry now lists all 22 issues across three passes with "Fixed (N pass)" subsections; test-count typo corrected (32 → 33).
- `tests/target-label.test.mjs` (new) — 5 unit tests for `buildTargetLabel` including drift guard (GAP-4).
- `tests/schema-load.test.mjs` (new) — 3 tests for `readOutputSchema` positive + fail-closed + ENOENT (GAP-1).
- `tests/fs.test.mjs` (new) — 8 tests for `readJsonFile` + `redactHomePath` including boundary-violation guard.
- `tests/status-resilience.test.mjs` (new) — 1 subprocess test for Side-1: `/glm:status` survives corrupt `state.json`.
- `tests/result-propagation.test.mjs` (new) — 1 subprocess test for GAP-2: `/glm:result <id>` with corrupt job file propagates cleanly through `main().catch`.
- `tests/render.test.mjs` — Extended 4 → 9 tests; added 5 confidence boundary tests (GAP-3).
- `release_card.md` — this file, updated to cover all three passes.

Outstanding In-Scope Work: none.

Major Upgrade Review: DONE (patch-level in substance — all fixes are surgical and data-flow preserving; no API surface, config shape, endpoint URL, or schema changes). Breaking Changes: none for users with healthy state/config. Users with an already-corrupt `~/.config/glm-plugin-cc/config.json` or `state.json` who previously enjoyed silent masking will now see a clear error ("Could not parse …: delete or fix the file"); they can recover by deleting the file. This is the intended behavior change. Repo Usage Audit: `runReview` is the only caller of `loadPromptTemplate(_, "adversarial-review"|"review")`; `loadState` / `readConfigFile` callers propagate throw semantics cleanly up to the command boundary where it surfaces to the user. Verification Plan: executed — 25 automated tests pass (including regression guards for each of the 5 bugs); static template-contract test prevents future drift; empirical `--cwd` and `--base-url=…?foo=bar` scenarios manually run and verified.

Local Verification: all pass. `npm run check` (13 lib modules + 3 top-level scripts + ESM import resolution) ✓. `npm test` **56/56** ✓ (was 33/33 after Bundle C, 25/25 after first-pass, 13/13 pre-hotfix). Subprocess integration tests (setup-resilience, status-resilience, result-propagation) confirm the three user-visible state-recovery command paths (`/glm:setup`, `/glm:status`, `/glm:result`) all propagate cleanly when state / job files are corrupt. Manual: `/tmp` → `node glm-companion status --cwd /repo --json` resolves workspaceRoot to `/repo`; `--base-url=https://x.com?foo=bar` is preserved intact through parseArgs.

Codex-alignment Evidence: See CHANGELOG v0.4.3 "Codex scaffold alignment" section. Three bugs are inherited from codex-plugin-cc v1.0.4 (args split, state fail-open, single-template-for-both-modes); upstream PR-able. Two are GLM-specific (runReview key drift during `--base`/`--scope` adaptation; writeConfigFile merge in the GLM-only preset-config layer).

CI Evidence: no CI pipeline yet (planned v0.5+); ref-bound verification is local-only.

Rollback:
- Bundle D3+ hotfix commit only: revert to `c8295d6`. All 9 Bundle D3+ fixes reappear; Bundle C + first-pass state still protects against the original 12 bugs.
- Bundle C + Bundle D3+ together: revert to `df413dc`. All 16 post-df413dc bugs reappear; first-pass state still protects against the original 5.
- Full unwind: revert to `d1fc595` (original v0.4.3). All 21 post-d1fc595 bugs reappear. Not expected to be needed.
- v0.4.1 / v0.4.2: not rolled back per Option B.
