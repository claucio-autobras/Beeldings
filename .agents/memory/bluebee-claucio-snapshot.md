---
name: Claucio GitHub sync (bidirectional)
description: How BlueBee syncs with the external Claucio GitHub remote without pushing the huge local history.
---

## Bidirectional sync with the Claucio remote — never push local history

The local `.git` is ~3.8 GB (old commits captured Next.js build-cache blobs) and rewriting
local history is forbidden (Replit checkpoints/rollback depend on it). So a normal push of
local `main` to `github.com/claucio-autobras/BlueBee-Infra` is off the table permanently.

**How it works (`scripts/sync-github.sh`):**
- A sync point (local SHA ↔ remote SHA) lives in `.git/bluebee-github-sync` (outside the
  versioned worktree, survives restarts; lost only on a rollback that predates it).
- `push` — clones the (small) remote, replays each local commit since the sync point by
  exporting its tree (`git archive`, minus `backups/`) and committing with the original
  message/author + a `(source: <local sha>)` trailer; pushes WITHOUT force. Aborts if
  remote main moved past the sync point ("pull first") or if the sync point is no longer
  an ancestor of HEAD (rollback → rerun `init-base`).
- `pull` — verifies remote history was not force-pushed (sync point must be an ancestor),
  applies `git diff --binary syncRemote..remoteHead` to the local worktree via
  `git apply --index` and commits on local main citing original messages/authors. Only
  staged changes are committed, so unrelated dirty files stay dirty.
- `status` — compares both HEADs against the sync point: in sync / ahead / behind / diverged.
- `init-base` — the ONLY force-push, for first setup or recovery; publishes a historyless
  snapshot of HEAD and resets the sync point (remote-only commits are lost).

**Gotchas learned:**
- `trap cleanup EXIT` with `[ -n "$TMP" ] && rm` makes a successful run exit 1 when TMP is
  empty — use an `if`.
- The `(source: <sha>)` trailer keeps the legacy `publish-claucio-snapshot.sh --check`
  compatible (it greps that marker from the latest remote commit message).
- Token from `GITHUB_TOKEN` via git credential helper — never in URLs, files, or logs.

`scripts/post-merge.sh` runs `sync-github.sh status` non-fatally as a reminder.
User-facing guide (clone/run locally/commit/pull): `docs/github-sync.md`.
