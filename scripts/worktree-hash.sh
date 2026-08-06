#!/bin/sh
# worktree-hash.sh — THE single source of the verify-stamp hash.
#
# Emits a hash of (HEAD sha + porcelain status + working diff-vs-HEAD + the CONTENTS
# of every untracked-not-ignored file). It changes whenever tracked content changes
# OR an untracked source file's contents change, and is side-effect-free. Both the
# stamp WRITER (scripts/verify.mjs on a --full pass) and the stamp CHECKER
# (.claude/hooks/verify-stop.sh at Stop) call THIS script, so the two can never
# drift. Ported from fitapp/scripts/worktree-hash.sh.
#
# Why the untracked-contents line: `status --porcelain` lists an untracked file's
# NAME but not its bytes, so editing an untracked file without renaming it would
# leave the hash unchanged. `ls-files --others --exclude-standard` respects
# .gitignore, so ignored churn (node_modules, dist/, *.log, .DS_Store) does NOT
# falsely stale the stamp.
#
# CRITICAL byte-stream contract (do NOT "clean up"):
#   - Hash the RAW command stream through a single pipe into `git hash-object`.
#     Do NOT capture the git outputs into shell variables first — `$(...)` strips
#     trailing newlines, changing the bytes and yielding a hash that can never match.
#   - Order is fixed: rev-parse HEAD, status --porcelain=v1, diff HEAD, then the
#     untracked-contents hash.
#   - --no-optional-locks on status/diff so a concurrent git process can't perturb.
#
# Usage: worktree-hash.sh <repo-root>  → prints the hash to stdout, exit 0.
#        Prints nothing + exits 1 if git is unavailable / not a repo.
set -eu

REPO="${1:-.}"

git -C "$REPO" rev-parse HEAD >/dev/null 2>&1 || exit 1

{
  git -C "$REPO" rev-parse HEAD
  git -C "$REPO" --no-optional-locks status --porcelain=v1
  git -C "$REPO" --no-optional-locks diff HEAD
  git -C "$REPO" --no-optional-locks ls-files --others --exclude-standard \
    | git -C "$REPO" hash-object --stdin-paths
} 2>/dev/null | git hash-object --stdin 2>/dev/null
