#!/bin/bash
set -euo pipefail

# Uses a temporary bare repository to prove that push-snapshot detects a remote
# advance even when the local main has not advanced. No GitHub access is used.

ROOT_DIR="$(git rev-parse --show-toplevel)"
TMP_DIR="$(mktemp -d /tmp/bluebee-sync-remote.XXXXXX)"
LOCAL_REPO="$TMP_DIR/local"
REMOTE_REPO="$TMP_DIR/remote.git"
REMOTE_WORKTREE="$TMP_DIR/remote-worktree"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

git init -q -b main "$LOCAL_REPO"
git -C "$LOCAL_REPO" config user.name "Sync safety test"
git -C "$LOCAL_REPO" config user.email "sync-safety-test@example.invalid"
printf 'base\n' > "$LOCAL_REPO/tracked.txt"
git -C "$LOCAL_REPO" add tracked.txt
git -C "$LOCAL_REPO" commit -q -m "Base"

git clone -q --bare "$LOCAL_REPO" "$REMOTE_REPO"
LOCAL_SHA="$(git -C "$LOCAL_REPO" rev-parse HEAD)"
REMOTE_SHA="$(git --git-dir="$REMOTE_REPO" rev-parse main)"
printf 'LOCAL_SHA=%s\nREMOTE_SHA=%s\n' "$LOCAL_SHA" "$REMOTE_SHA" > "$LOCAL_REPO/.git/bluebee-github-sync"

git clone -q "$REMOTE_REPO" "$REMOTE_WORKTREE"
git -C "$REMOTE_WORKTREE" config user.name "Remote editor"
git -C "$REMOTE_WORKTREE" config user.email "remote-editor@example.invalid"
printf 'remote change\n' > "$REMOTE_WORKTREE/remote-only.txt"
git -C "$REMOTE_WORKTREE" add remote-only.txt
git -C "$REMOTE_WORKTREE" commit -q -m "Remote advance"
git -C "$REMOTE_WORKTREE" push -q origin main
REMOTE_HEAD_BEFORE="$(git --git-dir="$REMOTE_REPO" rev-parse main)"

if output="$(cd "$LOCAL_REPO" && GITHUB_TOKEN=test GITHUB_SYNC_REMOTE_URL="$REMOTE_REPO" \
  bash "$ROOT_DIR/scripts/sync-github.sh" push-snapshot 2>&1)"; then
  echo "Expected remote divergence to be rejected, but synchronization succeeded." >&2
  exit 1
fi

printf '%s\n' "$output" | grep -Fq "has moved past the sync point"
grep -Fxq "LOCAL_SHA=$LOCAL_SHA" "$LOCAL_REPO/.git/bluebee-github-sync"
grep -Fxq "REMOTE_SHA=$REMOTE_SHA" "$LOCAL_REPO/.git/bluebee-github-sync"
test "$REMOTE_HEAD_BEFORE" = "$(git --git-dir="$REMOTE_REPO" rev-parse main)"
echo "PASS: remote divergence was detected without changing local sync state or remote main."