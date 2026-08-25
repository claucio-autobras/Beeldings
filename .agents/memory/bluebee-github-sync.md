---
name: GitHub mirror sync
description: Durable rules for mirroring this workspace to an external GitHub repository without sending the large local history.
---

## Preserve local history; publish filtered snapshots

The local Git history contains checkpoint-related bulk data and must never be force-pushed
or rewritten as part of normal synchronization. The external repository receives a filtered
snapshot history instead, with a local-to-remote sync point stored outside the worktree.

**Why:** A normal push would publish excessive historical data, while a forced replacement
would risk remote changes made outside the workspace.

**How to apply:** Use the sync script's normal push, filtered snapshot, or pull commands.
Automatic publishing must use the shared lock, never force-push, and must stop for manual
resolution when the remote has advanced. Excluded media-only changes can advance the local
sync point without creating an empty remote commit.