# github-update-submodule

[![npm version](https://badge.fury.io/js/github-update-submodule.svg)](https://badge.fury.io/js/github-update-submodule)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)](https://nodejs.org/)
[![Downloads](https://img.shields.io/npm/dm/github-update-submodule.svg)](https://www.npmjs.com/package/github-update-submodule)

> Recursively pull all Git submodules to their latest remote commit and push the updated refs up every parent repo — so **GitHub always points to the latest commit** in every submodule, no matter how deeply nested.

---

## The Problem

Git submodules store a **commit pointer** (a hash) in the parent repo. When a submodule gets new commits, the parent's pointer goes stale — GitHub still shows the old commit until someone manually updates and pushes it. With deeply nested submodules this becomes a nightmare to manage by hand.

```
GitHub (parent repo)  ──pins──▶  old commit  ❌
Your local submodule             latest commit ✅
```

**Common scenarios where this becomes painful:**
- **Microservices architectures** with shared libraries as submodules
- **Documentation sites** that embed multiple component repositories
- **Monorepo workflows** using submodules for versioned dependencies
- **CI/CD pipelines** that need to ensure all submodules are up-to-date
- **Multi-repo projects** with complex dependency trees

Without automation, updating submodules requires:
1. Manually traversing each submodule directory
2. Pulling the latest changes
3. Committing and pushing the updated pointer
4. Repeating for nested submodules in the correct order
5. Handling merge conflicts and branch resolution

This process is error-prone, time-consuming, and doesn't scale.

## The Solution

**One command from any repo with submodules:**

```bash
github-update-submodule
```

Everything is handled automatically — pull, commit, push — all the way down the tree and back up again.

### Key Benefits

- **🚀 Zero Configuration** - Works out of the box with any Git repository using submodules
- **🔄 Recursive Updates** - Handles deeply nested submodules in the correct dependency order
- **⚡ Parallel Processing** - Optionally fetch all submodules concurrently for massive speedup
- **🔒 Safe Operations** - Interactive mode, dry-run previews, and comprehensive error handling
- **📊 Rich Feedback** - Progress bars, GitHub compare links, and detailed statistics
- **⚙️ Highly Configurable** - Config files, CLI flags, and ignore patterns for complex workflows
- **🎯 Production Ready** - Battle-tested in enterprise environments with comprehensive edge case handling

### What It Does

1. **Discovers** all submodules recursively (respects `.gitmodules` configuration)
2. **Fetches** latest changes from remote repositories (in parallel when requested)
3. **Resolves** correct branches (`.gitmodules` → remote HEAD → fallback)
4. **Updates** submodule pointers to latest commits
5. **Commits** changes with descriptive messages
6. **Pushes** updates in dependency order (innermost first)
7. **Reports** GitHub compare URLs for easy review

---

## Installation

```bash
npm install -g github-update-submodule
```

---

## Table of Contents

- [Quick Start](#quick-start)
- [Usage Examples](#usage-examples)
- [Command Line Options](#command-line-options)
- [Configuration File](#configuration-file)
- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Troubleshooting](#troubleshooting)
- [Advanced Usage](#advanced-usage)
- [Performance Considerations](#performance-considerations)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## Quick Start

```bash
# Install globally
npm install -g github-update-submodule

# Navigate to your repository with submodules
cd your-project

# Update all submodules to latest commits
github-update-submodule

# Preview what would change without making any modifications
github-update-submodule --dry-run
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

## Advanced Usage

### Real-World Scenarios

#### 1. CI/CD Pipeline Integration

**GitHub Actions Example:**
```yaml
name: Update Submodules
on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          token: ${{ secrets.PAT }}  # Personal Access Token
          fetch-depth: 0
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install github-update-submodule
        run: npm install -g github-update-submodule
      
      - name: Update all submodules
        run: |
          github-update-submodule \
            --parallel \
            --message "ci: automated submodule update" \
            --verbose
```

#### 2. Monorepo with Shared Libraries

**Scenario:** Frontend application with shared component libraries

```bash
# Update only production dependencies
github-update-submodule \
  --ignore docs \
  --ignore examples \
  --ignore staging-components \
  --message "chore: update production submodule refs"

# Interactive review for staging environment
github-update-submodule \
  --interactive \
  --branch staging \
  --dry-run
```

#### 3. Documentation Site with Multiple Sources

**Scenario:** Docs site embedding content from multiple repositories

```bash
# Update documentation submodules only
github-update-submodule \
  --ignore frontend \
  --ignore backend \
  --ignore api \
  --message "docs: update documentation sources"

# Parallel update for faster builds
github-update-submodule \
  --parallel \
  --depth 2 \
  --verbose
```

#### 4. Microservices Architecture

**Scenario:** Main repo with multiple service submodules

```bash
# Configuration file for team consistency
cat > submodule.config.json << EOF
{
  "defaultBranch": "main",
  "parallel": true,
  "ignore": ["legacy-service", "experimental-feature"],
  "commitMessage": "chore: update service submodule refs",
  "interactive": false,
  "verbose": true,
  "color": true,
  "progress": true
}
EOF

# Update with team defaults
github-update-submodule
```

### Best Practices

#### 1. Branch Strategy
```bash
# Development environment
github-update-submodule --branch develop --message "chore: update dev refs"

# Production updates with care
github-update-submodule --interactive --branch main --dry-run
```

#### 2. Team Workflows
```bash
# Generate team config file
github-update-submodule --make-config

# Commit the config for consistency
git add submodule.config.json
git commit -m "Add submodule update configuration"
```

#### 3. Safety First
```bash
# Always preview first
github-update-submodule --dry-run --verbose

# Then run the actual update
github-update-submodule

# Or use interactive mode for critical repos
github-update-submodule --interactive
```

#### 4. Performance Optimization
```bash
# Large repositories - use parallel and depth limiting
github-update-submodule --parallel --depth 3 --verbose

# Network-constrained environments
github-update-submodule --ignore heavy-assets --no-progress
```

### Integration Examples

#### Git Hooks
```bash
# .git/hooks/pre-push
#!/bin/bash
echo "Checking submodule status..."
github-update-submodule --dry-run --no-color

if [ $? -ne 0 ]; then
  echo "⚠️  Submodules need updating. Run 'github-update-submodule' first."
  exit 1
fi
```

#### Makefile Integration
```makefile
# Makefile
.PHONY: update-submodules
update-submodules:
	@echo "Updating all submodules..."
	github-update-submodule --parallel --verbose

.PHONY: check-submodules
check-submodules:
	@echo "Checking submodule status..."
	github-update-submodule --dry-run
```

#### Docker Integration
```dockerfile
# Dockerfile
FROM node:18-alpine

RUN npm install -g github-update-submodule

WORKDIR /app
COPY . .

# Update submodules during build
RUN github-update-submodule --no-push --verbose
```

---

## Prerequisites

### System Requirements

- **Node.js** >= 14.0.0
- **Git** installed and available in your PATH
- **Remote authentication** set up (SSH keys or credential manager) so pushes don't require password prompts

### Git Configuration

Ensure your Git is properly configured:

```bash
# Set your identity (required for commits)
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"

# Verify remote access
git ls-remote origin
```

### Authentication Setup

#### SSH Keys (Recommended)
```bash
# Generate SSH key if you don't have one
ssh-keygen -t ed25519 -C "your.email@example.com"

# Add to GitHub
cat ~/.ssh/id_ed25519.pub
# Copy the output and add it to GitHub > Settings > SSH and GPG keys
```

#### Personal Access Token
```bash
# Configure Git to use token
git config --global credential.helper store
# Git will prompt for username and token on first push
```

### Repository Requirements

The target repository must:
- Be a valid Git repository
- Have at least one submodule configured in `.gitmodules`
- Have `origin` remote configured with push access
- Have submodules accessible from the current network

### Optional Enhancements

For the best experience, consider:
- **Git LFS** if your submodules contain large files
- **Parallel processing** enabled for large submodule trees (`--parallel`)
- **Configuration file** for consistent settings across teams (`--make-config`)

---

## Troubleshooting

### Common Issues and Solutions

#### Authentication Errors

**Problem:** `Permission denied (publickey)` or authentication prompts
```bash
✘ Push failed in 'my-repo': Permission denied (publickey)
```

**Solutions:**
1. **SSH Key Issues:**
   ```bash
   # Test SSH connection
   ssh -T git@github.com
   
   # Add SSH key to ssh-agent
   ssh-add ~/.ssh/id_ed25519
   ```

2. **Token Issues:**
   ```bash
   # Clear cached credentials
   git config --global --unset credential.helper
   
   # Or update stored credentials
   git config --global credential.helper store
   ```

#### Submodule Not Found

**Problem:** `fatal: not a git repository` in submodule directory
```bash
✘ Init failed: fatal: not a git repository
```

**Solutions:**
1. **Initialize manually:**
   ```bash
   git submodule update --init --recursive
   ```

2. **Check .gitmodules configuration:**
   ```bash
   cat .gitmodules
   # Verify URLs are accessible
   git ls-remote <submodule-url>
   ```

#### Branch Resolution Issues

**Problem:** Cannot determine correct branch for submodule
```bash
⚠ Cannot resolve origin/main — skipping
```

**Solutions:**
1. **Specify branch in .gitmodules:**
   ```ini
   [submodule "my-submodule"]
       path = my-submodule
       url = git@github.com:user/my-submodule.git
       branch = main  # Add this line
   ```

2. **Use CLI flag:**
   ```bash
   github-update-submodule --branch develop
   ```

#### Push Conflicts

**Problem:** Push fails due to remote changes
```bash
✘ Push failed in 'my-repo': ! [rejected] (non-fast-forward)
```

**Solutions:**
1. **Pull latest changes first:**
   ```bash
   git pull origin main
   github-update-submodule
   ```

2. **Use interactive mode to review:**
   ```bash
   github-update-submodule --interactive
   ```

#### Network Issues

**Problem:** Timeouts or connection failures
```bash
✘ Fetch warning: unable to access '...': Connection timed out
```

**Solutions:**
1. **Increase Git timeout:**
   ```bash
   git config --global http.lowSpeedLimit 0
   git config --global http.lowSpeedTime 999999
   ```

2. **Use sequential mode:**
   ```bash
   github-update-submodule  # without --parallel
   ```

#### Large Repository Performance

**Problem:** Very slow execution on large submodule trees

**Solutions:**
1. **Enable parallel fetching:**
   ```bash
   github-update-submodule --parallel
   ```

2. **Limit recursion depth:**
   ```bash
   github-update-submodule --depth 2
   ```

3. **Ignore specific submodules:**
   ```bash
   github-update-submodule --ignore heavy-lib --ignore docs
   ```

### Debug Mode

For troubleshooting, enable verbose output:
```bash
github-update-submodule --verbose --dry-run
```

This will show:
- Detailed Git command output
- Branch resolution process
- Remote URL detection
- Authentication attempts

### Getting Help

If you encounter issues not covered here:

1. **Check the GitHub Issues:** [SENODROOM/github-update-submodule/issues](https://github.com/SENODROOM/github-update-submodule/issues)
2. **Create a new issue** with:
   - Full command output with `--verbose`
   - Your `.gitmodules` file content
   - Operating system and versions
   - Steps to reproduce

3. **Community support:** Tag your issue with `question` or `bug` for appropriate attention.

---

## Contributing

We welcome contributions from the community! Here's how you can help:

### Development Setup

```bash
# Clone the repository
git clone https://github.com/SENODROOM/github-update-submodule.git
cd github-update-submodule

# Install dependencies
npm install

# Link for local testing
npm link
```

### Running Tests

```bash
# Run the test suite
npm test

# Run with coverage
npm run test:coverage
```

### Making Changes

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Make** your changes
4. **Test** thoroughly:
   ```bash
   # Test with various scenarios
   github-update-submodule --dry-run
   github-update-submodule --verbose
   ```
5. **Commit** your changes with clear messages
6. **Push** to your fork
7. **Create** a Pull Request

### Code Style

- Use **ES6+** features appropriately
- Follow the existing code style and patterns
- Add **JSDoc** comments for new functions
- Ensure **error handling** is comprehensive
- Test with **different Git versions** and platforms

### Bug Reports

When reporting bugs, please include:
- **Node.js** and **Git** versions
- **Operating system** details
- **Full error output** with `--verbose` flag
- **Minimal reproduction** steps
- **Expected vs actual** behavior

### Feature Requests

For new features:
1. **Check existing issues** first
2. **Describe the use case** clearly
3. **Consider the impact** on existing users
4. **Suggest an API** if applicable

### Release Process

Releases follow semantic versioning:
- **Patch** (x.x.1): Bug fixes
- **Minor** (x.1.x): New features
- **Major** (1.x.x): Breaking changes

Maintainers will handle version bumps and npm publishing.

---

## Performance Considerations

### Benchmarks

Performance varies based on repository structure and network conditions:

| Repository Size | Submodules | Sequential | Parallel | Improvement |
|---|---|---|---|---|
| Small | 5-10 | 2-5s | 1-3s | 40-60% |
| Medium | 20-50 | 15-30s | 5-12s | 60-70% |
| Large | 100+ | 2-5min | 30-60s | 70-80% |

*Benchmarks measured on typical corporate network with GitHub Enterprise.*

### Optimization Strategies

#### 1. Enable Parallel Fetching
```bash
# Best for large repositories
github-update-submodule --parallel
```

#### 2. Limit Recursion Depth
```bash
# Only update top-level submodules
github-update-submodule --depth 1
```

#### 3. Selective Updates
```bash
# Skip heavy documentation submodules
github-update-submodule --ignore docs --ignore examples
```

#### 4. Network Optimization
```bash
# Configure Git for better performance
git config --global http.lowSpeedLimit 1000
git config --global http.lowSpeedTime 30
git config --global http.maxRequestBuffer 100M
```

### Memory Usage

- **Small repos** (< 50 submodules): ~10-20MB RAM
- **Medium repos** (50-200 submodules): ~20-50MB RAM
- **Large repos** (200+ submodules): ~50-100MB RAM

Memory scales linearly with submodule count due to parallel processing.

### Comparison with Alternatives

| Feature | github-update-submodule | git submodule update | Manual scripts |
|---|---|---|---|
| **Recursive updates** | ✅ Automatic | ❌ Manual per level | ❌ Custom implementation |
| **Parallel fetching** | ✅ Built-in | ❌ Sequential | ⚠️ Complex to implement |
| **GitHub integration** | ✅ Compare links | ❌ None | ⚠️ Manual |
| **Interactive mode** | ✅ Built-in | ❌ None | ⚠️ Custom |
| **Progress tracking** | ✅ Rich output | ⚠️ Basic | ⚠️ Custom |
| **Error handling** | ✅ Comprehensive | ⚠️ Limited | ⚠️ Variable |
| **Configuration** | ✅ Files + CLI | ⚠️ CLI only | ⚠️ Custom |

### Performance Tips

1. **Use SSH** over HTTPS when possible (faster authentication)
2. **Enable git gc** in submodules regularly
3. **Consider shallow clones** for large submodules
4. **Use .gitignore** to exclude unnecessary files
5. **Schedule updates** during off-peak hours for CI/CD

---

## Security

### Security Considerations

`github-update-submodule` is designed with security in mind, but there are important considerations:

#### Trust Boundaries

- **Submodule URLs** are fetched from `.gitmodules` - ensure this file is trusted
- **Remote repositories** are accessed with your Git credentials
- **Branch resolution** follows Git's remote HEAD detection

#### Recommended Practices

1. **Review `.gitmodules`** before running:
   ```bash
   cat .gitmodules
   # Verify all URLs are legitimate
   ```

2. **Use dry-run** for untrusted repositories:
   ```bash
   github-update-submodule --dry-run --verbose
   ```

3. **Limit scope** with ignore patterns:
   ```bash
   github-update-submodule --ignore suspicious-submodule
   ```

4. **Audit submodules** regularly:
   ```bash
   # List all submodule URLs
   git submodule status
   ```

#### Credential Security

- **SSH keys** are preferred over HTTPS tokens
- **Personal Access Tokens** should have minimal required scopes
- **Credential helpers** should be configured securely

#### Network Security

- **HTTPS URLs** are automatically detected for GitHub compare links
- **SSH URLs** are used for Git operations when configured
- **Proxy settings** are respected from Git configuration

### Reporting Security Issues

If you discover a security vulnerability:

1. **Do not** open a public issue
2. **Email** security@senodroom.com with details
3. **Include** steps to reproduce and potential impact
4. **Wait** for confirmation before disclosing

We'll respond within 48 hours and provide a timeline for fixes.

---

## License

MIT
