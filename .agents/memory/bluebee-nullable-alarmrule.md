---
name: BlueBee AlarmEvent.alarmRule nullable
description: AlarmEvent now carries two kinds (ALARM + AUTOMATION_NOTICE); alarmRule/alarmRuleId are optional, so telemetry-only consumers must scope by kind.
---

`AlarmEvent` is a shared table for two kinds: `ALARM` (telemetry, has an `alarmRule`)
and `AUTOMATION_NOTICE` (automation "avisar operador", NO rule/point/device — origin is
`sourceName` + `message`). Because `alarmRuleId`/`alarmRule` are now optional:

- Any query that only wants telemetry alarms MUST filter `where: { kind: 'ALARM' }`
  (or `alarmRuleId: { not: null }`). This includes the main alarms page/stats,
  the alarm engine re-hydration, the AI suggestion feed, the alarms report, and
  the dashboard admin/client stats (count + groupBy in dashboard.controller).
- The frontend dashboard consumes the legacy `/alarms` feed (both kinds), so it
  also filters `a.kind !== 'automation'` in dashboard.page.tsx (admin + client
  views) — otherwise notices show up in "Alarmes Ativos" and inflate counts.
- After scoping by kind, the Prisma payload type still shows `alarmRule` as nullable
  (TS does not narrow from a relational `where`), so mappers use `const rule = e.alarmRule!`.
- Notices CANNOT reuse the ALARM acknowledge endpoint: `AlarmEventsService.acknowledge`
  returns `toDto`, which derefs `alarmRule!` and crashes on a notice. Dismissing a notice
  goes through a dedicated `POST /alarms/notices/read` (batch `updateMany` → `NORMALIZED_ACK`,
  tenant-scoped). Bell dismiss / "Limpar" / popup "Marcar como lida" must call it — a
  local-only dismiss reappears on reload because the row stays ACTIVE.
- The legacy `/alarms` shim (notification bell) intentionally returns BOTH kinds and
  branches in `toLegacy`: notices come back as `kind:'automation'` with `sourceName`
  and `alarmText = message`, no device/site.

**Why:** making the relation optional silently broke ~4 pre-existing consumers at
compile time (`'e.alarmRule' is possibly null`). The fix is always "scope by kind,
then assert", not "make every consumer null-tolerant".

**How to apply:** when adding a new consumer of `alarmEvent`, decide up front whether
it wants telemetry alarms only (add `kind:'ALARM'`) or both (handle the notice branch).
