#!/bin/bash
set -euo pipefail

# Verifies that the sync command fails closed before it can touch a remote or
# sync state when invoked from a feature branch or a detached checkout.

ROOT_DIR="$(git rev-parse --show-toplevel)"
TMP_DIR="$(mktemp -d /tmp/bluebee-sync-guard.XXXXXX)"
BRANCH_NAME="bluebee-sync-guard-test-$$"
BRANCH_WORKTREE="$TMP_DIR/branch"
DETACHED_WORKTREE="$TMP_DIR/detached"

cleanup() {
  git -C "$ROOT_DIR" worktree remove --force "$BRANCH_WORKTREE" 2>/dev/null || true
  git -C "$ROOT_DIR" worktree remove --force "$DETACHED_WORKTREE" 2>/dev/null || true
  git -C "$ROOT_DIR" branch -D "$BRANCH_NAME" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

assert_rejected() {
  local worktree="$1"
  local expected="$2"
  local output
  if output="$(cd "$worktree" && bash scripts/sync-github.sh push-snapshot 2>&1)"; then
    echo "Expected GitHub sync to reject ${expected}, but it succeeded." >&2
    exit 1
  fi
  printf '%s\n' "$output" | grep -Fq "Refusing to change GitHub sync state or remote main."
  printf 'PASS: %s was rejected before synchronization.\n' "$expected"
}

git -C "$ROOT_DIR" worktree add -q -b "$BRANCH_NAME" "$BRANCH_WORKTREE" HEAD
assert_rejected "$BRANCH_WORKTREE" "feature branch"

git -C "$ROOT_DIR" worktree add -q --detach "$DETACHED_WORKTREE" HEAD
assert_rejected "$DETACHED_WORKTREE" "detached HEAD"