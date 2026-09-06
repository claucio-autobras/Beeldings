---
name: Alarm period = last activity
description: Period filter/sort for alarm report and alarm list use latest activity (reactivation/normalization), not first activation.
---
Rule: the alarm report AND the alarms screen filter/sort by the occurrence's MOST RECENT activity — max(activatedAt, normalizedAt, lastReactivatedAt) — via shared `alarm-activity.util.ts` (alarmPeriodWhere + sortBySeverityThenActivity, in-memory sort since Prisma can't order by a max of columns).

**Why:** the engine reuses the same occurrence on reactivation before ACK (CFTV motion flaps), so filtering only on `activatedAt` hid alarms that reactivated inside the period and showed stale ordering.

**How to apply:** any new alarm listing/report/export with a from/to filter must reuse these helpers so totals keep matching between screen and report. Period semantics = overlap: activatedAt <= to AND any activity >= from. CSV/PDF show "Reativado Nx · última em <dt>" only when reactivationCount > 0.
