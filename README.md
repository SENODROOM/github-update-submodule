# github-update-submodule

> Recursively pull all Git submodules to their latest remote commit and push the updated refs up every parent repo — so **GitHub always points to the latest commit** in every submodule, no matter how deeply nested.

---

## The Problem

Git submodules store a **commit pointer** (a hash) in the parent repo. When a submodule gets new commits, the parent's pointer goes stale — GitHub still shows the old commit until someone manually updates and pushes it. With deeply nested submodules this becomes a nightmare to manage by hand.

```
GitHub (parent repo)  ──pins──▶  old commit  ❌
Your local submodule             latest commit ✅
```

## The Solution

One command from any repo with submodules:

```bash
github-update-submodule
```

Everything is handled automatically — pull, commit, push — all the way down the tree and back up again.

---

## Installation

```bash
npm install -g github-update-submodule
```

---

## Usage

```bash
# Run from your root repo — pulls + commits + pushes everything
github-update-submodule

# Preview what would change without touching anything
github-update-submodule --dry-run

# Confirm each repo before pushing
github-update-submodule --interactive

# Fetch all submodules at the same time (much faster on large trees)
github-update-submodule --parallel

# Skip specific submodules
github-update-submodule --ignore frontend --ignore legacy-lib

# Local update only, no push
github-update-submodule --no-push
```

---

## Options

| Flag | Description |
|---|---|
| `--no-push` | Pull locally only, skip commit and push |
| `--interactive` | Show a diff and ask yes/no before pushing each repo |
| `--ignore <name>` | Skip a submodule by name. Repeatable: `--ignore a --ignore b` |
| `--parallel` | Fetch all submodules concurrently (huge speedup on large trees) |
| `--dry-run` | Preview all changes — nothing is modified |
| `--message <m>` | Custom commit message (default: `chore: update submodule refs`) |
| `--branch <b>` | Default branch if not declared in `.gitmodules` (default: `main`) |
| `--depth <n>` | Limit recursion depth |
| `--verbose` | Show full git output for every operation |
| `--no-color` | Disable colored output |
| `--no-progress` | Disable the progress bar |
| `--make-config` | Generate a `submodule.config.json` in the current repo with all defaults, then exit |

---

## Config File

Run `--make-config` once inside your repo to generate a pre-filled `submodule.config.json` with all available keys and their defaults:

```bash
github-update-submodule --make-config
```

This creates `submodule.config.json` in the current directory and prints a description of every key. Edit the values to set your preferred defaults — CLI flags always override the config file.

Example generated file:
```json
{
  "defaultBranch": "main",
  "parallel": false,
  "ignore": [],
  "commitMessage": "chore: update submodule refs",
  "interactive": false,
  "verbose": false,
  "color": true,
  "progress": true
}
```

All config keys match the CLI flag names (camelCase, without `--`):

| Key | Type | Default |
|---|---|---|
| `push` | boolean | `true` |
| `interactive` | boolean | `false` |
| `ignore` | string or string[] | `[]` |
| `parallel` | boolean | `false` |
| `commitMessage` | string | `"chore: update submodule refs"` |
| `defaultBranch` | string | `"main"` |
| `maxDepth` | number | unlimited |
| `verbose` | boolean | `false` |
| `color` | boolean | `true` |
| `progress` | boolean | `true` |

---

## How It Works

### Phase 1 — Pull

For each submodule (recursively, depth-first):

1. Initialises any submodule that hasn't been cloned yet
2. Fetches from `origin` (in parallel if `--parallel` is set)
3. Resolves the correct branch: `.gitmodules` declaration → remote HEAD → `--branch` flag
4. Runs `git checkout -B <branch> origin/<branch>` to hard-move to the remote tip
5. Stages the updated pointer in the parent with `git add <path>`
6. Prints a clickable **GitHub compare URL** for every submodule that changed:
   ```
   ⎘ https://github.com/org/repo/compare/abc12345...def67890
   ```
7. Recurses into the submodule's own submodules

### Phase 2 — Commit & Push

Walks the tree **innermost → outermost**:

1. For each repo with staged changes, optionally shows a `--interactive` diff prompt
2. Commits with the configured message
3. Pushes to `origin/<branch>`
4. Moves up to the parent and repeats

The innermost-first order guarantees that by the time GitHub receives a pointer update from a parent, the commit it points to already exists on the remote.

---

## Progress Bar

In sequential mode (default) a live progress bar tracks the fetch phase:

```
[████████████░░░░░░░░░░░░░░░░]  43% (6/13)  frontend
```

In `--parallel` mode the bar advances as each concurrent fetch completes.

---

## Example Output

```
╔══════════════════════════════════════════╗
║   github-update-submodule  v2.0.0        ║
╚══════════════════════════════════════════╝

› Repository     : /projects/my-app
› Default branch : main
› Push mode      : ON
› Interactive    : OFF
› Parallel fetch : ON
› Ignoring       : legacy-lib

Phase 1 — Pull all submodules to latest remote commit

Parallel fetching 12 submodules…
[████████████████████████████]  100% (12/12)

▸ QuantumDocsSyncer  (docs/QuantumDocsSyncer)
  › Branch: main
  ✔ Updated  d11a9fce → 4a82bc91
  ⎘ https://github.com/org/QuantumDocsSyncer/compare/d11a9fce...4a82bc91
  ▸ frontend  (frontend)
    › Branch: main
    ✔ Updated  fe03e5be → 9c14d7aa
    ⎘ https://github.com/org/frontend/compare/fe03e5be...9c14d7aa
  ▸ backend  (backend)
    › Branch: main
    ✔ Already up to date (b6732bc5)
⊘ legacy-lib  (ignored)

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
  ⊘ Ignored    : 1
  ⚠ Skipped    : 0
  ✘ Failed     : 0
    Total      : 4  (8.31s)
```

---

## Interactive Mode

With `--interactive`, the tool pauses before pushing each parent repo and shows a staged diff summary:

```
 docs/QuantumDocsSyncer | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)

  Push 'my-app' → origin/main? [y/N]
```

Type `y` to push or anything else to skip that repo.

---

## Requirements

- **Node.js** >= 14
- **Git** installed and in your PATH
- Remote authentication set up (SSH keys or credential manager) so pushes don't require a password prompt

---

## License

MIT
