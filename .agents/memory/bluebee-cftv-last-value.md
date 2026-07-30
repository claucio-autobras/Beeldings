---
name: CFTV last-value seed
description: How camera status is seeded instantly and why ONVIF polling must not restart unchanged cameras
---

- `DevicePoint.lastValue/lastValueAt` are persisted ONLY for CFTV devices (protocol snmp/onvif) by a fire-and-forget MQTT consumer; BMS equipment intentionally stays in-memory/trends. Never extend this to all devices without rethinking write volume.
- Frontend rule: live socket telemetry always wins; the persisted value is only a seed (`liveOrSeed` fallback in the CFTV page). A seed with `lastValueAt` set but `lastValue` null means "last read was offline/no data" and must render as such, not be skipped.
- Gateway ONVIF `applyConfig` diffs each device block (JSON snapshot) and only (re)starts new/changed cameras. The diff key MUST be order-stable: backend `include: { points: true }` sem `orderBy` publica pontos em ordem aleatória, o que fazia TODAS as câmeras reiniciarem a cada publish. Fix nos dois lados: backend ordena pontos no publisher e o gateway normaliza (sort por tag) antes do stringify. **Why:** restarting all cameras on every config publish drops event subscriptions and delays readings; `startPoll` does an immediate first poll, which is what gives instant status on create/edit.
- ULTIMO_MOVIMENTO is derived on the gateway from an in-memory `lastMotionAt` anchor (motion event value 1) — it resets to null on gateway restart until the next motion event; that is expected, not a bug.
- New ONVIF default points must be added in BOTH `DEFAULT_ONVIF_POINTS` (create path) and the ONVIF backfill in `CameraHealthBackfillService` (existing cameras), which also republishes gateway config.
