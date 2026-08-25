---
name: BlueBee gateway liveness (LWT + heartbeat)
description: How explicit gateway online/offline works vs. telemetry recency, and why the status topic is retained.
---

## Gateway liveness = explicit signal, not just telemetry recency
Gateway status now has an EXPLICIT source separate from telemetry recency: the
gateway sets an MQTT LWT (retained) and publishes a periodic heartbeat on
`bluebee/{tenant}/gateway/{id}/status` (`{status:'online'|'offline',gatewayId,reason?}`).
`DeviceStatusService.markGatewayStatus()` stores it in a `gatewayStatus` map;
`getStatus()` gives the explicit signal priority over `lastSeen` recency.

**Why:** telemetry-only status only notices a crash by absence of data (slow) and
misses a clean/LWT drop. LWT is broker-driven on real disconnect → reliable.

**How to apply / invariants:**
- Explicit `offline` (LWT/shutdown) wins over recent telemetry — EXCEPT if
  telemetry arrived AFTER the offline timestamp (gateway came back and publishes
  data before the next heartbeat). That recovery clause lives in `getStatus()`.
- The recovery clause compares the telemetry's PAYLOAD timestamp (event time),
  not receive time: the gateway's store-and-forward queue re-delivers OLD
  messages after reconnect, and receive-time-only comparison would reanimate a
  dead gateway with stale data. `markSeen(id, eventAtMs?)` keeps a monotonic
  `lastEventAt` (future timestamps clamped to now); only `eventAt > offline.at`
  reactivates online. New telemetry paths MUST pass the payload timestamp.
- MQTT `device-heartbeat` timeout windows are capped at 24h and invalid values
  fall back to the 45s default — never trust client-supplied windows blindly.
- Explicit `online` only holds within the heartbeat window (`HEARTBEAT_THRESHOLD_MS`
  = 45s = 3× the gateway's 15s heartbeat). Keep the two in lockstep if you change
  the gateway interval (`HEARTBEAT_INTERVAL_MS` in gateway-mqtt.service).
- Devices (no LWT) are untouched — they still derive status from telemetry only.

## The status message MUST stay retained (survives backend restart)
Persistence across backend restart relies on the status message being RETAINED on
the broker: when the backend re-subscribes (`bluebee/+/gateway/+/status`, QoS 1),
EMQX redelivers the last status per gateway, repopulating the in-memory map. LWT,
heartbeat and clean-shutdown publishes are all `retain:true`. Drop the retain flag
and the "não depende só de memória volátil" guarantee breaks.
`GatewayStatusService` ALSO mirrors status/lastSeen into the `gateways` table as a
durable record (best-effort; ignores unknown gatewayId).
