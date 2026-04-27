import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = path.join(repoRoot, "skills", "glm-review-workflow", "SKILL.md");
const packetSchemaPath = path.join(repoRoot, "schemas", "review-packet.schema.json");

function readSkill() {
  return fs.readFileSync(skillPath, "utf8");
}

function actualPacketSchemaSha256() {
  return crypto.createHash("sha256")
    .update(fs.readFileSync(packetSchemaPath))
    .digest("hex");
}

test("M8C host skill exists and pins packet schema contract", () => {
  const skill = readSkill();
  assert.match(skill, /^---\nname: glm-review-workflow\n/m);
  assert.match(skill, /review-packet\/v1/);
  assert.match(
    skill,
    /05f9027777ec34166c93a22bdd0fffaa3b649906968f25ca67503d1060b59cc4/
  );
});

test("M8C host skill keeps external tools under host permission model", () => {
  const skill = readSkill();
  assert.match(skill, /host agent's existing permission model/);
  assert.match(skill, /The GLM plugin should remain a provider and\s+packet emitter, not a tool aggregator\./);
  assert.match(skill, /No external scanner integration\./);
  assert.match(skill, /No local tool discovery\./);
});

test("M8C host skill does not introduce a council or persona workflow", () => {
  const skill = readSkill();
  assert.match(skill, /No default council or persona workflow in v1\./);
  assert.doesNotMatch(skill, /Phase 1.*Phase 2.*Phase 3/s);
});

test("M8C host skill requires packet/context checks before trusting findings", () => {
  const skill = readSkill();
  assert.match(skill, /If the stored result has no `packet`/);
  assert.match(skill, /context-failed/);
  assert.match(skill, /`context\.omitted_files` is a warning list/);
  assert.match(skill, /Do not ask GLM to\s+self-report provenance/);
});

test("M8C host skill defines the concise crosscheck report sections", () => {
  const skill = readSkill();
  for (const section of [
    "Packet Warnings",
    "Verified Findings",
    "Unverified Findings",
    "Contradicted Findings",
    "Deferred",
    "Next Steps"
  ]) {
    assert.match(skill, new RegExp(`## ${section}`));
  }
});

// Self-consistency guard: the prior tests assert SKILL.md contains a
// literal hash string, but they cannot detect a future change to
// `schemas/review-packet.schema.json` that silently invalidates the pin.
// Compute the actual sha256 here and require it to be the one quoted in
// SKILL.md, so any schema edit forces the host-skill pointer to update
// in the same PR (or fails the test, which is the point).
test("M8C pinned packet-schema sha256 matches the actual schema file", () => {
  const skill = readSkill();
  const expected = actualPacketSchemaSha256();
  assert.match(
    skill,
    new RegExp(expected),
    `SKILL.md no longer pins the current schemas/review-packet.schema.json sha256.\n` +
      `  Actual: ${expected}\n` +
      `  Update the host skill or revert the schema change in the same PR.`
  );
});
