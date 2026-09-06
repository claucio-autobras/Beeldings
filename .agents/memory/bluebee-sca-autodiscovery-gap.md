---
name: SCA auto-discovery gap (no scheduled retry)
description: Why a SCA controller's health metric (e.g. CPU) could stay "sem dados" forever until the operator manually clicked "Ativar e corrigir leituras" — and the fix.
---

## Root cause

`runAutoDiscovery` in `sca.controller.ts` only runs once, fire-and-forget, right
after registration (`trigger: 'registration'`). It can partially fail — e.g.
the CPU OID walk (`hrProcessorLoad` indexed table) times out or comes back
empty while RAM/uptime/net-* resolve fine in the same pass. The point stays
`binding.oid: null` (not `unsupported: true`), and the health card is
permanently "sem dados".

The type signature and the persistence layer already supported a
`'scheduled'` trigger and a 1x/day-per-device gate
(`SnmpDiscoveryPersistenceService.canRunAutoDiscovery`,
`DISCOVERY_MIN_INTERVAL_MS = 24h`) — but nothing in the codebase ever actually
invoked that trigger periodically. The retry mechanism was scaffolded but
never wired up. Confirmed with real DB data: two real ACCESS_CONTROLLER
devices had `resolved_at` timestamps for `ram_total`/`uptime` from
registration day, but `cpu_usage` only got a binding two days later — after a
manual "Ativar e corrigir leituras" click (`confidence_label: 'manual'`).

## Fix

Added `ScaAutoRepairSchedulerService`
(`apps/backend/src/modules/devices/application/sca-auto-repair-scheduler.service.ts`),
a leader-only periodic job (same `OnModuleInit`/`setInterval` + boot-delay
pattern as `InsightSchedulerService`). Each tick (hourly) it finds
`ACCESS_CONTROLLER` devices with at least one health-metric point still
`oid: null` and not `unsupported`, and re-runs the exact same discovery logic
as registration (`trigger: 'scheduled'`), still gated by the existing 24h
limit per device.

**Why:** the gate already treated "never resolved" and "resolved and
healthy" identically — it only throttles frequency, it never tracked whether
the previous attempt actually succeeded. The missing piece was simply a
caller for the `'scheduled'` trigger, not a new gating concept.

**How to apply:** if a similar "stuck until manual fix" report comes in for
CFTV cameras, NVRs, or switches, check `cftv.controller.ts` — it shares the
exact same one-shot-registration-only pattern (has an extra safety net,
`reconcileAutoDiscoveredCameraMetrics`, that SCA didn't have, but no scheduled
retry either). See task #1091 for the proposed follow-up to extend this same
scheduler pattern there.
