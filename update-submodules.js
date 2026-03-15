#!/usr/bin/env node

/**
 * update-submodules.js
 * Recursively updates all Git submodules to the latest remote commit,
 * then (with --push) commits and pushes the updated refs up every parent repo.
 *
 * Usage:
 *   node update-submodules.js [repo-path] [options]
 *
 * Options:
 *   --push        Commit and push updated submodule refs in every parent repo
 *   --message <m> Commit message for pointer updates (default: "chore: update submodule refs")
 *   --dry-run     Show what would happen without making any changes
 *   --branch <b>  Default branch when none is declared in .gitmodules (default: main)
 *   --depth <n>   Max recursion depth (default: unlimited)
 *   --verbose     Show full git output
 *   --no-color    Disable colored output
 *
 * Examples:
 *   node update-submodules.js --push
 *   node update-submodules.js --push --message "ci: bump submodules"
 *   node update-submodules.js --dry-run
 *   node update-submodules.js /path/to/repo --push --branch master
 */

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// ─── CLI argument parsing ────────────────────────────────────────────────────

const args = process.argv.slice(2);

const options = {
  repoPath: process.cwd(),
  push: false,
  commitMessage: "chore: update submodule refs",
  dryRun: false,
  defaultBranch: "main",
  maxDepth: Infinity,
  verbose: false,
  color: true,
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--push") options.push = true;
  else if (arg === "--dry-run") options.dryRun = true;
  else if (arg === "--verbose") options.verbose = true;
  else if (arg === "--no-color") options.color = false;
  else if (arg === "--branch") options.defaultBranch = args[++i];
  else if (arg === "--message") options.commitMessage = args[++i];
  else if (arg === "--depth") options.maxDepth = parseInt(args[++i], 10);
  else if (!arg.startsWith("--")) options.repoPath = path.resolve(arg);
}

// ─── Colour helpers ──────────────────────────────────────────────────────────

const C = options.color
  ? {
      reset: "\x1b[0m",
      bold: "\x1b[1m",
      dim: "\x1b[2m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      cyan: "\x1b[36m",
      red: "\x1b[31m",
      magenta: "\x1b[35m",
      blue: "\x1b[34m",
    }
  : Object.fromEntries(
      [
        "reset",
        "bold",
        "dim",
        "green",
        "yellow",
        "cyan",
        "red",
        "magenta",
        "blue",
      ].map((k) => [k, ""]),
    );

// ─── Logging ─────────────────────────────────────────────────────────────────

const indent = (d) => "  ".repeat(d);
const log = (d, sym, col, msg) =>
  console.log(`${indent(d)}${col}${sym} ${msg}${C.reset}`);
const info = (d, m) => log(d, "›", C.cyan, m);
const success = (d, m) => log(d, "✔", C.green, m);
const warn = (d, m) => log(d, "⚠", C.yellow, m);
const error = (d, m) => log(d, "✘", C.red, m);
const header = (d, m) => log(d, "▸", C.bold + C.magenta, m);
const pushed = (d, m) => log(d, "↑", C.bold + C.green, m);
const verbose = (d, m) => {
  if (options.verbose) log(d, " ", C.dim, m);
};

// ─── Git helpers ─────────────────────────────────────────────────────────────

function git(cwd, ...gitArgs) {
  const r = spawnSync("git", gitArgs, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return {
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
    ok: r.status === 0,
  };
}

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

function parseGitmodules(repoDir) {
  const gmPath = path.join(repoDir, ".gitmodules");
  if (!fs.existsSync(gmPath)) return [];

  const submodules = [];
  let cur = null;

  for (const rawLine of fs.readFileSync(gmPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const sec = line.match(/^\[submodule\s+"(.+)"\]$/);
    if (sec) {
      cur = { name: sec[1], path: null, url: null, branch: null };
      submodules.push(cur);
      continue;
    }
    if (!cur) continue;

    const kv = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (kv) {
      if (kv[1] === "path") cur.path = kv[2];
      if (kv[1] === "url") cur.url = kv[2];
      if (kv[1] === "branch") cur.branch = kv[2];
    }
  }
  return submodules.filter((s) => s.path);
}

function resolveBranch(dir, declared) {
  if (declared) return declared;
  const r = git(dir, "remote", "show", "origin");
  if (r.ok) {
    const m = r.stdout.match(/HEAD branch:\s+(\S+)/);
    if (m) return m[1];
  }
  return options.defaultBranch;
}

/** True when the index has staged changes */
function hasStagedChanges(dir) {
  return !git(dir, "diff", "--cached", "--quiet").ok;
}

// ─── Statistics ───────────────────────────────────────────────────────────────

const stats = {
  updated: 0,
  upToDate: 0,
  skipped: 0,
  failed: 0,
  committed: 0,
  pushed: 0,
  total: 0,
};

// ─── Phase 1 — pull every submodule to the remote tip ────────────────────────

/**
 * Fetch + reset every submodule inside repoDir to origin/<branch>.
 * Stages the updated .gitmodules pointer in the immediate parent.
 * Returns true when at least one pointer changed (so caller can re-stage).
 */
function pullSubmodules(repoDir, depth = 0) {
  if (depth > options.maxDepth) {
    warn(depth, `Max depth reached.`);
    return false;
  }

  const submodules = parseGitmodules(repoDir);
  if (!submodules.length) {
    verbose(depth, "No submodules.");
    return false;
  }

  let anyChanged = false;

  for (const sub of submodules) {
    const subDir = path.resolve(repoDir, sub.path);
    stats.total++;

    header(depth, `${sub.name}  ${C.dim}(${sub.path})${C.reset}`);

    // Init if missing
    if (!fs.existsSync(subDir) || !isGitRepo(subDir)) {
      info(depth + 1, "Not initialised — running git submodule update --init");
      if (!options.dryRun) {
        const init = git(
          repoDir,
          "submodule",
          "update",
          "--init",
          "--",
          sub.path,
        );
        if (!init.ok) {
          error(depth + 1, `Init failed: ${init.stderr}`);
          stats.failed++;
          continue;
        }
      }
    }

    if (!fs.existsSync(subDir)) {
      warn(depth + 1, "Directory missing after init — skipping.");
      stats.skipped++;
      continue;
    }

    // Fetch
    info(depth + 1, "Fetching from origin…");
    if (!options.dryRun) {
      const f = git(subDir, "fetch", "--prune", "origin");
      if (!f.ok) warn(depth + 1, `Fetch warning: ${f.stderr}`);
      else verbose(depth + 1, f.stderr || "fetch ok");
    }

    // Resolve branch + remote tip
    const branch = resolveBranch(subDir, sub.branch);
    const remoteRef = `origin/${branch}`;
    const remoteTip = git(subDir, "rev-parse", remoteRef).stdout;

    info(depth + 1, `Branch: ${C.bold}${branch}${C.reset}`);

    if (!remoteTip) {
      warn(depth + 1, `Cannot resolve ${remoteRef} — skipping.`);
      stats.skipped++;
      continue;
    }

    const beforeHash = git(subDir, "rev-parse", "HEAD").stdout;

    // Dry-run
    if (options.dryRun) {
      if (beforeHash === remoteTip) {
        success(depth + 1, `Up to date (${remoteTip.slice(0, 8)})`);
        stats.upToDate++;
      } else {
        success(
          depth + 1,
          `Would update  ${C.dim}${beforeHash.slice(0, 8)}${C.reset} → ${C.bold}${C.green}${remoteTip.slice(0, 8)}${C.reset}  (dry-run)`,
        );
        stats.updated++;
        anyChanged = true;
      }
      pullSubmodules(subDir, depth + 1);
      continue;
    }

    // Checkout -B <branch> <remoteRef>  →  moves branch pointer to remote tip
    const co = git(subDir, "checkout", "-B", branch, remoteRef);
    if (!co.ok) {
      const co2 = git(subDir, "checkout", branch);
      if (!co2.ok) {
        error(depth + 1, `Cannot checkout '${branch}': ${co2.stderr}`);
        stats.failed++;
        continue;
      }
      const rs = git(subDir, "reset", "--hard", remoteRef);
      if (!rs.ok) {
        error(depth + 1, `reset --hard failed: ${rs.stderr}`);
        stats.failed++;
        continue;
      }
      verbose(depth + 1, rs.stdout);
    } else {
      verbose(depth + 1, co.stdout || co.stderr);
    }

    const afterHash = git(subDir, "rev-parse", "HEAD").stdout;

    // Stage updated pointer in parent
    git(repoDir, "add", sub.path);

    if (beforeHash === afterHash) {
      success(depth + 1, `Already up to date (${afterHash.slice(0, 8)})`);
      stats.upToDate++;
    } else {
      success(
        depth + 1,
        `Updated  ${C.dim}${beforeHash.slice(0, 8)}${C.reset} → ${C.bold}${C.green}${afterHash.slice(0, 8)}${C.reset}`,
      );
      stats.updated++;
      anyChanged = true;
    }

    // Recurse — if a nested pointer changed, re-stage this submodule in its parent
    if (pullSubmodules(subDir, depth + 1)) {
      git(repoDir, "add", sub.path);
      anyChanged = true;
    }
  }

  return anyChanged;
}

// ─── Phase 2 — commit + push updated refs, innermost repos first ─────────────

/**
 * Depth-first traversal: commit + push innermost repos before outer ones,
 * so that by the time the root repo is pushed, all nested pointers are live.
 */
function commitAndPush(repoDir, label, depth = 0) {
  // Recurse into children first
  for (const sub of parseGitmodules(repoDir)) {
    const subDir = path.resolve(repoDir, sub.path);
    if (fs.existsSync(subDir) && isGitRepo(subDir)) {
      commitAndPush(subDir, sub.name, depth + 1);
    }
  }

  if (!hasStagedChanges(repoDir)) {
    verbose(depth, `${label}: nothing staged — skipping`);
    return;
  }

  const branch = resolveBranch(repoDir, null);
  info(
    depth,
    `${C.bold}${label}${C.reset} — committing updated refs on ${C.bold}${branch}${C.reset}…`,
  );

  if (options.dryRun) {
    warn(depth, `Would commit + push '${label}' → origin/${branch}  (dry-run)`);
    stats.committed++;
    stats.pushed++;
    return;
  }

  const commit = git(repoDir, "commit", "-m", options.commitMessage);
  if (!commit.ok) {
    if (/nothing to commit/.test(commit.stdout + commit.stderr)) {
      verbose(depth, `${label}: nothing to commit`);
      return;
    }
    error(depth, `Commit failed in '${label}': ${commit.stderr}`);
    stats.failed++;
    return;
  }
  verbose(depth, commit.stdout);
  stats.committed++;

  info(depth, `Pushing ${C.bold}${label}${C.reset} → origin/${branch}…`);
  const pushR = git(repoDir, "push", "origin", branch);
  if (!pushR.ok) {
    error(depth, `Push failed in '${label}': ${pushR.stderr}`);
    stats.failed++;
    return;
  }
  pushed(depth, `${C.bold}${label}${C.reset} → origin/${branch}`);
  stats.pushed++;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function main() {
  console.log();
  console.log(
    `${C.bold}${C.blue}╔══════════════════════════════════════════╗${C.reset}`,
  );
  console.log(
    `${C.bold}${C.blue}║   Git Submodule Recursive Updater        ║${C.reset}`,
  );
  console.log(
    `${C.bold}${C.blue}╚══════════════════════════════════════════╝${C.reset}`,
  );
  console.log();

  if (!isGitRepo(options.repoPath)) {
    error(0, `Not a git repository: ${options.repoPath}`);
    process.exit(1);
  }

  info(0, `Repository     : ${C.bold}${options.repoPath}${C.reset}`);
  info(0, `Default branch : ${C.bold}${options.defaultBranch}${C.reset}`);
  info(
    0,
    `Push mode      : ${options.push ? C.bold + C.green + "ON" : C.dim + "OFF"}${C.reset}`,
  );
  if (options.dryRun) warn(0, "DRY RUN — no changes will be made");
  if (options.maxDepth !== Infinity)
    info(0, `Max depth      : ${options.maxDepth}`);
  console.log();

  const t0 = Date.now();

  // ── Phase 1 ───────────────────────────────────────────────────────────────
  console.log(
    `${C.bold}${C.cyan}Phase 1 — Pull submodules to latest remote commit${C.reset}`,
  );
  console.log();
  pullSubmodules(options.repoPath, 0);

  // ── Phase 2 ───────────────────────────────────────────────────────────────
  if (options.push) {
    console.log();
    console.log(
      `${C.bold}${C.cyan}Phase 2 — Commit & push updated refs (innermost → root)${C.reset}`,
    );
    console.log();
    commitAndPush(options.repoPath, path.basename(options.repoPath), 0);
  } else {
    console.log();
    warn(
      0,
      `Refs staged locally but NOT pushed. Re-run with ${C.bold}--push${C.reset}${C.yellow} to commit & push.`,
    );
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  console.log();
  console.log(
    `${C.bold}${C.blue}─────────────────────────────────────────${C.reset}`,
  );
  console.log(`${C.bold}Summary${C.reset}`);
  console.log(`  ${C.green}✔ Updated    : ${stats.updated}${C.reset}`);
  console.log(`  ${C.cyan}· Up to date : ${stats.upToDate}${C.reset}`);
  if (options.push) {
    console.log(`  ${C.green}↑ Committed  : ${stats.committed}${C.reset}`);
    console.log(`  ${C.green}↑ Pushed     : ${stats.pushed}${C.reset}`);
  }
  console.log(`  ${C.yellow}⚠ Skipped    : ${stats.skipped}${C.reset}`);
  console.log(`  ${C.red}✘ Failed     : ${stats.failed}${C.reset}`);
  console.log(
    `  ${C.dim}  Total      : ${stats.total}  (${elapsed}s)${C.reset}`,
  );
  console.log();

  if (stats.failed > 0) process.exit(1);
}

main();
