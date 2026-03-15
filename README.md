# github-update-submodule

> Recursively pull all Git submodules to their latest remote commit and push the updated refs up every parent repo — so **GitHub always points to the latest commit** in every submodule, no matter how deeply nested.

---

## The Problem

Git submodules work by storing a **commit pointer** (a hash) in the parent repo. When a submodule gets new commits, the parent repo's pointer goes stale — GitHub still shows the old commit until someone manually updates and pushes it. With deeply nested submodules this becomes a nightmare to manage by hand.

```
GitHub (parent repo)  ──pins──▶  old commit ❌
Your local submodule             latest commit ✅
```

## The Solution

One command. Run it in any repo with submodules and every parent on GitHub will point to the latest commit — automatically, recursively, all the way down the tree.

```bash
github-update-submodule
```

---

## Installation

```bash
npm install -g github-update-submodule
```

---

## Usage

Navigate to your root repo in the terminal and run:

```bash
github-update-submodule
```

That's it. The tool will:

1. **Pull** — fetch every submodule (at any nesting depth) and reset it to the latest commit on its remote branch
2. **Commit** — stage and commit the updated submodule pointers in each parent repo
3. **Push** — push from the innermost repos outward to the root, so GitHub is fully up to date at every level

### Options

| Flag | Description |
|---|---|
| `--no-push` | Pull locally only, do not commit or push |
| `--dry-run` | Preview what would change without touching anything |
| `--message <m>` | Custom commit message (default: `chore: update submodule refs`) |
| `--branch <b>` | Default branch if not declared in `.gitmodules` (default: `main`) |
| `--depth <n>` | Limit recursion depth |
| `--verbose` | Show full git output for every operation |
| `--no-color` | Disable colored output |

### Examples

```bash
# Standard usage — pull + commit + push everything
github-update-submodule

# Preview changes without modifying anything
github-update-submodule --dry-run

# Pull locally only, skip the push
github-update-submodule --no-push

# Custom commit message
github-update-submodule --message "ci: bump all submodule refs to latest"

# Run on a specific repo path
github-update-submodule /path/to/your/repo

# Use master as the default branch
github-update-submodule --branch master

# Limit to 2 levels of nesting
github-update-submodule --depth 2
```

---

## How It Works

### Phase 1 — Pull

For each submodule (recursively):

1. Initialises any submodule that hasn't been cloned yet
2. Runs `git fetch --prune origin`
3. Resolves the correct branch (from `.gitmodules`, then remote HEAD, then `--branch` flag)
4. Runs `git checkout -B <branch> origin/<branch>` to hard-move to the remote tip
5. Stages the updated pointer in the parent repo with `git add <path>`
6. Recurses into the submodule's own submodules

### Phase 2 — Commit & Push

Walks the repo tree **innermost → outermost**:

1. For each repo that has staged changes, commits with the configured message
2. Pushes to `origin/<branch>`
3. Moves up to the parent and repeats

The innermost-first order ensures that by the time GitHub receives a pointer update from a parent repo, the commit it points to already exists on the remote.

---

## Example Output

```
╔══════════════════════════════════════════╗
║   github-update-submodule                ║
╚══════════════════════════════════════════╝

› Repository     : /projects/my-app
› Default branch : main
› Push mode      : ON

Phase 1 — Pull all submodules to latest remote commit

▸ QuantumDocsSyncer  (docs/QuantumDocsSyncer)
  › Fetching from origin…
  › Branch: main
  ✔ Updated  d11a9fce → 4a82bc91
  ▸ frontend  (frontend)
    › Fetching from origin…
    › Branch: main
    ✔ Updated  fe03e5be → 9c14d7aa
  ▸ backend  (backend)
    › Fetching from origin…
    › Branch: main
    ✔ Already up to date (b6732bc5)

Phase 2 — Commit & push updated refs (innermost → root)

› QuantumDocsSyncer — committing on main…
↑ QuantumDocsSyncer → origin/main
› my-app — committing on main…
↑ my-app → origin/main

─────────────────────────────────────────
Summary
  ✔ Updated    : 2
  · Up to date : 1
  ↑ Committed  : 2
  ↑ Pushed     : 2
  ⚠ Skipped    : 0
  ✘ Failed     : 0
    Total      : 3  (18.42s)
```

---

## Requirements

- **Node.js** >= 14
- **Git** installed and available in your PATH
- Your git remotes must be authenticated (SSH keys or credential manager) so pushes can succeed without a password prompt

---

## License

MIT
