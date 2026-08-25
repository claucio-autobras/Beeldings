---
name: Claucio GitHub sync (bidirectional)
description: How BlueBee syncs with the external Claucio GitHub remote without pushing the huge local history.
---

## Bidirectional sync with the Claucio remote — never push local history

The local `.git` is ~3.8 GB (old commits captured Next.js build-cache blobs) and rewriting
local history is forbidden (Replit checkpoints/rollback depend on it). So a normal push of
local `main` to `github.com/claucio-autobras/Beeldings` is off the table permanently.

**How it works (`scripts/sync-github.sh`):**
- A sync point (local SHA ↔ remote SHA) lives in `.git/bluebee-github-sync` (outside the
  versioned worktree, survives restarts; lost only on a rollback that predates it).
- `push` — clones the (small) remote, replays each local commit since the sync point by
  exporting its filtered tree (without chat attachments/generated media) and committing with the original
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
- `push-snapshot` — publishes the current filtered tree as one normal commit; use this when
  many Replit commits are pending or the remote needs a clean IDE-ready snapshot.
- A persistent workspace workflow plus the post-merge hook run `push-snapshot` automatically;
  they use a lock and stop on remote divergence instead of pulling or force-pushing.

**Gotchas learned:**
- `trap cleanup EXIT` with `[ -n "$TMP" ] && rm` makes a successful run exit 1 when TMP is
  empty — use an `if`.
- The `(source: <sha>)` trailer keeps the legacy `publish-claucio-snapshot.sh --check`
  compatible (it greps that marker from the latest remote commit message).
- Token from `GITHUB_TOKEN` via git credential helper — never in URLs, files, or logs.
- Published snapshots omit `attached_assets/`, `exports/`, `screenshots/`, generated outputs,
  video artifacts, root video/audio files and `backups/`; runtime assets remain.

`scripts/post-merge.sh` and the persistent sync workflow publish filtered snapshots
non-fatally; remote divergence remains a manual pull/resolve decision.
User-facing guide (clone/run locally/commit/pull): `docs/github-sync.md`.

## Recuperação sem init-base (aprendido 11/08/2026)
- Se `.git/bluebee-github-sync` sumir (rollback), NÃO precisa de init-base: o trailer `(source: <sha>)` do commit mais recente do remoto dá o LOCAL_SHA; regrave o state file com ele + o SHA do head remoto e o fluxo volta a funcionar.
- Replay de muitos commits (100+) estoura o limite de 5 min do shell; fallback válido: 1 commit squash "BlueBee snapshot <ISO> (source: <sha>)" em cima do main remoto (clone raso → limpar tudo exceto .git → `git archive HEAD -- . ':(exclude)backups'` → commit → push SEM force) e atualizar o sync point.
