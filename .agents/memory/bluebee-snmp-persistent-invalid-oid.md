---
name: SNMP persistent-invalid-OID + last-good-value preservation
description: Why an SNMPv1 batch with one dead OID used to blank unrelated scalar readings, and how the gateway now tells "bad OID"/"transient miss"/"offline" apart.
---

## Problem
In SNMPv1, one invalid OID in a batch GET fails the *entire* request, so the
gateway falls back to reading each OID individually for that device. In that
slow path, any one-off slow/no-answer response on a single OID (firmware
hiccup, not a real capability gap) was treated immediately as "no data" —
and the backend/frontend then blanked the last-known value instead of
keeping it, since nothing distinguished "this cycle had no fresh sample" from
"the device is offline". Manual diagnostics appeared to "fix" it only because
it forces an immediate re-read.

## Fix shape (all in `apps/gateway`, no backend/DB changes needed)
- `snmp-read.util.ts`: individual-fallback GETs classify each attempt as
  `ok` / `agent_error` (conclusive rejection) / `silence` (timeout — could be
  transient). Only `silence` gets one retry before giving up for the cycle.
  An optional `rejectedOids: Set<string>` output param collects OIDs that hit
  a conclusive `agent_error` (never `silence`).
- `snmp.driver.ts`: `SnmpDriver` keeps a per-instance `oidRejectionStreak`
  Map + `confirmedUnsupportedOids` Set. An OID needs `agent_error` in
  `OID_REJECTION_CONFIRM_THRESHOLD` (2) *consecutive* cycles to be confirmed
  dead; any cycle where it's absent from `rejectedOids` (while present in the
  batch) resets its streak. Confirmed-dead OIDs get cloned into
  `applyConfirmedUnsupported()` as `unsupported: true` and drop out of future
  batches — this is what stops the slow-path recurrence.
- Last-good-value preservation is an **omission**, not a state: when a
  scalar/aggregate point resolves to `null` this cycle AND the device
  responded (`reachable`) AND the point has a persisted `oid` AND it isn't
  already `unsupported`, the point's tag is dropped from `CollectOutput.points`
  entirely — nothing is published for it this cycle. Both
  `camera-last-value.service.ts` (`persist()` only iterates points actually
  present in the payload) and the frontend telemetry map (per-tag merge, not
  wholesale replace) already leave a prior value/timestamp untouched when a
  tag is missing from a payload — zero backend changes were needed.
- Frontend `health-metrics.ts` computes `stale` per tile from the reading's
  `timestamp` (>5min old = same threshold as camera staleness) so a
  preserved-but-old value shows "desatualizado" instead of looking fresh.

**Why:** Omission (vs. an explicit "unsupported"/"stale" state on the wire)
means zero schema/DB changes and correct behavior for free from existing
merge semantics on both ends.

**How to apply:** Only applies to points with a real persisted `oid` — a
point with `oid: null` (never configured) must NOT be omitted, it should
keep publishing `null` as before (see `snmp-driver-ac.spec.ts`'s "binding sem
OID" test). Offline devices (`reachable: false`) must never omit — they
publish `null` explicitly so stale values never look current. Table-based
points (switch ports, NVR/DVR disks) were deliberately left out of this
omission logic — same one-cycle-miss risk likely applies there too (see
follow-up task on this).
