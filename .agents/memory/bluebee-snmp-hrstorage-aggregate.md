---
name: SNMP hrStorage aggregate stability
description: Why the gateway's continuous SNMP aggregation for storage/memory percent must average valid rows, not pick "the first valid one" per cycle.
---

## The bug pattern
`deriveAggregate` (apps/gateway/src/drivers/snmp.driver.ts) derives scalar metrics
(cpu, memory, storage) from `memberOids` — OIDs read in a single GET batch each
poll cycle. For `hrStorageTable`-backed metrics (`storage_used_percent`,
`memory_used_percent`), the members span multiple table rows (one size/used/alloc
triplet per row/volume).

Picking "the first row with a valid read this cycle" is unstable: which row
reads successfully varies cycle to cycle (transient per-OID misses are normal
and already tolerated elsewhere). So the "representative" row silently changes
between cycles, and the published percentage jumps between the values of
*different, unrelated volumes* — not because usage changed, but because a
different volume happened to answer that GET.

## Why the diagnostic (one-shot walk) didn't show the same bug
The one-shot diagnostic resolver (`resolveStorageFromHrStorage` /
`resolveMemoryFromHrStorage` in snmp-canonical-resolver.ts) computes over a
single walk snapshot, so it never faces this cycle-over-cycle drift. It also
established the "correct" semantics to mirror:
- **Storage** (`kind==='volume'`, i.e. real disks, RAM/swap excluded): average
  the per-volume percentages across every volume with a valid read.
- **Memory** (`kind==='ram'`): pick ONE primary entry deterministically
  (physical RAM preferred over virtual/swap, then largest `size`) — never an
  average across RAM entries.

## The fix / rule to keep applying
In the continuous aggregator, replace "first valid row" with:
- **Percent metrics** (`storage`, `storage_used_percent`, `memory`,
  `memory_used_percent`): average the percentage of every row that has a valid
  `size>0` and `used` THIS cycle. A row missing this cycle just drops out of
  the average (no full-value drop, no swap to an unrelated row). No valid rows
  → return `null`, which the caller already treats as "omit the tag, keep the
  last known-good value" (never publishes 0 or a wrong value).
- **Total-bytes metrics** (`memory_total`, `ram_total`): among the valid rows
  this cycle, deterministically pick the one with the largest `size` (proxy
  for "the primary RAM entry") instead of "whichever answered first" — keeps
  today's single-entry behavior unchanged while being resilient if a device
  ever exposes more than one RAM-like row.

This only matters when a binding's `memberOids` cover more than one
`hrStorageTable` row for the same metric; single-row bindings (the common
case for memory) are mathematically unaffected by switching to "average" or
"largest size wins".
