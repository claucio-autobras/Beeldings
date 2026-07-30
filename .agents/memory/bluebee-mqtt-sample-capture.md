---
name: MQTT sample capture & point suggestions
description: How captured-topic samples drive point prefill/validation in the frontend, and how to test the flow
---

- The MQTT point suggestion heuristic (`apps/frontend/src/modules/devices/utils/mqtt-suggestions.ts`) mirrors the gateway's jsonPath resolution: dot-path over parsed JSON; plain-number payloads resolve with empty path. Prefer a `value` field; metadata keys (timestamp, deviceId, unit, name, quality, etc.) are never value candidates but DO feed unit/name suggestions.
- **Why:** suggestions must match what the gateway will actually extract at runtime, or the prefilled jsonPath silently produces no telemetry.
- **How to apply:** if the gateway's payload/path parsing changes, update the frontend mirror in lockstep; jsonPath warnings are non-blocking (amber inline text), never validation errors, because samples may not represent all future payloads.
- Testing sample capture needs a live publisher for several minutes: bash background processes die between tool calls, so run the simulator as a temporary workflow (configureWorkflow → removeWorkflow) while exercising capture endpoints/UI.
