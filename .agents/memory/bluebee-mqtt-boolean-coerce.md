---
name: MQTT boolean payload vs valueType number
description: Why MQTT points with default valueType 'number' silently published null for boolean JSON payloads, and the coercion rule that fixes it.
---

Rule: the gateway MQTT-bridge `coerce()` must accept boolean payloads (and "true"/"false" strings) under `valueType: 'number'`, mapping them to 1/0.

**Why:** `valueType` defaults to `'number'` when an MQTT point is created without an explicit type. Devices that publish JSON booleans (e.g. `{"rele": true}`) then hit `Number(String(true)) = NaN → null`, so the point NEVER resolves a value — widgets (toggle/LED/display) show no state and toggles always send the on-value. The failure is silent: raw telemetry visibly reaches the broker/backend, which misleads debugging toward the frontend.

**How to apply:** when adding new value coercion paths (gateway or backend sample-capture preview), keep boolean→1/0 symmetry in the numeric branch. Debug tip: if an MQTT point shows null while raw payload flows, inspect the point binding's `valueType` vs the JSON type first. Changed gateway files require version bump + `gateway-manifest.mjs --update`.
