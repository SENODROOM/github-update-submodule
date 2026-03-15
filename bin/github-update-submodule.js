#!/usr/bin/env node

/**
 * github-update-submodule v2.0.0
 *
 * Recursively pulls all Git submodules to their latest remote commit,
 * then commits and pushes the updated refs up every parent repo.
 *
 * New in v2: --interactive, --ignore, --parallel, progress bar,
 *            GitHub compare links, .submodulerc / submodule.config.json
 *
 * Usage:
 *   github-update-submodule [repo-path] [options]
 *
 * Options:
 *   --no-push            Skip committing and pushing (local update only)
 *   --interactive        Prompt before pushing each parent repo
 *   --ignore <n>         Submodule name to skip (repeatable)
 *   --parallel           Fetch all submodules concurrently
 *   --message  <m>       Commit message (default: "chore: update submodule refs")
 *   --dry-run            Preview changes without modifying anything
 *   --branch   <b>       Default branch when not in .gitmodules (default: main)
 *   --depth    <n>       Max recursion depth (default: unlimited)
 *   --verbose            Show full git output
 *   --no-color           Disable colored output
 *   --no-progress        Disable the progress bar
 *   --make-config        Generate a submodule.config.json in the current repo and exit
 */

const { spawnSync, spawn } = require("child_process");
const path    = require("path");
const fs      = require("fs");
const readline = require("readline");

// ─── Config file loader ───────────────────────────────────────────────────────
// Reads .submodulerc or submodule.config.json from cwd.
// CLI flags always override config values.

function loadConfig(repoPath) {
  const candidates = [
    path.join(repoPath, ".submodulerc"),
    path.join(repoPath, "submodule.config.json"),
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) {
      try {
        const raw = fs.readFileSync(f, "utf8").trim();
        const cfg = JSON.parse(raw);
        return cfg;
      } catch (e) {
        console.warn(`⚠ Could not parse config file ${f}: ${e.message}`);
      }
    }
  }
  return {};
}

// ─── CLI argument parsing ────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);

// Defaults (lowest priority)
const options = {
  repoPath:      process.cwd(),
  push:          true,
  interactive:   false,
  ignore:        [],          // array of submodule names to skip
  parallel:      false,
  commitMessage: "chore: update submodule refs",
  dryRun:        false,
  defaultBranch: "main",
  maxDepth:      Infinity,
  verbose:       false,
  color:         true,
  progress:      true,
};

// Collect positional repo path first so config is loaded from correct dir
for (let i = 0; i < cliArgs.length; i++) {
  if (!cliArgs[i].startsWith("--")) options.repoPath = path.resolve(cliArgs[i]);
}

// Merge config file (overrides defaults, CLI will override config)
const cfg = loadConfig(options.repoPath);
if (cfg.push          !== undefined) options.push          = cfg.push;
if (cfg.interactive   !== undefined) options.interactive   = cfg.interactive;
if (cfg.ignore        !== undefined) options.ignore        = [].concat(cfg.ignore);
if (cfg.parallel      !== undefined) options.parallel      = cfg.parallel;
if (cfg.commitMessage !== undefined) options.commitMessage = cfg.commitMessage;
if (cfg.defaultBranch !== undefined) options.defaultBranch = cfg.defaultBranch;
if (cfg.maxDepth      !== undefined) options.maxDepth      = cfg.maxDepth;
if (cfg.verbose       !== undefined) options.verbose       = cfg.verbose;
if (cfg.color         !== undefined) options.color         = cfg.color;
if (cfg.progress      !== undefined) options.progress      = cfg.progress;

// CLI flags (highest priority)
for (let i = 0; i < cliArgs.length; i++) {
  const a = cliArgs[i];
  if      (a === "--no-push")      options.push          = false;
  else if (a === "--interactive")  options.interactive   = true;
  else if (a === "--parallel")     options.parallel      = true;
  else if (a === "--dry-run")      options.dryRun        = true;
  else if (a === "--verbose")      options.verbose       = true;
  else if (a === "--no-color")     options.color         = false;
  else if (a === "--no-progress")  options.progress      = false;
  else if (a === "--make-config")  options.makeConfig    = true;
  else if (a === "--branch")       options.defaultBranch = cliArgs[++i];
  else if (a === "--message")      options.commitMessage = cliArgs[++i];
  else if (a === "--depth")        options.maxDepth      = parseInt(cliArgs[++i], 10);
  else if (a === "--ignore")       options.ignore.push(cliArgs[++i]);
}

// ─── Colour helpers ──────────────────────────────────────────────────────────

const C = options.color
  ? { reset:"\x1b[0m", bold:"\x1b[1m", dim:"\x1b[2m", green:"\x1b[32m",
      yellow:"\x1b[33m", cyan:"\x1b[36m", red:"\x1b[31m", magenta:"\x1b[35m",
      blue:"\x1b[34m",   white:"\x1b[37m" }
  : Object.fromEntries(
      ["reset","bold","dim","green","yellow","cyan","red","magenta","blue","white"].map(k=>[k,""])
    );

// ─── Logging ─────────────────────────────────────────────────────────────────

const indent  = (d) => "  ".repeat(d);
const log     = (d, sym, col, msg) => console.log(`${indent(d)}${col}${sym} ${msg}${C.reset}`);
const info    = (d, m) => log(d, "›", C.cyan,             m);
const success = (d, m) => log(d, "✔", C.green,            m);
const warn    = (d, m) => log(d, "⚠", C.yellow,           m);
const error   = (d, m) => log(d, "✘", C.red,              m);
const header  = (d, m) => log(d, "▸", C.bold + C.magenta, m);
const pushLog = (d, m) => log(d, "↑", C.bold + C.green,   m);
const linkLog = (d, m) => log(d, "⎘", C.bold + C.blue,    m);
const verbose = (d, m) => { if (options.verbose) log(d, " ", C.dim, m); };

// ─── Progress bar ─────────────────────────────────────────────────────────────

const progress = {
  total:   0,
  current: 0,
  active:  false,

  init(total) {
    if (!options.progress || !process.stdout.isTTY) return;
    this.total   = total;
    this.current = 0;
    this.active  = true;
    this._render();
  },

  tick(label = "") {
    if (!this.active) return;
    this.current++;
    this._render(label);
    if (this.current >= this.total) this.done();
  },

  done() {
    if (!this.active) return;
    this.active = false;
    process.stdout.write("\r\x1b[K"); // clear line
  },

  _render(label = "") {
    const W       = 28;
    const filled  = Math.round((this.current / this.total) * W);
    const empty   = W - filled;
    const bar     = C.green + "█".repeat(filled) + C.dim + "░".repeat(empty) + C.reset;
    const pct     = String(Math.round((this.current / this.total) * 100)).padStart(3);
    const counter = `${this.current}/${this.total}`;
    const lbl     = label ? `  ${C.dim}${label.slice(0, 24)}${C.reset}` : "";
    process.stdout.write(`\r${C.bold}[${bar}${C.bold}] ${pct}% (${counter})${lbl}\x1b[K`);
  },
};

// ─── GitHub compare URL helper ────────────────────────────────────────────────

function getRemoteUrl(dir) {
  const r = git(dir, "remote", "get-url", "origin");
  return r.ok ? r.stdout : null;
}

function buildCompareUrl(remoteUrl, oldHash, newHash) {
  if (!remoteUrl) return null;

  let url = remoteUrl.trim();

  // SSH  → HTTPS:  git@github.com:org/repo.git  →  https://github.com/org/repo
  if (url.startsWith("git@github.com:")) {
    url = url.replace("git@github.com:", "https://github.com/");
  }
  // Strip .git suffix
  url = url.replace(/\.git$/, "");

  // Only emit links for github.com repos
  if (!url.includes("github.com")) return null;

  return `${url}/compare/${oldHash.slice(0, 8)}...${newHash.slice(0, 8)}`;
}

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
    ok:     r.status === 0,
  };
}

// Async version used by parallel fetch
function gitAsync(cwd, ...gitArgs) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "";
    const proc = spawn("git", gitArgs, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    proc.stdout.on("data", d => { stdout += d; });
    proc.stderr.on("data", d => { stderr += d; });
    proc.on("close", status => resolve({
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      ok: status === 0,
    }));
  });
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
      if (kv[1] === "path")   cur.path   = kv[2];
      if (kv[1] === "url")    cur.url    = kv[2];
      if (kv[1] === "branch") cur.branch = kv[2];
    }
  }
  return submodules.filter(s => s.path);
}

/** Flatten the full submodule tree for progress bar counting */
function countAllSubmodules(repoDir, depth = 0) {
  if (depth > options.maxDepth) return 0;
  let n = 0;
  for (const sub of parseGitmodules(repoDir)) {
    if (options.ignore.includes(sub.name)) continue;
    n++;
    const subDir = path.resolve(repoDir, sub.path);
    if (fs.existsSync(subDir)) n += countAllSubmodules(subDir, depth + 1);
  }
  return n;
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

function hasStagedChanges(dir) {
  return !git(dir, "diff", "--cached", "--quiet").ok;
}

// ─── Interactive prompt ───────────────────────────────────────────────────────

function askUser(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase()); });
  });
}

// ─── Statistics ───────────────────────────────────────────────────────────────

const stats = {
  updated: 0, upToDate: 0, skipped: 0, ignored: 0,
  failed: 0, committed: 0, pushed: 0, total: 0,
};

// ─── Phase 1 — parallel fetch pass ───────────────────────────────────────────

/**
 * Collect every submodule directory in the tree (flat list) so we can
 * fire all fetches concurrently in --parallel mode.
 */
function collectSubmoduleDirs(repoDir, depth = 0, out = []) {
  if (depth > options.maxDepth) return out;
  for (const sub of parseGitmodules(repoDir)) {
    if (options.ignore.includes(sub.name)) continue;
    const subDir = path.resolve(repoDir, sub.path);
    if (fs.existsSync(subDir) && isGitRepo(subDir)) {
      out.push(subDir);
      collectSubmoduleDirs(subDir, depth + 1, out);
    }
  }
  return out;
}

async function parallelFetchAll(repoDir) {
  const dirs = collectSubmoduleDirs(repoDir);
  if (!dirs.length) return;

  info(0, `Parallel fetching ${C.bold}${dirs.length}${C.reset} submodules…`);
  progress.init(dirs.length);

  await Promise.all(dirs.map(async (dir) => {
    await gitAsync(dir, "fetch", "--prune", "origin");
    progress.tick(path.basename(dir));
  }));

  progress.done();
  console.log();
}

// ─── Phase 1 — sequential update pass ────────────────────────────────────────

function pullSubmodules(repoDir, depth = 0) {
  if (depth > options.maxDepth) { warn(depth, "Max depth reached."); return false; }

  const submodules = parseGitmodules(repoDir);
  if (!submodules.length) { verbose(depth, "No submodules."); return false; }

  let anyChanged = false;

  for (const sub of submodules) {
    const subDir = path.resolve(repoDir, sub.path);
    stats.total++;

    // ── Ignore list ───────────────────────────────────────────────────────
    if (options.ignore.includes(sub.name)) {
      log(depth, "⊘", C.dim, `${sub.name}  ${C.dim}(ignored)${C.reset}`);
      stats.ignored++;
      continue;
    }

    header(depth, `${sub.name}  ${C.dim}(${sub.path})${C.reset}`);

    // ── Init if missing ───────────────────────────────────────────────────
    if (!fs.existsSync(subDir) || !isGitRepo(subDir)) {
      info(depth + 1, "Not initialised — running git submodule update --init");
      if (!options.dryRun) {
        const init = git(repoDir, "submodule", "update", "--init", "--", sub.path);
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

    // ── Fetch (sequential mode; parallel mode already fetched above) ──────
    if (!options.parallel) {
      info(depth + 1, "Fetching from origin…");
      if (!options.dryRun) {
        const f = git(subDir, "fetch", "--prune", "origin");
        if (!f.ok) warn(depth + 1, `Fetch warning: ${f.stderr}`);
        else verbose(depth + 1, f.stderr || "fetch ok");
      }
      // Update progress bar in sequential mode
      progress.tick(sub.name);
    }

    // ── Resolve branch + remote tip ───────────────────────────────────────
    const branch    = resolveBranch(subDir, sub.branch);
    const remoteRef = `origin/${branch}`;
    const remoteTip = git(subDir, "rev-parse", remoteRef).stdout;

    info(depth + 1, `Branch: ${C.bold}${branch}${C.reset}`);

    if (!remoteTip) {
      warn(depth + 1, `Cannot resolve ${remoteRef} — skipping.`);
      stats.skipped++;
      continue;
    }

    const beforeHash = git(subDir, "rev-parse", "HEAD").stdout;
    const remoteUrl  = getRemoteUrl(subDir);

    // ── Dry-run ───────────────────────────────────────────────────────────
    if (options.dryRun) {
      if (beforeHash === remoteTip) {
        success(depth + 1, `Up to date (${remoteTip.slice(0, 8)})`);
        stats.upToDate++;
      } else {
        success(depth + 1,
          `Would update  ${C.dim}${beforeHash.slice(0, 8)}${C.reset} → ${C.bold}${C.green}${remoteTip.slice(0, 8)}${C.reset}  (dry-run)`);
        const url = buildCompareUrl(remoteUrl, beforeHash, remoteTip);
        if (url) linkLog(depth + 1, url);
        stats.updated++;
        anyChanged = true;
      }
      pullSubmodules(subDir, depth + 1);
      continue;
    }

    // ── Checkout + reset to remote tip ────────────────────────────────────
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
      success(depth + 1,
        `Updated  ${C.dim}${beforeHash.slice(0, 8)}${C.reset} → ${C.bold}${C.green}${afterHash.slice(0, 8)}${C.reset}`);

      // ── GitHub compare link ───────────────────────────────────────────
      const url = buildCompareUrl(remoteUrl, beforeHash, afterHash);
      if (url) linkLog(depth + 1, `${C.cyan}${url}${C.reset}`);

      stats.updated++;
      anyChanged = true;
    }

    // ── Recurse ───────────────────────────────────────────────────────────
    if (pullSubmodules(subDir, depth + 1)) {
      git(repoDir, "add", sub.path);
      anyChanged = true;
    }
  }

  return anyChanged;
}

// ─── Phase 2 — commit + push, innermost first ────────────────────────────────

async function commitAndPush(repoDir, label, depth = 0) {
  // Children first
  for (const sub of parseGitmodules(repoDir)) {
    if (options.ignore.includes(sub.name)) continue;
    const subDir = path.resolve(repoDir, sub.path);
    if (fs.existsSync(subDir) && isGitRepo(subDir)) {
      await commitAndPush(subDir, sub.name, depth + 1);
    }
  }

  if (!hasStagedChanges(repoDir)) {
    verbose(depth, `${label}: nothing staged — skipping`);
    return;
  }

  const branch = resolveBranch(repoDir, null);
  info(depth, `${C.bold}${label}${C.reset} — committing on ${C.bold}${branch}${C.reset}…`);

  // ── Interactive prompt ────────────────────────────────────────────────
  if (options.interactive && !options.dryRun) {
    // Show what's staged
    const diff = git(repoDir, "diff", "--cached", "--stat");
    console.log();
    console.log(`${C.dim}${diff.stdout}${C.reset}`);
    console.log();
    const answer = await askUser(
      `${C.bold}${C.yellow}  Push '${label}' → origin/${branch}? [y/N] ${C.reset}`
    );
    console.log();
    if (answer !== "y" && answer !== "yes") {
      warn(depth, `Skipped '${label}' (user declined)`);
      stats.skipped++;
      return;
    }
  }

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
  pushLog(depth, `${C.bold}${label}${C.reset} → origin/${branch}`);
  stats.pushed++;
}

// ─── Config generator ────────────────────────────────────────────────────────

async function runMakeConfig() {
  const dest = path.join(options.repoPath, "submodule.config.json");
  const exists = fs.existsSync(dest);

  const template = {
    defaultBranch:  "main",
    parallel:       false,
    ignore:         [],
    commitMessage:  "chore: update submodule refs",
    interactive:    false,
    verbose:        false,
    color:          true,
    progress:       true
  };

  console.log();
  console.log(`${C.bold}${C.blue}╔══════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.blue}║   github-update-submodule  v2.0.0        ║${C.reset}`);
  console.log(`${C.bold}${C.blue}╚══════════════════════════════════════════╝${C.reset}`);
  console.log();

  if (exists) {
    console.log(`${C.bold}${C.yellow}⚠ Config file already exists:${C.reset} ${dest}`);
    console.log();
    const answer = await askUser(`  ${C.bold}${C.yellow}Overwrite it with defaults? [y/N] ${C.reset}`);
    console.log();
    if (answer !== "y" && answer !== "yes") {
      console.log(`${C.dim}  Cancelled — existing config file left unchanged.${C.reset}`);
      console.log();
      process.exit(0);
    }
  }

  fs.writeFileSync(dest, JSON.stringify(template, null, 2) + "\n", "utf8");

  const action = exists ? "overwritten" : "created";
  console.log(`${C.green}${C.bold}✔ Config file ${action}:${C.reset} ${dest}`);
  console.log();
  console.log(`  ${C.dim}Edit the values to set your preferred defaults.`);
  console.log(`  CLI flags always override the config file.${C.reset}`);
  console.log();
  console.log(`  ${C.bold}Available keys:${C.reset}`);
  console.log(`  ${C.cyan}defaultBranch${C.reset}   branch to use when not set in .gitmodules  ${C.dim}(default: "main")${C.reset}`);
  console.log(`  ${C.cyan}parallel${C.reset}        fetch all submodules concurrently           ${C.dim}(default: false)${C.reset}`);
  console.log(`  ${C.cyan}ignore${C.reset}          array of submodule names to skip            ${C.dim}(default: [])${C.reset}`);
  console.log(`  ${C.cyan}commitMessage${C.reset}   commit message for pointer updates           ${C.dim}(default: "chore: update submodule refs")${C.reset}`);
  console.log(`  ${C.cyan}interactive${C.reset}     prompt before pushing each repo             ${C.dim}(default: false)${C.reset}`);
  console.log(`  ${C.cyan}verbose${C.reset}         show full git output                        ${C.dim}(default: false)${C.reset}`);
  console.log(`  ${C.cyan}color${C.reset}           colored terminal output                     ${C.dim}(default: true)${C.reset}`);
  console.log(`  ${C.cyan}progress${C.reset}        show progress bar                           ${C.dim}(default: true)${C.reset}`);
  console.log();
  process.exit(0);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  // --make-config: generate a config file and exit immediately
  if (options.makeConfig) {
    await runMakeConfig();
    return;
  }

  console.log();
  console.log(`${C.bold}${C.blue}╔══════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.blue}║   github-update-submodule  v2.0.0        ║${C.reset}`);
  console.log(`${C.bold}${C.blue}╚══════════════════════════════════════════╝${C.reset}`);
  console.log();

  if (!isGitRepo(options.repoPath)) {
    error(0, `Not a git repository: ${options.repoPath}`);
    process.exit(1);
  }

  // Print active config
  info(0, `Repository     : ${C.bold}${options.repoPath}${C.reset}`);
  info(0, `Default branch : ${C.bold}${options.defaultBranch}${C.reset}`);
  info(0, `Push mode      : ${options.push        ? C.bold+C.green+"ON"      : C.dim+"OFF"}${C.reset}`);
  info(0, `Interactive    : ${options.interactive ? C.bold+C.yellow+"ON"     : C.dim+"OFF"}${C.reset}`);
  info(0, `Parallel fetch : ${options.parallel    ? C.bold+C.cyan+"ON"      : C.dim+"OFF"}${C.reset}`);
  if (options.ignore.length)
    info(0, `Ignoring       : ${C.bold}${C.yellow}${options.ignore.join(", ")}${C.reset}`);
  if (options.dryRun)
    warn(0, "DRY RUN — no changes will be made");
  if (options.maxDepth !== Infinity)
    info(0, `Max depth      : ${options.maxDepth}`);
  console.log();

  const t0 = Date.now();

  // ── Phase 1 ───────────────────────────────────────────────────────────────
  console.log(`${C.bold}${C.cyan}Phase 1 — Pull all submodules to latest remote commit${C.reset}`);
  console.log();

  if (options.parallel && !options.dryRun) {
    // Fire all fetches at once, then do the sequential update pass
    await parallelFetchAll(options.repoPath);
  } else if (!options.parallel) {
    // Sequential mode: init progress bar based on tree size
    const total = countAllSubmodules(options.repoPath);
    progress.init(total);
  }

  pullSubmodules(options.repoPath, 0);
  progress.done(); // ensure bar is cleared if sequential

  // ── Phase 2 ───────────────────────────────────────────────────────────────
  if (options.push) {
    console.log();
    console.log(`${C.bold}${C.cyan}Phase 2 — Commit & push updated refs (innermost → root)${C.reset}`);
    console.log();
    await commitAndPush(options.repoPath, path.basename(options.repoPath), 0);
  } else {
    console.log();
    warn(0, `Refs staged locally but NOT pushed (--no-push mode).`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  console.log();
  console.log(`${C.bold}${C.blue}─────────────────────────────────────────${C.reset}`);
  console.log(`${C.bold}Summary${C.reset}`);
  console.log(`  ${C.green}✔ Updated    : ${stats.updated}${C.reset}`);
  console.log(`  ${C.cyan}· Up to date : ${stats.upToDate}${C.reset}`);
  if (options.push) {
    console.log(`  ${C.green}↑ Committed  : ${stats.committed}${C.reset}`);
    console.log(`  ${C.green}↑ Pushed     : ${stats.pushed}${C.reset}`);
  }
  console.log(`  ${C.yellow}⊘ Ignored    : ${stats.ignored}${C.reset}`);
  console.log(`  ${C.yellow}⚠ Skipped    : ${stats.skipped}${C.reset}`);
  console.log(`  ${C.red}✘ Failed     : ${stats.failed}${C.reset}`);
  console.log(`  ${C.dim}  Total      : ${stats.total}  (${elapsed}s)${C.reset}`);
  console.log();

  if (stats.failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(`\n${C.red}Fatal error: ${err.message}${C.reset}`);
  process.exit(1);
});
