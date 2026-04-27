#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const MANIFEST_PATH = path.join(REPO_ROOT, "public-surface.json");

function parseArgs(argv) {
  const args = { mode: "source", root: REPO_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--public-tree") {
      args.mode = "public-tree";
    } else if (arg === "--root") {
      args.root = path.resolve(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function originLooksLikeGithub(root) {
  try {
    const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: root,
      encoding: "utf8"
    }).trim();
    return remote.includes("github.com");
  } catch {
    return false;
  }
}

function loadManifest(root) {
  if (!existsSync(MANIFEST_PATH)) {
    if (originLooksLikeGithub(root)) {
      return null;
    }
    throw new Error("public-surface.json is required in the development repository");
  }
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
  out += "$";
  return new RegExp(out);
}

function compileGlobs(patterns) {
  return patterns.map((pattern) => ({ pattern, re: globToRegExp(pattern) }));
}

function matchesAny(file, compiled) {
  return compiled.some(({ re }) => re.test(file));
}

function trackedFiles(root, mode) {
  if (mode === "source" && root === REPO_ROOT) {
    const out = execFileSync("git", ["ls-files", "-z"], { cwd: root });
    return out.toString("utf8").split("\0").filter(Boolean).sort();
  }
  const files = [];
  walk(root, "", files);
  return files.sort();
}

function walk(root, rel, files) {
  const dir = path.join(root, rel);
  for (const entry of readdirSync(dir)) {
    if (entry === ".git" || entry === "node_modules") continue;
    const childRel = rel ? `${rel}/${entry}` : entry;
    const childAbs = path.join(root, childRel);
    const st = statSync(childAbs);
    if (st.isDirectory()) {
      walk(root, childRel, files);
    } else if (st.isFile()) {
      files.push(childRel);
    }
  }
}

function readTextIfReasonable(absPath) {
  const buf = readFileSync(absPath);
  if (buf.includes(0)) return null;
  return buf.toString("utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest(args.root);
  if (manifest === null) {
    console.log("OK — public surface manifest absent in public GitHub checkout; primary projection gate runs before mirroring.");
    return;
  }
  const publicDocSet = new Set(manifest.public_docs || []);
  const excluded = compileGlobs(manifest.public_exclude || []);
  const files = trackedFiles(args.root, args.mode);
  const errors = [];

  for (const file of files) {
    if (file.startsWith("docs/") && !publicDocSet.has(file) && !matchesAny(file, excluded)) {
      errors.push(`unclassified docs file: ${file}`);
    }
    if (args.mode === "public-tree" && matchesAny(file, excluded)) {
      errors.push(`excluded file present in public tree: ${file}`);
    }
  }

  const publicCandidates = files.filter((file) => !matchesAny(file, excluded));
  if (args.mode === "public-tree") {
    for (const item of manifest.forbidden_patterns || []) {
      const re = new RegExp(item.pattern);
      const scopedCandidates = Array.isArray(item.globs)
        ? publicCandidates.filter((file) => matchesAny(file, compileGlobs(item.globs)))
        : publicCandidates;
      for (const file of scopedCandidates) {
        const abs = path.join(args.root, file);
        if (!existsSync(abs)) continue;
        const text = readTextIfReasonable(abs);
        if (text === null) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            errors.push(`${item.label}: ${file}:${i + 1}`);
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error("FAIL — public surface check failed:");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log(`OK — public surface clean (${args.mode}, ${publicCandidates.length} public candidate files).`);
}

main();
