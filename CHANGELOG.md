# Changelog

## v0.4.3 — 2026-04-20

Bug-fix release. **Twenty-two issues fixed + two simplify passes**
across **three review passes plus two cleanup passes** — six in the
first pass (arg parsing, review prompt pipeline, state/config
corruption handling, template dispatch), seven in the second pass
(setup resilience, dead-code pruning, job-file error UX,
shipped-schema fail-closed, finding confidence rendering, dead target
metadata, doc drift), nine in the third pass (symmetric status
resilience, generic fs fail-closed, error-shadow fix, home-path
redaction, test-coverage backfill), and two final cleanup passes
pruning dead codex-scaffold functions, a bogus `"Resume thread: null"`
output branch, duplicated error-formatting boilerplate, an empty
"GLM Session ID" table column, the thread/turn concept scaffolding
throughout, and a ReferenceError Bundle E+ introduced in
`pushJobDetails`. Version stays at 0.4.3 per user directive to keep
the public sequence `0.4.2 → 0.4.3` continuous — the passes are
recorded here as separate "Fixed (N pass)" / "Simplified (N pass)"
subsections so readers can diff them individually. The headline fix: pre-fix, every `/glm:review` and
`/glm:adversarial-review` call shipped an EMPTY repository context to
GLM — the prompt template used `{{REVIEW_INPUT}}` / `{{TARGET_LABEL}}`
/ `{{USER_FOCUS}}` / `{{REVIEW_COLLECTION_GUIDANCE}}` while the
companion passed `FOCUS_INSTRUCTION` / `REVIEW_DIFF` / `REVIEW_BASE` /
`REVIEW_SCOPE` / `ADVERSARIAL_MODE`; zero overlap, and
`interpolateTemplate` silently substitutes `""` for unmatched
placeholders. The review feature effectively never worked end-to-end.

### Fixed (first pass)

- **`scripts/lib/args.mjs`** — `--key=value` now splits on the FIRST
  `=` only (using `indexOf`), not `split("=", 2)` which truncated
  everything after the second `=`. Values containing `=` (URL query
  strings, base64, etc.) are now preserved intact. Example:
  `--base-url=https://open.bigmodel.cn/api/coding/paas/v4?foo=bar`
  pre-fix resolved to `https://open.bigmodel.cn/api/coding/paas/v4?foo`
  and silently dropped `=bar`.
- **`scripts/lib/args.mjs` (earlier in this release)** — `--cwd <path>`
  and `-C <path>` were silently ignored on every subcommand. The
  companion's `parseCommandInput` wrapper registered the alias
  (`C → cwd`) but never put `cwd` in `valueOptions`, so the long-form
  token fell through to positionals and `resolveCommandCwd` always
  returned `process.cwd()`. Programmatic / out-of-session callers
  could not target a different repo. In-session `/glm:review` from
  Claude Code was unaffected because Claude's `Bash` tool inherits
  the session cwd.
- **`scripts/glm-companion.mjs` — review prompt key mismatch** —
  `runReview` now passes `REVIEW_KIND` / `TARGET_LABEL` / `USER_FOCUS`
  / `REVIEW_COLLECTION_GUIDANCE` / `REVIEW_INPUT`, matching the
  template's declared variables. Data sources: `target.label`,
  `reviewContext.collectionGuidance`, `reviewContext.content` —
  all already produced by `collectReviewContext` in `lib/git.mjs`.
- **`scripts/glm-companion.mjs` — template dispatch** — `/glm:review`
  (balanced) now loads `prompts/review.md`; `/glm:adversarial-review`
  continues to load `prompts/adversarial-review.md`. Pre-fix, both
  loaded the adversarial template regardless of mode, so balanced
  mode was adversarial in every substantive way.
- **`prompts/review.md` (new)** — Balanced-tone counterpart to the
  adversarial template. Same structured-output contract, same
  grounding rules, but an honest (not skeptical-by-default)
  operating stance.
- **`scripts/lib/state.mjs` — `loadState` fail-closed** — Pre-fix,
  a corrupt `state.json` silently returned `defaultState()` (empty
  jobs). The next `saveState` would overwrite the corrupt file with
  `{ jobs: [] }`, wiping job history AND leaking every on-disk job
  and log file as an orphan (the "orphan cleanup" loop compared
  against an empty `previousJobs`). Mirrors the v0.3.4
  `readConfigFile` fix: missing file → `defaultState()` (first-run),
  corrupt file → throws with a recovery hint.
- **`scripts/lib/preset-config.mjs` — `writeConfigFile` fail-closed
  on merge** — Pre-fix, `writeConfigFile` called
  `safeReadConfigOrNull` which swallowed parse errors and returned
  `null`; rotating the API key on top of a corrupt config silently
  dropped the user's `preset_id` / `base_url` / `default_model` to
  `null`. Now uses `readConfigFile` directly (throws on corrupt,
  returns `null` only on missing).

### Fixed (second pass)

Second-pass review found a real regression introduced by the first
pass plus six pre-existing consistency gaps. All seven resolved
without changing the config shape or public surface.

- **`scripts/glm-companion.mjs` — `/glm:setup` survives corrupt
  `state.json`** (regression from first-pass H-A). `buildSetupReport`
  called `getConfig(workspaceRoot)` at line 179 without a try/catch;
  after `loadState` became fail-closed, any corrupt `state.json`
  crashed the exact command the user would run to recover. Now wraps
  the read, exposes `report.state.error`, and adds a "Fix state file
  error: …" step to `nextSteps`. Setup still renders end-to-end.
- **`scripts/lib/preset-config.mjs` — delete dead
  `safeReadConfigOrNull`**. The function was left defined (only
  referenced in a comment after the first-pass fix), which kept the
  regression vector for M-A open. Removed entirely.
- **`scripts/lib/state.mjs` — `readJobFile` throws with file path**.
  Pre-fix, a corrupt job file under `/glm:result <id>` produced a
  bare `SyntaxError: Expected property name or '}' in JSON at
  position 2` with no filename. Now mirrors the
  `loadState` / `readConfigFile` pattern: `Could not parse
  <path>: <reason>. Delete or fix the file to recover; its result
  will be lost.` `readStoredJobOrNull` in `tracked-jobs.mjs` inherits
  the improved message because it delegates to `readJobFile`.
- **`scripts/glm-companion.mjs` — remove `safeReadSchema` wrapper
  and the drifted fallback enum**. The shipped
  `schemas/review-output.schema.json` requires
  `verdict ∈ {approve, needs-attention}`, but when the schema file
  was missing/corrupt, `buildReviewSystemPrompt` silently fell back
  to a hard-coded "verdict (ready|needs_fixes|blocked)" hint —
  shipping a completely different vocabulary to GLM. Now calls
  `readOutputSchema(REVIEW_SCHEMA_PATH)` directly; a corrupt shipped
  schema surfaces a clear reinstall-the-plugin error instead of
  quietly degrading reviews.
- **`scripts/lib/render.mjs` — `normalizeReviewFinding` retains
  `confidence`**. The schema marks confidence `∈ [0, 1]` as
  required; the normalizer dropped the field, so every rendered
  finding lost the confidence signal. Now preserves valid numeric
  values (null-out-of-range defaults to omission) and
  `renderReviewResult` appends ` · conf 0.xx` to the severity
  prefix — e.g. `[high · conf 0.95] ...`.
- **`scripts/glm-companion.mjs` — drop dead `target.base` /
  `target.scope` references**. `resolveReviewTarget` in `git.mjs`
  returns `{ mode, label, baseRef, explicit }`; the companion read
  `target.base` / `target.scope` which were always undefined, so
  `buildTargetLabel` silently fell through to "working tree"
  regardless of the actual review target. `buildTargetLabel` now
  uses `target.label` directly, and job meta carries `targetMode` /
  `baseRef` instead of the two always-undefined fields.
- **`README.md` / `commands/review.md` — remove stale `GLM_MODEL`
  env var references**. `GLM_MODEL` was dropped as an override in
  v0.3.0 (see the v0.3.0 changelog entry), but two user-facing docs
  still recommended it. Corrected to point at `default_model` in
  the config file.

### Fixed (third pass)

Third-pass review (`pr-review-toolkit:code-reviewer` +
`pr-review-toolkit:silent-failure-hunter` +
`pr-review-toolkit:pr-test-analyzer`, each running heterogeneous
verification paths per the multi-agent protocol; the in-house
`security-auditor` agent was retired after two rounds of fabricated
output) flagged a mix of real issues and test-coverage gaps. All nine
resolved without changing public API or config shape.

- **`scripts/lib/job-control.mjs` — `/glm:status` survives corrupt
  `state.json`** (symmetric to the second-pass I-1 fix for `/glm:setup`).
  `buildStatusSnapshot` called `getConfig(workspaceRoot)` and
  `listJobs(workspaceRoot)` unwrapped; after `loadState` became
  fail-closed, `/glm:status` crashed with a stacktrace instead of
  showing the recovery hint. Now wraps both reads, surfaces
  `snapshot.stateError`, and `renderStatusReport` emits a "State file:
  error: … / job list unavailable until state file is fixed." block.
- **`scripts/lib/fs.mjs` — `readJsonFile` fail-closed with file path**
  (second-pass MED-3 sub-finding). The generic helper was still bare
  `JSON.parse(fs.readFileSync(...))`, so any caller (including
  `readOutputSchema` for the shipped review schema) threw a bare
  `SyntaxError` with no filename. Now mirrors the
  `loadState` / `readConfigFile` / `readJobFile` pattern — `Could not
  parse <path>: … Delete or fix the file to recover.`
- **`scripts/lib/tracked-jobs.mjs` — `runTrackedJob` catch no longer
  shadows the primary runner error** (second-pass NEW-1 follow-up).
  Pre-fix, `readStoredJobOrNull` could throw (MED-2 fix) and mask the
  original runner exception. Post-fix, the read is wrapped; the primary
  error propagates to `main().catch`, the secondary persist warning is
  folded into `errorMessage` for diagnostic completeness, and
  persistence failures never swallow the user-visible error.
- **`scripts/lib/fs.mjs` — `redactHomePath` utility + wired into every
  user-visible error surface** (second-pass Side-2 follow-up). Absolute
  home paths (e.g. `/Users/<name>/.local/state/...`) no longer leak into
  stderr crash lines or `--json` `state.error` / `config.error` fields;
  they're rewritten to `~/...` before emission. Local debug still sees
  the full path because redaction runs at the emission point, not the
  throw site. Boundary tests lock in that `/Users/<name>foo/bar` (no
  path separator) stays untouched.
- **`scripts/glm-companion.mjs` — direct-invocation guard around
  `main().catch`** (GAP-4 enabler). Importing the module used to fire
  `main()` with the test runner's argv and set `exitCode = 2`; this
  blocked `buildTargetLabel` (and future helpers) from being unit
  tested in-process. Guard pattern matches Node's recommended check
  (`fileURLToPath(import.meta.url) === process.argv[1]`).
- **`scripts/glm-companion.mjs` — `export` on `buildTargetLabel`** for
  direct unit testing (GAP-4). Function body unchanged.
- **`tests/render.test.mjs` — confidence boundary handling** (GAP-3
  backfill). Adds explicit guards for `> 1`, `< 0`, `NaN`, numeric
  strings ("0.95" — intentionally NOT coerced, to keep schema
  contract honest), and `null`. All five cases must omit the
  ` · conf 0.xx` suffix rather than render a misleading value.
- **CHANGELOG / release_card test-count typo**: second-pass section
  said "32 tests second-pass"; actual was 33. Corrected.

### Simplified (final cleanup pass)

After the three hotfix passes landed, a review-only simplify scan by
`pr-review-toolkit:code-simplifier` flagged a handful of opportunities
that had accumulated as scar tissue. Applied in two sub-passes: first
the four P1 items plus two P2 helper extractions (Bundle E+), then a
follow-up pass (Bundle F) that caught a ReferenceError Bundle E+ had
introduced and finished the thread / resume scaffolding removal the
simplify pass had only half-completed.

- **`scripts/lib/render.mjs` — deleted the `"Resume thread: null"`
  output branch**. `renderStoredJobResult` declared
  `const resumeCommand = null; // GLM is stateless` and then
  interpolated that null into four conditional emissions
  (`"Resume thread: ${resumeCommand}"`) guarded by `threadId`. Any
  legacy job record that happened to carry a non-null `threadId` would
  have rendered literal `"Resume thread: null"` to the user.
  `formatResumeCommand` helper (always returns null) deleted with it.
  (Note: the first simplify commit deleted the helper but missed a
  second call site in `pushJobDetails` — see the follow-up bug fix
  below.)
- **`scripts/glm-companion.mjs` — removed two unused imports**
  (`listJobs` from `state.mjs`, `appendLogLine` from
  `tracked-jobs.mjs`). `npm run check` validates.
- **`scripts/lib/glm-client.mjs` + `scripts/lib/process.mjs` — deleted
  three codex-scaffold carryovers that GLM does not use**:
  `findLatestTaskThread` (always returned null — GLM is stateless),
  `interruptAppServerTurn` (always returned the "nothing to interrupt"
  shape), and `terminateProcessTree` (+ its private helper
  `looksLikeMissingProcessMessage`). All three were exported but
  zero call sites existed; the last one was only needed by codex's
  persistent-subprocess model. ~70 LOC removed.
- **`scripts/lib/state.mjs` — simplified `resolveStateDir` dead catch
  branch**. The catch body re-assigned `canonicalWorkspaceRoot` to
  the value it already held; replaced with a no-op comment. Behaviour
  identical.
- **`scripts/lib/fs.mjs` — new `formatUserFacingError(error)` helper**
  (P2-1). Centralizes the pattern
  `redactHomePath(error instanceof Error ? error.message : String(error))`
  that used to be duplicated verbatim at four call sites
  (`buildSetupReport` ×2, `buildStatusSnapshot`, `main().catch`).
  Callers now read `configError = formatUserFacingError(error)`.
- **`scripts/glm-companion.mjs` — removed dead `session_id` option
  plumbing** (P2-5). `runStatus` and `runCancel` each fetched
  `session_id` via `currentSessionId()` and passed it through as an
  option to `buildStatusSnapshot` / `resolveCancelableJob`, but the
  receiving functions read session scoping from `options.env` via
  `filterJobsForCurrentSession → getCurrentSessionId`, never
  `options.session_id`. `runCancel` now passes `{ env: process.env }`.
  (Note: this is code-intent cleanup, not a functional fix —
  `getCurrentSessionId` already falls back to `process.env` if
  `options.env` is missing, so both callers worked either way.)

### Simplified (Bundle F — thread / resume scaffolding removed)

Bundle E+ ran in review-only mode and the execution missed a live
call site, introducing a ReferenceError. Bundle F fixes that and
takes the opportunity to delete all remaining thread / resume
scaffolding — every field was null-valued or always-empty in GLM
because the bigmodel API is stateless HTTP.

- **🚨 ReferenceError fix**: `scripts/lib/render.mjs:142` was still
  calling `formatResumeCommand(job)` after Bundle E+ deleted the
  function. Existing tests missed it because the for-loop in
  `pushJobDetails` never entered with a real job during testing.
  Any user running `/glm:status <job-id>` or `/glm:status` with an
  active job would have hit `ReferenceError: formatResumeCommand is
  not defined`. Fix: removed the call + the two "Resume thread: …" /
  "GLM thread ref: …" output lines from `pushJobDetails`.
- **`scripts/lib/render.mjs` — deleted the "GLM Session ID" column**
  from `appendActiveJobsTable`. Header said "GLM Session ID" but the
  cell read `job.threadId ?? ""` — always empty for GLM. Column
  dropped entirely (7 columns → 6) so `/glm:status` no longer shows
  a permanently empty column.
- **`scripts/lib/render.mjs` — simplified `renderStoredJobResult`**.
  The Bundle D3+ version kept a `threadRefSuffix` that only fired if
  a legacy threadId happened to be stored; now the function just
  returns rendered / raw output without any thread-ref scaffolding.
- **`scripts/lib/tracked-jobs.mjs` — removed `threadId` / `turnId`
  from the progress-event pipeline**: `normalizeProgressEvent` no
  longer normalizes the two fields, `createJobProgressUpdater` no
  longer tracks `lastThreadId` / `lastTurnId` (the tracking was
  always a no-op because the normalized values were always null),
  `runTrackedJob` no longer writes `threadId`/`turnId` into
  `writeJobFile` / `upsertJob` payloads.
- **`scripts/lib/glm-client.mjs` — removed `threadId: null` /
  `turnId: null` from three response shapes** (successful JSON
  result, successful raw result, `failureShape`). These fields were
  hard-coded null to "match the codex scaffold shape" but every
  GLM consumer read them as null anyway.
- **`scripts/lib/glm-client.mjs` — renamed
  `buildPersistentTaskThreadName` → `buildTaskTitle`**, and
  `TASK_THREAD_PREFIX` → `TASK_TITLE_PREFIX`. The function never
  built a "persistent thread name" — it built a short job title
  from the first line of the prompt. Name now matches behaviour.
- **`scripts/lib/glm-client.mjs` — module docstring rewrite**:
  dropped the "keep the function surface aligned with the
  codex-plugin-cc scaffold" framing. GLM is stateless HTTP — stating
  the positive fact is clearer than a historical alignment note.

### Added

- **`tests/args.test.mjs`** — Extended from 13 to 15 tests. New
  regression guard for the `split("=", 2)` truncation bug and
  inline-empty-value edge case.
- **`tests/preset-config.test.mjs`** — 3 tests covering first-run,
  valid-merge (key rotation preserves other fields), and corrupt
  config (throws).
- **`tests/state.test.mjs`** — 3 tests covering missing state
  file (returns defaults), valid state roundtrip, and corrupt
  state (throws).
- **`tests/template-contract.test.mjs`** — 4 structural tests
  pinning the review prompt contract: both templates' `{{VARS}}`
  must be declared, companion keys must be used by at least one
  template, and the `runReview` source must still contain all
  expected keys. Catches future drift between template and
  companion at build time (via `npm test`), not runtime. Second-pass
  added 2 more structural tests: no drifted
  `ready|needs_fixes|blocked` enum string in the companion, and no
  lingering `safeReadConfigOrNull` definition.
- **`tests/render.test.mjs`** (new) — 4 tests covering
  `renderReviewResult` with confidence rendering, boundary values
  (0 and 1), omission when GLM didn't supply a numeric confidence,
  and the target-label contract (meta.targetLabel is authoritative,
  no reliance on deleted `base` / `scope` fields).
- **`tests/setup-resilience.test.mjs`** (new) — 1 integration test
  that spawns `node scripts/glm-companion.mjs setup --json` with a
  corrupt `state.json` pre-seeded and verifies: exit 0, report
  rendered, `state.error` surfaced, `nextSteps` carries a fix
  hint, `ready` is false.
- **`tests/state.test.mjs`** — Extended with 1 new test for
  `readJobFile` corrupt-file throw path (MED-2 regression guard).
- **`tests/status-resilience.test.mjs`** (third pass, new) — 1
  subprocess test for Side-1: `/glm:status --json` with corrupt
  `state.json` pre-seeded; asserts exit 0, `snapshot.stateError`
  surfaced, empty job lists, response shape intact.
- **`tests/result-propagation.test.mjs`** (third pass, new, GAP-2
  backfill) — 1 subprocess test: `/glm:result <id>` against a corrupt
  job file; asserts exit 1, clean single-line stderr with file path
  and "Delete or fix the file" hint, no stacktrace leakage, no raw
  `SyntaxError: Expected property name` text.
- **`tests/schema-load.test.mjs`** (third pass, new, GAP-1 backfill)
  — 3 tests for `readOutputSchema`: shipped schema loads successfully
  and still has the expected verdict enum (`approve` |
  `needs-attention`) + `confidence` in finding required fields;
  corrupt fixture schema fails closed with filename; missing fixture
  emits ENOENT clearly.
- **`tests/target-label.test.mjs`** (third pass, new, GAP-4
  backfill) — 5 unit tests for `buildTargetLabel`: uses `target.label`
  when no focus; appends focus; shortens long focus; falls through
  to "working tree" on empty; never reads `target.base` /
  `target.scope` (drift guard — deliberately populates those as noise
  to catch a regression).
- **`tests/fs.test.mjs`** (third pass, new) — 8 tests covering
  `readJsonFile` (valid / corrupt with path / ENOENT) and
  `redactHomePath` (replaces `$HOME` prefix, handles multiple
  occurrences, leaves non-home paths alone, safe on
  non-string/empty inputs, does NOT redact a prefix match without a
  `/` boundary).
- **`tests/render.test.mjs`** — Extended from 4 to 9 tests; added
  the 5 GAP-3 confidence-boundary tests.
- **`tests/fs.test.mjs`** — Extended with 2 tests for the new
  `formatUserFacingError` helper (pulls `.message` from Error
  instances + redacts $HOME; falls back to `String()` for
  non-Error throws).
- **`tests/job-render.test.mjs`** (Bundle F, new) — 7 tests for
  the four renderers that walk job records
  (`renderJobStatusReport`, `renderStatusReport` with running /
  finished / recent slots, `renderStoredJobResult` with and without
  legacy threadId, `renderCancelReport`). These exercise the exact
  path that Bundle E+ broke (`pushJobDetails` calling the deleted
  `formatResumeCommand`) so the same class of regression fails
  loudly next time.
- **Total**: 0 tests in v0.4.2 → 25 first-pass → 33 second-pass
  → 56 third-pass → 58 after Bundle E+ → 65 after Bundle F
  (all pass).

### Codex scaffold alignment

Three of the five root-cause bugs are inherited directly from the
codex-plugin-cc scaffold (v1.0.4) and still exist there:

- `args.mjs:28` identical `split("=", 2)` — affects codex too
- `state.mjs loadState / saveState` identical fail-open + orphan —
  affects codex too
- Single-template-for-both-review-modes — codex also ships
  `prompts/adversarial-review.md` only; no balanced counterpart

GLM has now diverged on these three toward fail-closed behavior.
The other two (template key mismatch in `runReview`, corrupt
`writeConfigFile` merge) are GLM-specific regressions introduced
during the `--base`/`--scope` flag adaptation and the `preset-config`
feature respectively; codex's `runReview` correctly passes matching
keys, and codex does not have a `preset-config` layer (delegates to
codex CLI's own `~/.codex/auth.json`).

### Not changed

- Companion script surfaces for setup / review / task / rescue /
  status / result / cancel are unchanged on Claude-Code-invoked
  paths; the workspace resolution already went through
  `resolveCommandCwd(options)` correctly, the fix just makes the
  `options.cwd` slot actually get populated when the flag is used.
- Version number stays `0.4.3` — GitHub mirror was at `0.4.2` when
  these fixes were developed; pushing this state keeps the public
  version sequence `0.4.2 → 0.4.3` without a skip. The internal
  gitea primary had three intermediate commits at `0.4.3`; the
  HEAD SHA identifies the exact code state.

## v0.4.2 — 2026-04-20

Sync with upstream codex-plugin-cc v1.0.4 (released 2026-04-18). Of the
six commits between v1.0.3 and v1.0.4, five are not applicable to this
fork (GLM has no session runtime / no `xhigh` effort level / the
`$ARGUMENTS`-quoting and agent-frontmatter `model:` fixes already
landed here in v0.3.4 / v0.1.x). One — [codex-plugin-cc
#235](https://github.com/openai/codex-plugin-cc/pull/235) "route
/codex:rescue through the Agent tool to stop Skill recursion" — is a
direct structural parallel and is ported here.

### Changed

- `commands/rescue.md`:
  - Dropped `context: fork` frontmatter so the command runs inline in
    the parent session where the `Agent` tool is in scope.
  - Added `Agent` to `allowed-tools`.
  - Rewrote the routing prose to explicitly invoke
    `Agent(subagent_type: "glm:glm-rescue")` and warn against
    `Skill(glm:glm-rescue)` / `Skill(glm:rescue)` — the latter
    re-enters this command and hangs the session.

### Not changed

- Companion scripts, config shape, preset URLs, model defaults, auth
  — all unchanged. Existing `~/.config/glm-plugin-cc/config.json`
  keeps working without re-setup.

## v0.4.1 — 2026-04-20

Command-UX fix: `/glm:setup` and `/glm:status` were producing verbose
Chinese-prose wrappers around the companion JSON output (the model
added pre-picker narration, post-persist bulleted summaries, and
reformatted Case-D state as a Markdown list). Codex-plugin-cc's
equivalents just render stdout and move on. This release aligns with
that: the command markdown now explicitly instructs the model to
present stdout verbatim and adds no commentary.

Also fixed the `.claude-plugin/marketplace.json` schema error that
made `/plugin marketplace add https://github.com/sky-zhang01/glm-plugin-cc`
fail on Claude Code 2.1.x: `"source": "."` was rejected as `Invalid
input`; now uses `"./"` (matches `planning-with-files` and
`everything-claude-code` conventions).

### Changed

- `commands/setup.md`: rewritten codex-parity terse (~35 lines vs 133).
  Explicit "present stdout verbatim — no commentary / bullet summary /
  Chinese restatement" rule so the model stops wrapping the JSON
  report in extra prose.
- `commands/status.md`: removed the "GLM calls are stateless HTTP
  foreground …" preamble that codex `/codex:status` doesn't have.
- `.claude-plugin/marketplace.json`: `source: "."` → `source: "./"`.

### Not changed

- No companion script changes; no auth / config shape changes; no
  endpoint URL changes. Existing `~/.config/glm-plugin-cc/config.json`
  keeps working without re-setup.

## v0.4.0 — 2026-04-20

**Breaking auth change**: API key now persists to
`~/.config/glm-plugin-cc/config.json` (mode 0600) via `/glm:setup`
instead of reading from the `ZAI_API_KEY` environment variable.
Mirrors codex CLI's `~/.codex/auth.json` pattern (confirmed by [Issue
openai/codex#5212](https://github.com/openai/codex/issues/5212) closed
as "not planned" — codex rejected env-var-only mode, keeps auth.json
the single source).

Earlier releases (v0.1.0 → v0.3.4) advertised "API key never on disk"
as a red line. That rule was stricter than codex itself and created a
worse UX: users had to export `ZAI_API_KEY` in their shell rc before
anything worked. v0.4.0 accepts the same trade-off codex does —
on-disk + 0600 + user-home dir — for a one-step install experience.

### Changed

- `scripts/lib/preset-config.mjs`:
  - Config schema gains an `api_key` string field (max 512 chars,
    trimmed). `sanitizeConfig` validates length; arrays / non-objects
    still rejected.
  - New `resolveApiKeyFromConfig()` — separate function so the raw
    key only enters memory when the HTTP client explicitly needs it
    (keeps it out of `resolveEffectiveConfig` returns, which feeds
    setup reports and job records).
  - New `persistApiKey(key)` — writes `api_key` only, preserves
    preset / base_url / default_model.
  - Removed `api_key_env` from built-in preset definitions (was
    unused cosmetic metadata pointing at `ZAI_API_KEY`).
- `scripts/lib/glm-client.mjs`:
  - `resolveApiKey()` now reads from config file only; the env-var
    chain (`ZAI_API_KEY` / `Z_AI_API_KEY` / `GLM_API_KEY`) is
    **removed**.
  - `resolveBaseUrl()` no longer honors `ZAI_BASE_URL` override;
    base URL comes from the preset or its overrides in config.json.
  - `resolveModel()` no longer honors `GLM_MODEL` override; use
    `--model` or update `default_model` in config.json.
  - `GLM_TIMEOUT_MS` is retained (operational, not credential).
  - Auth-failure error messages now point users at `/glm:setup
    --api-key <key>` for key rotation.
- `scripts/glm-companion.mjs`:
  - `runSetup` accepts `--api-key <key>`; persists via
    `persistApiKey()`. Report says "stored api_key to ... (0600)" —
    never echoes the key value.
  - Setup report exposes `config.has_api_key: boolean` (not the key
    itself) so `--json` consumers can check without risking leaks.
- `scripts/lib/render.mjs`:
  - Setup report now shows `api_key: stored` or `api_key: (not set
    — run /glm:setup --api-key <key>)` in the human-readable block.
- `commands/setup.md`: Fully rewritten for the Claude-native paste
  flow — preset via `AskUserQuestion`, then natural-language prompt
  for the key. Extraction / anti-echo rules explicit. Shell-only
  path documented as alternative for users who want the key out of
  Claude session logs.
- `commands/rescue.md`, `agents/glm-rescue.md`: "no API key" guidance
  updated from env-var to `/glm:setup`.
- `README.md`: Auth section rewritten. Env override table trimmed
  (only `GLM_TIMEOUT_MS` remains).

### Migration for v0.3.x users

1. Upgrade the plugin to v0.4.0.
2. Run `/glm:setup --api-key <your-existing-key>` (you can copy the
   value from your `$ZAI_API_KEY` env var: `echo $ZAI_API_KEY` in a
   terminal, then paste).
3. `unset ZAI_API_KEY` in your shell rc (optional — it's now ignored).

No config auto-migration. The preset IDs / URLs / model defaults are
unchanged, so an existing `config.json` keeps working for
preset+base_url+default_model; only the key is now read from there.

### Security notes

- File mode 0600 on the config file (already in place since v0.3.4).
- `api_key` never appears in setup report output, job records,
  rendered review output, or error messages. Only a boolean
  `has_api_key` indicates presence.
- Length-validated to 1–512 chars to avoid oversized strings drifting
  into memory.
- Raw key still never transits through HTTPS logs — the sanitizer on
  endpoint URLs remains in place, and the `Authorization: Bearer`
  header is set at fetch time only.

## v0.3.4 — 2026-04-20

Install-path enablement + independent code review fixes. The Codex CLI
was run over the full v0.3.3 repo as an adversarial review; 11 findings
came back, 9 were verified and landed here (2 deferred with rationale).
All findings treated this as a pre-install bar, not polish.

### Added (marketplace-load path)

- `.claude-plugin/marketplace.json` — root-as-marketplace entry that
  exposes `glm` as a single plugin with `source: "."` so
  `/plugin marketplace add` can load the repo. Name: `skylab-glm`.
- `scripts/check-imports.mjs` — ESM import-resolution check for all 13
  lib modules. Wired into `npm run check` so v0.3.3-class broken imports
  fail loudly instead of passing `node --check`.

### Fixed (HIGH — pre-install blockers)

- **H1 / shell injection**: `$ARGUMENTS` now quoted as `"$ARGUMENTS"` in
  `commands/{adversarial-review,cancel,review,setup,status}.md`. Previously
  shell metachars in slash-command arguments could escape the `node` call
  and execute arbitrary shell.
- **H2 / broken SessionStart/End hook**: `scripts/session-lifecycle-hook.mjs`
  was importing `./lib/app-server.mjs` and `./lib/broker-lifecycle.mjs` —
  codex-plugin-cc scaffold residue that doesn't exist in this fork. Every
  Claude Code session start/end crashed the hook. Rewrote the hook as a
  stateless bookkeeping shim: append `GLM_COMPANION_SESSION_ID` env on
  start, prune this session's local job records on end. No broker /
  process-tree teardown needed (GLM is stateless HTTP; jobs run
  synchronously in the companion process).
- **H3 / silent fail-open on corrupt config**: v0.3.3 `resolveEffectiveConfig`
  delegated to `safeReadConfigOrNull` which swallowed JSON parse errors,
  unknown preset_id errors, and non-`https://` base_url errors — falling
  back to the built-in BigModel endpoint. A corrupt `custom` preset config
  would silently route review prompts + diffs to the default endpoint
  instead of failing. Now `resolveEffectiveConfig` calls `readConfigFile`
  directly (throws on corrupt config); missing file still returns null.
  `sanitizeConfig` now rejects arrays (`typeof [] === "object"` used to
  slip through).

### Fixed (MEDIUM)

- **M1 / URL echo in errors**: all error / status paths that mention the
  base URL now pass it through `sanitizeUrlForDisplay` to strip
  `user:pass@`, query string, and fragment before display. Defends
  against accidentally pasted credentials in `ZAI_BASE_URL` or
  `--base-url` being echoed to stdout / stored in job records.
- **M2 / state/job/log file perms**: `ensureStateDir` now creates dirs
  with mode 0700 (with defensive `chmodSync` for pre-existing dirs);
  `writeJobFile`, `saveState`, `createJobLogFile`, `appendLogLine`, and
  `appendLogBlock` now set mode 0600 + defensive chmod. Review prompts,
  git diffs, and GLM outputs live in these files and should not be
  world-readable on shared hosts.
- **M4 / log write failure mis-reported as NETWORK_ERROR**: `createProgressReporter`
  now isolates `appendLogLine` / `appendLogBlock` / `onEvent` exceptions
  so a read-only log dir or full disk can't bubble up into the fetch
  lifecycle and get mapped to NETWORK_ERROR.
- **M5 / custom URL with query string**: `normalizeBaseUrl` rewritten
  using `new URL()` so pathname stripping (`/chat/completions`) and
  query / fragment preservation are structural instead of regex-based.
  `applyPreset` similarly hardened.

### Fixed (LOW)

- **L1 / reasoningSummary dropped in success render**: `renderReviewResult`
  success path now reads `meta.reasoningSummary ?? parsedResult.reasoningSummary`
  (previously only the failure paths had the fallback).
- **L2 / job kind mislabel**: `getJobTypeLabel` was mapping `kind === "task"`
  and `jobClass === "task"` to `"rescue"`. Now the four real kinds
  (review / adversarial-review / task / rescue) map to themselves; legacy
  `jobClass` fallback preserved.

### Added (defensive)

- `failureShape` now uses `CONFIG_ERROR` when `resolveEndpoint` / `resolveModel`
  throws due to a bad config file; `MODEL_REJECTED` is reserved for vision
  deny-list rejections only.

### Deferred (low-impact under current design)

- **M3** (cancel not atomic vs later completion write): current cancel is
  bookkeeping-only per the README / stateless-HTTP semantics. Worth
  revisiting when / if background jobs or TeamCreate routing arrives.
- Nothing else from the review was suppressed.

### Install

Local path (recommended — bypasses Cloudflare Access on the Gitea
remote):

```
/plugin marketplace add /path/to/glm-plugin-cc
/plugin install glm@skylab-glm
```

Or, after Cloudflare Access auth is established on the host:

```
/plugin marketplace add https://gitea.tokyo.skyzhang.net/SkyLab/glm-plugin-cc
/plugin install glm@skylab-glm
```

## v0.3.3 — 2026-04-20

Simplify thinking default: v0.3.2's per-command split was
over-engineered. Codex CLI itself doesn't split `model_reasoning_effort`
per task — it just uses a single `medium` default across all calls.
Match that: thinking defaults `on` globally; user can pass
`--thinking off` on any command for light calls.

### Changed

- `scripts/glm-companion.mjs`:
  - `runReview` still passes default `true` (unchanged behavior).
  - `runTask` now passes default `true` uniformly (was `rescueMode` in
    v0.3.2, meaning `task` defaulted `off`). Both `rescue` and `task`
    are now default `on`.
- `commands/task.md`: description updated — thinking defaults ON, not
  OFF.
- `commands/review.md`, `adversarial-review.md`, `rescue.md`,
  `agents/glm-rescue.md`: wording updated from "default on for this
  command" to "default on across all commands".
- `README.md` "Thinking / reasoning" section collapsed from per-command
  table to a single-sentence explanation.

### Non-breaking for most callers

- Users explicitly passing `--thinking on|off` keep exact prior
  behavior.
- Users calling `/glm:review`, `/glm:adversarial-review`, or
  `/glm:rescue` without `--thinking` keep exact v0.3.2 behavior
  (already defaulted `on`).
- Only change: `/glm:task` without `--thinking` now defaults `on`
  (was `off` in v0.3.2). Pass `--thinking off` to restore v0.3.2
  behavior on that command.

## v0.3.2 — 2026-04-20

Corrections to two v0.3.1 claims that were based on incomplete research.
Functional behavior changes: thinking defaults now split per command.
Non-breaking for configured endpoints / API keys / model names.

### Corrections

- **GLM generation ordering in README was wrong.** Listed `glm-4.6` as
  "previous-generation mid-tier" and `glm-4.7` as "previous-generation
  flagship" in the same tier. Official docs.bigmodel.cn confirms
  `glm-4.7` strictly succeeds `glm-4.6` ("surpassing GLM-4.6 across
  multiple dimensions"). Corrected ordering: `glm-5.1 > glm-5 >
  glm-5-turbo (current gen) > glm-4.7 (previous-gen flagship) > glm-4.6
  (older gen, aligned with Claude Sonnet 4)`.
- **Codex CLI default behavior claim was wrong.** v0.3.0 / v0.3.1 said
  "codex `--effort` defaults to unset → equivalent off". Actual codex
  CLI default per `developers.openai.com/codex/config-reference` is
  `model_reasoning_effort = "medium"` — reasoning ON by default. Our
  "thinking default off" was mis-aligned with codex, not aligned.

### Changed

- `scripts/glm-companion.mjs`: `parseThinkingFlag` now accepts a
  per-command default. Call sites pass task-appropriate defaults:
  - `runReview` (review + adversarial-review): default **on**
  - `runTask` with `rescueMode=true`: default **on**
  - `runTask` with `rescueMode=false` (plain `/glm:task`): default **off**
- `commands/review.md`, `commands/adversarial-review.md`,
  `commands/rescue.md`, `commands/task.md`, `agents/glm-rescue.md`:
  wording updated to reflect per-command defaults + codex-`medium`
  alignment.
- `README.md`: generation table rewritten with explicit `Tier` column
  and newest-first ordering. "Thinking / reasoning" section rewritten
  with per-command default table.

### Non-breaking

- `--thinking on|off` still overrides on every command.
- No config file changes; no preset URL changes; no API shape changes.
- Users with `--thinking` explicitly in their invocations keep exact
  prior behavior. Users who never pass `--thinking` will now get `on`
  for review/adversarial-review/rescue (previously `off`).

## v0.3.1 — 2026-04-20

Benchmark-informed default model correction. Functional API unchanged
from v0.3.0; only the default model changes.

### Changed

- `scripts/lib/model-catalog.mjs`: `DEFAULT_MODEL` `glm-4.6` → `glm-5.1`.
- `scripts/lib/preset-config.mjs`: all three preset `default_model`
  fields updated `glm-4.6` → `glm-5.1`.
- `README.md`: rewrote "Model configuration" section with the benchmark
  rationale + re-sorted the commonly-useful table.
- `commands/review.md`, `commands/rescue.md`, `agents/glm-rescue.md`:
  updated default model reference + guidance.

### Why

v0.3.0 defaulted to `glm-4.6` without actually cross-checking against
codex's CLI default. Codex CLI default = `gpt-5.4` (flagship), not
`gpt-5.4-mini` (subagent tier). Picking `glm-4.6` as our default left us
two generations below codex's default tier.

Benchmark check:

| Model | AA Intelligence Index | SWE-Bench Pro |
|---|---|---|
| `gpt-5.4` (codex default) | 57 | — |
| `glm-5.1` | 51 | **58.4** (beats gpt-5.4, Claude Opus 4.6, Gemini 3.1 Pro) |
| `glm-5` | 50 | — |
| `glm-4.6` (previous default) | (older tier) | — |

`glm-5.1` is the closest open-weights tier to `gpt-5.4` on general
intelligence and *leads* on the SWE-Bench Pro coding axis. It's included
in all 智谱 Coding Plan subscription tiers (Max/Pro/Lite) since
2026-03-28. BenchLM aggregate: `glm-5.1` (84) vs `gpt-5.4-mini` (73),
confirming the direction.

### Notes

- Users whose v0.3.0 `~/.config/glm-plugin-cc/config.json` already has
  `default_model: "glm-4.6"` keep that — config-file value wins over the
  built-in default. Re-run `/glm:setup --preset <id>` to refresh to the
  new default, or pass `--default-model glm-5.1` explicitly.
- Thinking still defaults off. Turning on `--thinking on` with `glm-5.1`
  is the strongest mode; it costs latency and token budget.

## v0.3.0 — 2026-04-20

**Breaking**: API format switched from Anthropic-compatible to
**OpenAI-compatible**. This plugin never was meant to replace GLM as a
Claude Code CLI provider; it calls GLM from inside a session over
OpenAI-compatible HTTP. Preset URLs updated accordingly. Users on v0.2.0
must re-run `/glm:setup` (no auto-migration — the previous Anthropic
URLs would 404 against the new client).

### Changed

- `scripts/lib/glm-client.mjs` rewritten:
  - Endpoint now `${base_url}/chat/completions` (was `/v1/messages`).
  - Auth now `Authorization: Bearer <key>` (was `x-api-key`).
  - Request body uses OpenAI `messages[]` schema; `system` promoted to a
    first-role message (was top-level `system`).
  - Response parses `choices[0].message.content` (was `content[].text`).
  - Extracts `choices[0].message.reasoning_content` when present, exposed
    to `render.mjs` as `reasoningSummary`.
- Preset URLs switched to 智谱 BigModel OpenAI-compatible endpoints:
  - `coding-plan` → `https://open.bigmodel.cn/api/coding/paas/v4`
    (was `https://api.z.ai/api/anthropic`)
  - `pay-as-you-go` → `https://open.bigmodel.cn/api/paas/v4`
    (was `https://open.bigmodel.cn/api/anthropic`)
  - `custom` unchanged in shape; now expects OpenAI-compatible URL.
- Fallback base URL when no preset/env is set: now
  `https://open.bigmodel.cn/api/paas/v4` (was `https://api.z.ai/api/anthropic`).
- Preset `display` text rebranded to 智谱 BigModel (国内 default); overseas
  Z.AI or self-hosted endpoints go through `custom`.
- `commands/setup.md` menu wording updated.
- `commands/review.md`, `adversarial-review.md`, `task.md`, `rescue.md`,
  `agents/glm-rescue.md`: documented `--thinking on|off` flag and text-only
  model constraint.

### Added

- `scripts/lib/model-catalog.mjs`:
  - `DEFAULT_MODEL` constant (`glm-4.6`).
  - `isVisionModel(model)` + `assertNonVisionModel(model)` — reject vision
    models (`glm-4v`, `glm-4.5v`, `glm-4.6v`, `glm-4.1v-thinking`, etc.)
    so text-review commands fail fast instead of silently wasting tokens.
- `--thinking on|off` CLI flag for `review`, `adversarial-review`, `task`,
  `rescue`. Default `off` matches codex `--effort unset`; GLM routes via
  `thinking: {"type": "enabled" | "disabled"}` request field.
- `resolveModel()` now validates the selected model against the vision
  deny-list before any HTTP call.

### Security

- Error message on non-https base URLs still truncates long inputs to
  avoid echoing accidentally-pasted credentials (carried from v0.2.0).
- API key still env-only, never persisted.
- `ZAI_BASE_URL` still rejected unless `https://`.

### Rationale

- Clarified architectural intent after confusion in v0.1/v0.2: this plugin
  calls GLM from *inside* a Claude session over OpenAI-compatible HTTP,
  it does not swap Claude for GLM at the CLI provider layer.
- 国内智谱 `open.bigmodel.cn` is the default; 海外 Z.AI is reachable via the
  `custom` preset. Users on v0.2.0 with an Anthropic-format Z.AI URL in
  their config.json need to re-run `/glm:setup` — the plugin will throw
  a clear 404 error if they don't, rather than silently failing.
- Single default model + `--thinking off` by default mirror the
  codex-plugin-cc pattern (no per-command splits; reasoning opt-in).

## v0.2.0 — 2026-04-20

Endpoint preset system + command-layer cleanup. Key UX change: `/glm:setup`
is now interactive (menu-driven via `AskUserQuestion`) for first-time
configuration; behavior for existing env-only users is unchanged.

### Added

- `scripts/lib/preset-config.mjs` with three built-in presets:
  - `coding-plan` → `https://api.z.ai/api/anthropic` (Z.AI subscription)
  - `pay-as-you-go` → `https://open.bigmodel.cn/api/anthropic` (BigModel metered)
  - `custom` → user-provided `https://` endpoint
- Endpoint config persists to `~/.config/glm-plugin-cc/config.json`
  (XDG_CONFIG_HOME honored). Dir 0700, file 0600. API key is **never**
  written to disk — always read from `ZAI_API_KEY` env.
- `glm-companion.mjs setup` accepts `--preset`, `--base-url`,
  `--default-model`.
- `renderSetupReport` shows current endpoint config, env overrides, and
  all available presets.

### Changed

- Endpoint priority now: `ZAI_BASE_URL` env > config file preset >
  built-in fallback (`api.z.ai`). Model priority: `--model` arg >
  `GLM_MODEL` env > config `default_model` > `glm-4.6`.
- `commands/setup.md` rewritten to use `AskUserQuestion` menu for
  first-time setup. Removes the copy-paste `npm install -g` block that
  was incorrect (GLM has no external CLI — plugin IS the runtime).
- `commands/review.md` + `commands/adversarial-review.md` drop the
  `--wait` / `--background` argument-hint lies. Companion is sync-only.
  Both commands now correctly document sync foreground execution.
- `commands/status.md` drops `--wait` / `--timeout-ms` (polling
  leftovers from codex scaffold).
- `commands/cancel.md` description clarified: marks local record only,
  no server-side abort (GLM is stateless HTTP).
- `review.md` removed incorrect claim that focus text is unsupported.

### Security

- Config file written with mode 0600 (owner-only read/write).
- Config dir created with mode 0700, with a follow-up `chmodSync` in case
  the dir pre-existed with looser perms (defense-in-depth).
- `writeConfigFile` writes to a `.tmp-<pid>-<epoch>` file then
  `renameSync` — atomic swap prevents half-written state from concurrent
  `/glm:setup` runs.
- `applyPreset` and `sanitizeConfig` reject non-`https://` base URLs.
  Error messages truncate over-long URLs to avoid echoing
  accidentally-pasted credentials.
- No API key ever written to disk; env-only by design.

## v0.1.1 — 2026-04-20

Post-review fixes from internal sev-verifier + security-auditor passes.

- Add missing `commands/task.md` (sev-verifier finding: `/glm:task` was
  documented + dispatched but no slash-command frontmatter existed; Claude
  Code wouldn't register it).
- Enforce `https://` on `ZAI_BASE_URL` env override (security-auditor T5
  HIGH: plaintext endpoint would leak API key). Override now throws if
  scheme is not https.
- Validate job IDs and enforce path containment in
  `scripts/lib/state.mjs:resolveJobFile` / `resolveJobLogFile`
  (security-auditor T4: defense-in-depth against path traversal via
  malicious `--job-id ../../etc/passwd`). Pattern:
  `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`, max 128 chars; resolved path must
  stay inside jobs dir.

## v0.1.0 — 2026-04-20

Initial release.

- Plugin manifest (`.claude-plugin/plugin.json`) with 7 commands:
  `/glm:setup`, `/glm:review`, `/glm:adversarial-review`, `/glm:task`,
  `/glm:rescue`, `/glm:status`, `/glm:result`, `/glm:cancel`.
- `glm-rescue` subagent for delegated rescue workflows.
- GLM HTTP client (`scripts/lib/glm-client.mjs`): stateless POST to
  `https://api.z.ai/api/anthropic/v1/messages` with `x-api-key` auth.
  Handles 429 / 401 / 403 / 400 / timeout / network errors explicitly.
- Session-lifecycle hook retained from codex-plugin-cc scaffold for
  job-state bookkeeping.
- Stop-review-gate hook **omitted** by design: Claude-dev-harness
  `completion-stop-guard.sh` is the single Stop gate for the SEV
  quality loop.
- Zero runtime npm dependencies. Node >=18.18 required (for global
  `fetch`).
- Derived scaffold from `openai/codex-plugin-cc` (Apache-2.0);
  backend-specific code is original.
