---
name: SCADA binding selector — dedupe, camera inclusion, health formatting
description: Why the SCADA point-binding panel needed tag-based dedup, a reset-on-deviceId effect, and a special case for the legacy 'memory' metric alias.
---

## Duplicate DevicePoint rows on tag, not just metric
`applySnmpOids`/`updateController` originally matched an existing `DevicePoint`
by `binding.metric` only. A canonical metric (`memory_available`) and a legacy
alias (`memory`) map to the SAME tag (`MEMORIA` in `AC_HEALTH_METRIC_META`) but
compare unequal as strings, so a diagnose/apply cycle created a SECOND point
with the same tag instead of updating the existing one.

**Fix pattern:** whenever `DevicePoint` creation is gated on metric-string
equality, add a fallback match on the canonical tag (`p.tag === meta.tag`)
before deciding to create. Apply this to any future canonical/legacy metric
pair, not just memory.

**Cleanup for already-duplicated data:** a per-request consolidation pass
(`consolidateDuplicateHealthPoints` in `sca.controller.ts`, run from
`listControllers`) groups a device's points by `tag`, keeps one survivor
(prefers a working OID, then most recent `lastValueAt`, then earliest
`createdAt`), reassigns `Trend`/`AlarmRule` FKs from losers to the survivor,
and deletes the losers — all in one `$transaction`. Idempotent, safe to run on
every list call.

## The 'memory' metric alias is semantically overloaded
The shared `LEGACY_TO_CANONICAL` alias table (`snmp-metric.service.ts`,
mirrored by `ALIASES` in `snmp-health.ts`) maps bare `'memory'` to
`memory_used_percent` — the CFTV/Hikvision convention (percentage). But SCA
access-controller default points historically registered `'memory'` for
AVAILABLE memory in kB/bytes (not a percentage). `health-metrics.ts`'s
`buildHealthTiles` already disambiguates this correctly by checking the
point's UNIT (`%` → percent, byte-ish → availability), not just the metric
name — any new formatter touching health metrics must replicate that
unit-aware disambiguation instead of trusting the generic alias table for
`'memory'` specifically, or it will render raw availability values as bogus
percentages (e.g. "61028%").

## Binding-selector residue across widget switches
`PropertiesPanel`'s properties panel reuses the same `BindingSelector`
component instance when the user selects a different widget (no remount), so
any local UI state (e.g. a search filter) survives a device change unless
explicitly reset via a `useEffect` keyed on the bound `deviceId` prop. Any
future local-state addition to that component needs the same reset.
