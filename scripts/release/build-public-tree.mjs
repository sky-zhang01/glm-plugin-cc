#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const MANIFEST_PATH = path.join(REPO_ROOT, "public-surface.json");

function parseArgs(argv) {
  const args = { ref: "HEAD", out: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--ref") {
      args.ref = argv[++i];
    } else if (arg === "--out") {
      args.out = path.resolve(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.out) {
    const short = execFileSync("git", ["rev-parse", "--short", args.ref], {
      cwd: REPO_ROOT,
      encoding: "utf8"
    }).trim();
    args.out = path.join(os.tmpdir(), `glm-plugin-cc-public-${short}`);
  }
  return args;
}

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    const next = glob[i + 1];
    if (char === "*" && next === "*") {
      const after = glob[i + 2];
      if (after === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += escapeRegex(char);
    }
  }
  return new RegExp(`${out}$`);
}

function trackedFiles(ref) {
  return execFileSync("git", ["ls-tree", "-r", "--name-only", ref], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  }).trim().split(/\r?\n/).filter(Boolean);
}

function removePath(absPath) {
  if (existsSync(absPath)) {
    rmSync(absPath, { recursive: true, force: true });
  }
}

function readTextIfReasonable(absPath) {
  const buf = readFileSync(absPath);
  if (buf.includes(0)) return null;
  return buf.toString("utf8");
}

function applyPublicRewrites(root, files, rewrites) {
  const compiled = (rewrites || []).map((rewrite) => ({
    ...rewrite,
    re: globToRegExp(rewrite.glob || "")
  }));
  for (const file of files) {
    const matching = compiled.filter((rewrite) => rewrite.re.test(file));
    if (matching.length === 0) continue;
    const abs = path.join(root, file);
    if (!existsSync(abs)) continue;
    const original = readTextIfReasonable(abs);
    if (original === null) continue;
    let next = original;
    for (const rewrite of matching) {
      next = next.replace(new RegExp(rewrite.pattern, "gu"), rewrite.replacement || "");
    }
    if (next !== original) {
      writeFileSync(abs, next);
    }
  }
}

function pruneEmptyDirs(root, rel = "") {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) {
    return;
  }
  const st = statSync(abs);
  if (!st.isDirectory()) {
    return;
  }
  for (const entry of readdirSync(abs)) {
    const childRel = rel ? `${rel}/${entry}` : entry;
    pruneEmptyDirs(root, childRel);
  }
  if (rel) {
    if (readdirSync(abs).length === 0) {
      removePath(abs);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();
  const outParent = path.dirname(args.out);
  const tempOut = mkdtempSync(path.join(outParent, ".public-tree-"));
  try {
    const archive = spawnSync("git", ["archive", "--format=tar", args.ref], {
      cwd: REPO_ROOT,
      encoding: null,
      maxBuffer: 200 * 1024 * 1024
    });
    if (archive.status !== 0) {
      throw new Error(`git archive failed: ${archive.stderr?.toString("utf8") || archive.status}`);
    }
    const untar = spawnSync("tar", ["-xf", "-", "-C", tempOut], {
      input: archive.stdout,
      encoding: null,
      maxBuffer: 200 * 1024 * 1024
    });
    if (untar.status !== 0) {
      throw new Error(`tar extract failed: ${untar.stderr?.toString("utf8") || untar.status}`);
    }

    const files = trackedFiles(args.ref);
    const excludes = (manifest.public_exclude || []).map((glob) => globToRegExp(glob));
    for (const file of files) {
      if (excludes.some((re) => re.test(file))) {
        removePath(path.join(tempOut, file));
      }
    }
    applyPublicRewrites(tempOut, files, manifest.public_rewrites || []);
    pruneEmptyDirs(tempOut);

    const check = spawnSync("node", [
      path.join(REPO_ROOT, "scripts/ci/check-public-surface.mjs"),
      "--root", tempOut,
      "--public-tree"
    ], {
      cwd: REPO_ROOT,
      encoding: "utf8"
    });
    process.stdout.write(check.stdout || "");
    process.stderr.write(check.stderr || "");
    if (check.status !== 0) {
      throw new Error("public surface check failed");
    }

    removePath(args.out);
    execFileSync("mv", [tempOut, args.out]);
    console.log(`Public tree written: ${args.out}`);
    console.log("Review the tree before pushing it to any public remote.");
  } catch (err) {
    removePath(tempOut);
    throw err;
  }
}

main();
