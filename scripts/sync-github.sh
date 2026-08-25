#!/bin/bash
set -euo pipefail

# sync-github.sh — bidirectional sync between local main and the external
# GitHub remote (github.com/claucio-autobras/Beeldings).
#
# The local .git is huge (~3.8 GB; old commits captured build-cache blobs) and
# rewriting local history is forbidden (Replit checkpoints depend on it), so we
# NEVER push local history. Instead we keep a correspondence point
# (local SHA <-> remote SHA) in .git/bluebee-github-sync and:
#
#   push    replay each local commit since the sync point as a normal commit on
#           top of remote main (tree export per commit; no force after the base).
#   push-snapshot publish the current local tree as one normal commit, useful
#           after a long Replit history; excludes chat attachments and media.
#           Aborts if the remote has commits we haven't pulled yet.
#   pull    fetch new remote commits, apply their combined diff to the local
#           worktree and commit it on local main, preserving original
#           messages/authors in the commit text.
#   status  report in-sync / ahead / behind / diverged.
#   init-base  one-time (or recovery) base publish: force-push a historyless
#           snapshot of local HEAD and set the sync point. DESTRUCTIVE for
#           remote-only commits — only for first setup or explicit reset.
#
# Token comes from GITHUB_TOKEN via a git credential helper — never in URLs,
# files or logs. Chat attachments, generated exports, screenshots, video
# artifacts and backups are excluded from everything published. Runtime assets
# under apps/frontend/public remain available to a cloned project.

REPO_SLUG="claucio-autobras/Beeldings"
REMOTE_URL="${GITHUB_SYNC_REMOTE_URL:-https://github.com/${REPO_SLUG}}"
CRED_HELPER='!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'

err() { echo "ERROR: $*" >&2; }
usage() { echo "Usage: scripts/sync-github.sh {push|push-snapshot|pull|status|init-base}" >&2; exit 2; }

CMD="${1:-}"
[ -n "$CMD" ] || usage

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"
STATE_FILE="$ROOT_DIR/.git/bluebee-github-sync"
LOCK_FILE="$ROOT_DIR/.git/bluebee-github-sync.lock"

rgit() { git -c credential.helper= -c "credential.helper=${CRED_HELPER}" "$@"; }

LOCAL_HEAD="$(git rev-parse HEAD)"

remote_head() {
  rgit ls-remote "$REMOTE_URL" refs/heads/main | awk '{print $1}'
}

load_state() {
  SYNC_LOCAL=""; SYNC_REMOTE=""
  if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    . "$STATE_FILE"
    SYNC_LOCAL="${LOCAL_SHA:-}"; SYNC_REMOTE="${REMOTE_SHA:-}"
  fi
}

save_state() { # $1=local sha  $2=remote sha
  printf 'LOCAL_SHA=%s\nREMOTE_SHA=%s\n' "$1" "$2" > "$STATE_FILE"
}

require_local_main() {
  local branch
  branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  if [ "$branch" != "main" ]; then
    err "Local checkout is ${branch:-detached HEAD}, not main. Refusing to change GitHub sync state or remote main."
    exit 1
  fi
}

require_github_token() {
  if [ -z "${GITHUB_TOKEN:-}" ]; then
    err "GITHUB_TOKEN is not set in the environment. Aborting."
    exit 1
  fi
}

with_sync_lock() {
  require_local_main
  require_github_token
  exec 9>"$LOCK_FILE"
  if flock -n 9; then
    "$@"
  else
    echo "GitHub sync already in progress; skipped this attempt. The next cycle will re-check main." >&2
  fi
}

export_tree() { # $1=rev  $2=destdir  — tracked files only, backups/ removed
  git archive "$1" | tar -x -C "$2"
  rm -rf \
    "$2/backups" \
    "$2/attached_assets" \
    "$2/exports" \
    "$2/screenshots" \
    "$2/artifacts/video-comercial" \
    "$2/.agents/outputs"
  find "$2" -maxdepth 1 -type f \
    \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.webm' -o -iname '*.mkv' \
       -o -iname '*.avi' -o -iname '*.mp3' -o -iname '*.wav' \) -delete
}

require_state() {
  load_state
  if [ -z "$SYNC_LOCAL" ] || [ -z "$SYNC_REMOTE" ]; then
    err "No sync point recorded (.git/bluebee-github-sync missing)."
    err "Run: scripts/sync-github.sh init-base   (first-time setup; force-pushes a base snapshot)"
    exit 1
  fi
}

TMP_DIR=""
cleanup() { if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi; }
trap cleanup EXIT

clone_remote() { # full clone; remote history is small (base snapshot + increments)
  TMP_DIR="$(mktemp -d /tmp/bluebee-sync.XXXXXX)"
  rgit clone -q "$REMOTE_URL" "$TMP_DIR/repo"
  git -C "$TMP_DIR/repo" config user.name "BlueBee Sync Bot"
  git -C "$TMP_DIR/repo" config user.email "sync@bluebee.local"
}

cmd_status() {
  require_state
  local rhead; rhead="$(remote_head)"
  local ahead=0 behind=0
  [ "$LOCAL_HEAD" != "$SYNC_LOCAL" ] && ahead=1
  [ "$rhead" != "$SYNC_REMOTE" ] && behind=1
  echo "Sync point: local ${SYNC_LOCAL} <-> remote ${SYNC_REMOTE}"
  echo "Local main HEAD:  ${LOCAL_HEAD}"
  echo "Remote main HEAD: ${rhead}"
  if [ $ahead -eq 0 ] && [ $behind -eq 0 ]; then
    echo "STATUS: in sync — Replit and GitHub are up to date."
    return 0
  elif [ $ahead -eq 1 ] && [ $behind -eq 0 ]; then
    echo "STATUS: local AHEAD — Replit has commits not on GitHub."
    echo "Run: scripts/sync-github.sh push"
    return 1
  elif [ $ahead -eq 0 ] && [ $behind -eq 1 ]; then
    echo "STATUS: remote AHEAD — GitHub has commits not pulled into Replit."
    echo "Run: scripts/sync-github.sh pull"
    return 1
  else
    echo "STATUS: DIVERGED — both sides have new commits."
    echo "Run: scripts/sync-github.sh pull   (then push)"
    return 1
  fi
}

cmd_push() {
  require_state
  local rhead; rhead="$(remote_head)"
  if [ "$rhead" != "$SYNC_REMOTE" ]; then
    err "Remote main (${rhead}) has moved past the sync point (${SYNC_REMOTE})."
    err "GitHub has commits not yet pulled. Run: scripts/sync-github.sh pull   — then push again."
    exit 1
  fi
  if [ "$LOCAL_HEAD" = "$SYNC_LOCAL" ]; then
    echo "Nothing to push — local main is at the sync point (${SYNC_LOCAL})."
    return 0
  fi
  if ! git merge-base --is-ancestor "$SYNC_LOCAL" "$LOCAL_HEAD"; then
    err "Sync point ${SYNC_LOCAL} is not an ancestor of local HEAD (history rewritten/rolled back?)."
    err "Recover with: scripts/sync-github.sh init-base   (re-publishes a base snapshot)"
    exit 1
  fi

  clone_remote
  local repo="$TMP_DIR/repo"
  if [ "$(git -C "$repo" rev-parse HEAD)" != "$SYNC_REMOTE" ]; then
    err "Remote moved during the run. Re-run push."
    exit 1
  fi

  local commits; commits="$(git rev-list --reverse --first-parent "${SYNC_LOCAL}..${LOCAL_HEAD}")"
  local n=0 rev msg an ae ad
  for rev in $commits; do
    n=$((n+1))
    # Replace the working tree of the clone with the exported tree of this rev.
    find "$repo" -mindepth 1 -maxdepth 1 -not -name .git -exec rm -rf {} +
    export_tree "$rev" "$repo"
    msg="$(git log -1 --format=%B "$rev")"
    an="$(git log -1 --format=%an "$rev")"
    ae="$(git log -1 --format=%ae "$rev")"
    ad="$(git log -1 --format=%ad "$rev")"
    git -C "$repo" add -A
    if git -C "$repo" diff --cached --quiet; then
      git -C "$repo" commit -q --allow-empty --author="${an} <${ae}>" --date="${ad}" \
        -m "${msg}" -m "(source: ${rev})"
    else
      git -C "$repo" commit -q --author="${an} <${ae}>" --date="${ad}" \
        -m "${msg}" -m "(source: ${rev})"
    fi
    echo "Prepared commit for ${rev} ($(git log -1 --format=%s "$rev" | cut -c1-60))"
  done

  echo "Pushing ${n} commit(s) to ${REMOTE_URL} (no force)..."
  ( cd "$repo" && rgit push -q "$REMOTE_URL" main:main )

  local new_rhead; new_rhead="$(git -C "$repo" rev-parse HEAD)"
  save_state "$LOCAL_HEAD" "$new_rhead"
  echo "Done. Sync point updated: local ${LOCAL_HEAD} <-> remote ${new_rhead}"
}

cmd_push_snapshot() {
  require_state
  local rhead; rhead="$(remote_head)"
  if [ "$rhead" != "$SYNC_REMOTE" ]; then
    err "Remote main (${rhead}) has moved past the sync point (${SYNC_REMOTE})."
    err "GitHub has commits not yet pulled. Run: scripts/sync-github.sh pull first."
    exit 1
  fi
  if [ "$LOCAL_HEAD" = "$SYNC_LOCAL" ]; then
    echo "Nothing to push — local main is at the sync point (${SYNC_LOCAL})."
    return 0
  fi
  if ! git merge-base --is-ancestor "$SYNC_LOCAL" "$LOCAL_HEAD"; then
    err "Sync point ${SYNC_LOCAL} is not an ancestor of local HEAD."
    err "Recover with: scripts/sync-github.sh init-base   (only after reviewing remote)"
    exit 1
  fi

  clone_remote
  local repo="$TMP_DIR/repo"
  if [ "$(git -C "$repo" rev-parse HEAD)" != "$SYNC_REMOTE" ]; then
    err "Remote moved during the run. Re-run push-snapshot."
    exit 1
  fi

  find "$repo" -mindepth 1 -maxdepth 1 -not -name .git -exec rm -rf {} +
  export_tree "$LOCAL_HEAD" "$repo"
  git -C "$repo" add -A
  if git -C "$repo" diff --cached --quiet; then
    save_state "$LOCAL_HEAD" "$SYNC_REMOTE"
    echo "Nothing publishable — local changes only affected excluded files."
    echo "Sync point updated: local ${LOCAL_HEAD} <-> remote ${SYNC_REMOTE}"
    return 0
  fi
  git -C "$repo" commit -q -m "BlueBee code snapshot $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -m "(source: ${LOCAL_HEAD})"

  echo "Pushing one filtered code snapshot to ${REMOTE_URL} (no force)..."
  ( cd "$repo" && rgit push -q "$REMOTE_URL" main:main )

  local new_rhead; new_rhead="$(git -C "$repo" rev-parse HEAD)"
  save_state "$LOCAL_HEAD" "$new_rhead"
  echo "Done. Sync point updated: local ${LOCAL_HEAD} <-> remote ${new_rhead}"
}

cmd_pull() {
  require_state
  local rhead; rhead="$(remote_head)"
  if [ "$rhead" = "$SYNC_REMOTE" ]; then
    echo "Nothing to pull — remote main is at the sync point (${SYNC_REMOTE})."
    return 0
  fi

  clone_remote
  local repo="$TMP_DIR/repo"
  rhead="$(git -C "$repo" rev-parse HEAD)"
  if ! git -C "$repo" cat-file -e "${SYNC_REMOTE}^{commit}" 2>/dev/null; then
    err "Sync point ${SYNC_REMOTE} not found on remote (history rewritten on GitHub?)."
    err "Recover with: scripts/sync-github.sh init-base   (re-publishes a base snapshot; remote-only commits will be lost)"
    exit 1
  fi
  if ! git -C "$repo" merge-base --is-ancestor "$SYNC_REMOTE" "$rhead"; then
    err "Remote main was force-pushed past the sync point. Manual review needed."
    exit 1
  fi

  echo "Remote commits to pull:"
  git -C "$repo" log --format='  %h %an: %s' "${SYNC_REMOTE}..${rhead}"

  local local_ahead=0
  if [ "$LOCAL_HEAD" != "$SYNC_LOCAL" ]; then local_ahead=1; fi

  local patch="$TMP_DIR/pull.patch"
  git -C "$repo" diff --binary "${SYNC_REMOTE}" "${rhead}" > "$patch"
  if [ ! -s "$patch" ]; then
    echo "Remote commits produce no tree change; recording sync point only."
    if [ $local_ahead -eq 1 ]; then save_state "$SYNC_LOCAL" "$rhead"; else save_state "$LOCAL_HEAD" "$rhead"; fi
    return 0
  fi

  if ! git apply --index --check "$patch"; then
    err "Patch does not apply cleanly to the local worktree (local uncommitted or"
    err "conflicting changes?). Commit/stash local changes and retry, or resolve manually."
    exit 1
  fi
  git apply --index "$patch"

  local summary; summary="$(git -C "$repo" log --format='- %s (%an <%ae>, %ad, github %H)' "${SYNC_REMOTE}..${rhead}")"
  git -c user.name="BlueBee Sync Bot" -c user.email="sync@bluebee.local" \
    commit -q -m "GitHub pull: commits from ${REPO_SLUG}" -m "$summary" -m "(github-sync: remote ${rhead})"
  local new_local; new_local="$(git rev-parse HEAD)"
  if [ $local_ahead -eq 1 ]; then
    # Local commits made before this pull have NOT been pushed yet; keep the
    # local side of the sync point so a later `push` replays them (each push
    # exports the full tree per commit, so the end state stays consistent).
    save_state "$SYNC_LOCAL" "$rhead"
    echo "Done. Applied remote changes as local commit ${new_local}."
    echo "NOTE: local commits are still pending — run: scripts/sync-github.sh push"
    echo "Sync point updated: local ${SYNC_LOCAL} <-> remote ${rhead}"
  else
    save_state "$new_local" "$rhead"
    echo "Done. Applied remote changes as local commit ${new_local}."
    echo "Sync point updated: local ${new_local} <-> remote ${rhead}"
  fi
}

cmd_init_base() {
  echo "Publishing BASE snapshot of local HEAD (${LOCAL_HEAD}) — this FORCE-PUSHES remote main."
  TMP_DIR="$(mktemp -d /tmp/bluebee-sync.XXXXXX)"
  local repo="$TMP_DIR/base"
  mkdir -p "$repo"
  export_tree "$LOCAL_HEAD" "$repo"
  (
    cd "$repo"
    git init -q -b main
    git config user.name "BlueBee Sync Bot"
    git config user.email "sync@bluebee.local"
    git add -A
    git commit -q -m "BlueBee base snapshot $(date -u +%Y-%m-%dT%H:%M:%SZ)" -m "(source: ${LOCAL_HEAD})"
    rgit push -q -f "$REMOTE_URL" main:main
  )
  local new_rhead; new_rhead="$(remote_head)"
  if [ "$new_rhead" != "$(git -C "$repo" rev-parse HEAD)" ]; then
    err "Remote main does not match the pushed base snapshot."
    exit 1
  fi
  save_state "$LOCAL_HEAD" "$new_rhead"
  echo "Base published. Sync point: local ${LOCAL_HEAD} <-> remote ${new_rhead}"
  echo "From now on use: scripts/sync-github.sh push | pull | status"
}

case "$CMD" in
  push)      with_sync_lock cmd_push ;;
  push-snapshot) with_sync_lock cmd_push_snapshot ;;
  pull)      with_sync_lock cmd_pull ;;
  status)    require_local_main; require_github_token; cmd_status ;;
  init-base) with_sync_lock cmd_init_base ;;
  *)         usage ;;
esac
