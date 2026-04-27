#!/usr/bin/env node
/**
 * ESM import-resolution check for lib modules.
 *
 * `node --check` (syntax check) does NOT resolve ESM imports — that's
 * how v0.3.3 shipped with session-lifecycle-hook.mjs importing two
 * non-existent modules (`./lib/app-server.mjs`, `./lib/broker-lifecycle.mjs`).
 * Every `SessionStart` / `SessionEnd` crashed because of it.
 *
 * This helper actually imports each lib module so broken imports fail
 * loudly in `npm run check`.
 *
 * We intentionally DO NOT import `scripts/glm-companion.mjs` or
 * `scripts/session-lifecycle-hook.mjs` here because they have top-level
 * `main()` calls that would execute (block on stdin / run work). Their
 * imports are covered by `node --check` for syntax and by the `npm run
 * check` pipeline; any broken import in those two surfaces when the
 * plugin actually starts.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

import { formatUserFacingError } from "./lib/fs.mjs";

const LIB_MODULES = [
  "args.mjs",
  "fs.mjs",
  "git.mjs",
  "glm-client.mjs",
  "job-control.mjs",
  "model-catalog.mjs",
  "preset-config.mjs",
  "process.mjs",
  "prompts.mjs",
  "repo-checks.mjs",
  "render.mjs",
  "state.mjs",
  "tracked-jobs.mjs",
  "workspace.mjs"
];

const here = path.dirname(fileURLToPath(import.meta.url));

let failed = 0;
for (const name of LIB_MODULES) {
  const specifier = path.join(here, "lib", name);
  try {
    await import(specifier);
  } catch (error) {
    failed += 1;
    process.stderr.write(`[check-imports] FAIL ${name}: ${formatUserFacingError(error)}\n`);
  }
}

if (failed === 0) {
  process.stdout.write(`[check-imports] OK (${LIB_MODULES.length} modules)\n`);
  process.exit(0);
}
process.stderr.write(`[check-imports] ${failed} module(s) failed\n`);
process.exit(1);
