#!/bin/bash
set -euo pipefail

# publish-claucio-snapshot.sh
#
# Publishes a HISTORYLESS snapshot of the local main HEAD to the external
# Claucio remote (github.com/claucio-autobras/Beeldings).
#
# Why a snapshot and not a normal push:
#   The local .git is ~3.6 GB (old commits captured Next.js build cache blobs),
#   so pushing full history is slow / times out, and rewriting local history is
#   forbidden (Replit checkpoints/rollback depend on it).
#   Canonical procedure: .agents/memory/bluebee-claucio-snapshot.md
#
# Usage:
#   scripts/publish-claucio-snapshot.sh            # publish snapshot of HEAD
#   scripts/publish-claucio-snapshot.sh --check    # only report if remote is behind
#
# When to run: after any relevant merge to main (or run --check periodically /
# from post-merge to get a reminder). Requires GITHUB_TOKEN in the environment
# (never written to files or logs by this script).
#
# Guarantees:
#   - The local repository and local main are never touched (work happens in a
#     temp dir with an isolated git repo).
#   - backups/ is excluded from the snapshot.
#   - The snapshot commit message records the source HEAD SHA, which is how
#     --check detects whether the remote is up to date.

REPO_SLUG="claucio-autobras/Beeldings"
REMOTE_URL="https://github.com/${REPO_SLUG}"

err() { echo "ERROR: $*" >&2; }

if [ -z "${GITHUB_TOKEN:-}" ]; then
  err "GITHUB_TOKEN is not set in the environment. Aborting (nothing was pushed)."
  exit 1
fi

# Credential helper keeps the token out of URLs, remote config and logs.
CRED_HELPER='!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

LOCAL_HEAD="$(git rev-parse HEAD)"

remote_source_sha() {
  # The snapshot commit message embeds "source: <sha>". Read it via the GitHub
  # API (ls-remote only gives the snapshot SHA, which never matches local SHAs).
  curl -fsS \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${REPO_SLUG}/commits/main" 2>/dev/null \
    | grep -o 'source: [0-9a-f]\{40\}' | head -n1 | awk '{print $2}'
}

check_remote() {
  local src
  src="$(remote_source_sha || true)"
  if [ -z "$src" ]; then
    echo "Claucio remote: could not determine the source HEAD of the last snapshot"
    echo "(older snapshot format, empty repo, or API unavailable)."
    echo "Assume it is OUTDATED -> run: scripts/publish-claucio-snapshot.sh"
    return 1
  fi
  if [ "$src" = "$LOCAL_HEAD" ]; then
    echo "Claucio remote is up to date (snapshot of ${LOCAL_HEAD})."
    return 0
  fi
  echo "Claucio remote is BEHIND:"
  echo "  remote snapshot source: ${src}"
  echo "  local main HEAD:        ${LOCAL_HEAD}"
  echo "Run: scripts/publish-claucio-snapshot.sh"
  return 1
}

if [ "${1:-}" = "--check" ]; then
  check_remote
  exit $?
fi

TMP_DIR="$(mktemp -d /tmp/claucio-snapshot.XXXXXX)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "Exporting tracked files from HEAD (${LOCAL_HEAD})..."
git archive HEAD | tar -x -C "$TMP_DIR"
rm -rf "$TMP_DIR/backups"

echo "Creating isolated snapshot repo..."
(
  cd "$TMP_DIR"
  git init -q -b main
  git config user.name "BlueBee Snapshot Bot"
  git config user.email "snapshot@bluebee.local"
  git add -A
  git commit -q -m "BlueBee snapshot $(date -u +%Y-%m-%dT%H:%M:%SZ) (source: ${LOCAL_HEAD})"

  echo "Force-pushing snapshot to ${REMOTE_URL} ..."
  git -c credential.helper= -c "credential.helper=${CRED_HELPER}" \
    push -q -f "$REMOTE_URL" main:main
)

echo "Verifying remote..."
SNAPSHOT_SHA="$(git -C "$TMP_DIR" rev-parse HEAD)"
REMOTE_SHA="$(git -c credential.helper= -c "credential.helper=${CRED_HELPER}" \
  ls-remote "$REMOTE_URL" refs/heads/main | awk '{print $1}')"

if [ "$REMOTE_SHA" != "$SNAPSHOT_SHA" ]; then
  err "remote main (${REMOTE_SHA}) does not match pushed snapshot (${SNAPSHOT_SHA})."
  exit 1
fi

LOCAL_HEAD_AFTER="$(git -C "$ROOT_DIR" rev-parse HEAD)"
if [ "$LOCAL_HEAD_AFTER" != "$LOCAL_HEAD" ]; then
  err "local HEAD changed during the run (${LOCAL_HEAD} -> ${LOCAL_HEAD_AFTER}). Investigate!"
  exit 1
fi

echo "Done."
echo "  Remote main:        ${REMOTE_SHA} (snapshot)"
echo "  Snapshot source:    ${LOCAL_HEAD}"
echo "  Local main HEAD:    unchanged (${LOCAL_HEAD_AFTER})"
