---
name: SCADA optimistic command feedback
description: Shared pending-command store for instant widget feedback + gateway post-write telemetry publish
---
- Pending optimistic values live in a module-level store keyed `deviceId|tag` (pending-commands.store.ts), consumed via useSyncExternalStore in useScreenTelemetry. `getValue` serves pending first, so ALL widgets bound to the point (button, icon, status, toggle logic) update instantly and rapid toggles alternate on the pending value.
- **Why:** per-widget local optimistic state desyncs widgets sharing one point and breaks rapid toggle (stale live value).
- **How to apply:** any new widget/read path must go through `getValue`, never read live telemetry maps directly. Set pending before the write, clear on `success:false`; reconcile clears when live value equals pending (deferred via setTimeout 0 to avoid setState-during-render). TTL 25s > backend 20s command timeout.
- Gateway (v1.4.0+): after a successful BACnet write ACK it does a fresh readback and publishes a single-point payload on the canonical telemetry topic (identical format to polling) so the confirmed value arrives ~1s later. It mirrors device config from `mqtt.message` events to know tag/unit; skips points not in config. Relinquish (null) is unconfirmable by readback — ACK-path readback still publishes.
