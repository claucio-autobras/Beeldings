---
name: Socket.IO tenant scoping & multi-instance fan-out
description: How BlueBee scopes realtime (Socket.IO /telemetry) per tenant and keeps it correct across multiple backend instances.
---

# Realtime scoping (TelemetryGateway) — rules that aren't obvious from the code

## Room model
- Tenant users are locked to room `tenant:{tenantId}` and can NEVER change it (isolation).
- Global roles (JwtPayload.tenantId == null, e.g. ADMIN/CCO) join `scope:all` and may narrow to a
  single tenant via the `scope:subscribe` message (tenantId null = back to all).
- `scopedEmit(event, data, tenantId)` targets `tenant:{id}` + `scope:all`; Socket.IO dedupes so a
  socket in both rooms receives once. tenantId null → only global roles receive.

## What goes through the cluster bus vs. what does NOT (avoid double-emit)
**Why:** telemetry, command results, and telemetry ALARM events are produced on EVERY instance
(each instance subscribes to the MQTT broker and evaluates alarms locally), so each instance already
emits them to its own sockets. Routing those through the cluster LISTEN/NOTIFY bus would DUPLICATE.
- Telemetry / command result / kind `ALARM` → emit DIRECTLY, never via the bus.
- kind `AUTOMATION_NOTICE` → the automation scheduler is leadership-gated, so these originate ONLY on
  the cluster leader. They MUST be fanned out: `AutomationRunnerService.executeNotify` publishes the
  `AlarmEventPayload` to `ClusterService.publish(AUTOMATION_NOTICE_CHANNEL, json)` and does NOT emit
  directly. `TelemetryGateway.onModuleInit` registers `cluster.on(AUTOMATION_NOTICE_CHANNEL)` on every
  instance and re-emits via `emitAlarmEvent`. Channel constant is exported from telemetry.gateway.ts.
**How to apply:** any new realtime event — first ask "is it produced on every instance or only the
leader?" Leader-only → bus. Every-instance → direct. Never both.

## Auth must be pre-connection (Socket.IO middleware), not in handleConnection
**Why:** `handleConnection` runs AFTER the socket connects, so a bad-token client briefly connects and
is only then disconnected (visible race: client sees `connect`, then server `disconnect`).
**How to apply:** authenticate in `afterInit(server.use((socket,next)=>...))`. Verify JWT, attach
`socket.data.scope`, call `next()` or `next(new Error('unauthorized'))`. Invalid/missing token fails
with `connect_error` before a session exists. `handleConnection` then only joins rooms from the
already-validated scope.

## Frontend
- `io({ auth: { token } })`; do NOT connect until the token is present; on connect, global roles emit
  `scope:subscribe` with the selected tenantId. Hooks depend on token + selectedTenantId.

## Deferred
- Site-level rooms: JwtPayload has no siteId, so per-site scoping would need a per-message DB lookup.
  Deferred intentionally — don't add it without adding siteId to the payload first.
