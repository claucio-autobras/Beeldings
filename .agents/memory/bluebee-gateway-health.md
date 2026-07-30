---
name: Gateway health summary channel
description: How per-gateway health (queue/reconnects/polling latency) flows from gateway to the Gateway screen, and why it is separate from liveness.
---
# Gateway health summary (fila offline, reconexões MQTT, latência de polling)

Health is a SEPARATE, additive channel from liveness (LWT/heartbeat on `.../status`).
It never affects online/offline — only enriches the Gateway screen.

- Topic: `bluebee/{tenant}/gateway/{id}/health`, published by the gateway on a relaxed
  interval (default 20s, floor 5s), retained QoS 0, **ephemeral** — published via
  `GatewayMqttService.publishEphemeral` (NEVER store-and-forward: stale health must not
  be replayed). Toggle with `GATEWAY_HEALTH_ENABLED=false`; interval `GATEWAY_HEALTH_INTERVAL_MS`.
- Payload = same shape as gateway `GET /health` (built by gateway `GatewayHealthService`,
  shared by the HTTP controller and the periodic publisher).
- Backend: `BacnetMqttSubscriber` also subscribes `.../health`; stores last summary per
  gateway in-memory in backend `GatewayHealthService` (no time series). `GatewaysService`
  attaches it as `health` on each gateway (`GatewayWithHealth`), null until first arrives.
- Frontend `admin/gateways`: expandable row; treats health older than 90s (or missing) as
  neutral "sem dados de saúde", NOT an error.

**Why:** ops needs queue depth / reconnects / polling latency on-screen without SSHing to
the gateway box, but this must not risk the telemetry loop or the liveness rule.

**How to apply:** the gateway machine MUST download+restart the new version for health (and
the existing online heartbeat) to appear. Two distinct `GatewayHealthService` classes exist
(one in `apps/gateway`, one in `apps/backend`) — don't confuse them.
