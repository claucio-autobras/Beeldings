---
name: Alarm occurrence reuse before ACK
description: Reactivation before ACK reuses the pending NORMALIZED_UNACK occurrence; engine DB ops are serialized per rule.
---

**Rule:** When an alarm condition re-triggers while the rule still has a `NORMALIZED_UNACK` occurrence, the engine REUSES that occurrence (back to `ACTIVE`, `normalizedAt` cleared, `valueAtTrigger` updated) instead of creating a new `AlarmEvent`. Only `NORMALIZED_ACK` is terminal — a new activation after ACK creates a new occurrence.

**Why:** Creating a new occurrence while one awaited ACK made the same alarm show as two rows ("Ativo" + "Aguardando ACK") and double-count in stats.

**How to apply:**
- Engine DB operations are serialized per rule via a promise chain (`rt.chain`) — normalize→reactivate in quick succession must stay ordered, or the reactivation queries the DB before the normalization is persisted and duplicates again. Keep new engine DB writes on that chain.
- Reactivation uses a conditional `updateMany` (`state: NORMALIZED_UNACK` in the where) to avoid overwriting a concurrent ACK; count=0 falls through to creating a new occurrence.
- `reload()` reconciles legacy duplicates: rules with an open (ACTIVE/ACTIVE_ACK) event get their stray `NORMALIZED_UNACK` events closed as `NORMALIZED_ACK` with an "absorvida" ackNote (acknowledgedBy stays null). It also keeps only the MOST RECENT open event per rule and absorbs extra open ones — old race code left orphan ACTIVE rows nobody would ever normalize.
- UI gotcha: distinct rules can share the same display name on different points of the same device (e.g. "Síntese de falhas da Bomba 2" on `..._BOMBA_2` and `..._BOMBA_2_DI15`) — two rows that look duplicated may be legitimately different points.
- Flapping visibility: reactivation increments `reactivationCount` + sets `lastReactivatedAt` on the SAME occurrence (inside the conditional updateMany, so a lost race never counts). Counter lives per occurrence cycle — a new post-ACK occurrence starts at 0; never reset it manually.
