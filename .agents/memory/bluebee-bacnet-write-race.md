---
name: BACnet write request/response race
description: Why command-result correlation must register the pending entry before publishing the MQTT command.
---

# BACnet write (and any request/response over MQTT) — register pending BEFORE publishing

When correlating an async MQTT response back to a waiting HTTP request via a
`Map<command_id, pending>`, register the pending entry **before** publishing the
command — never after `await publish(...)`.

**Why:** With QoS 2 to a remote TLS broker, the `publish()` callback only resolves
after the full PUBCOMP handshake (multiple internet round-trips). The on-site
gateway receives the PUBLISH and publishes its result almost immediately, so the
`commands/result` message can arrive at the backend **before** the local
`await publish` resolves. If the pending is only registered after the await, the
result handler looks up the `command_id`, finds nothing, silently discards it, and
the request always hits its full timeout — even though the gateway answered with
success in ~1s. This was 100% deterministic (every write timed out at 20s while
the subscriber logged the matching result with `success: true` ~1s earlier).

This is specific to the slower QoS used for writes: discovery/scan/modbus-test/
mqtt-sample publish at QoS 1 and their gateway responses are slower, so they win
the race by accident and never showed the bug.

**How to apply:** In `bacnet-write.service.ts`, the pending is set inside the
returned Promise's executor, and `mqttService.publish(...)` is called there too
(not awaited before) with a `.catch` that tears down the pending + timeout if the
publish itself fails. Confirmation that result matches: the gateway echoes the
exact `command_id` (incl. the `write-` prefix), so correlation is by exact key —
no field/name mismatch involved.

**Latent (not yet fixed):** `MqttService`'s `client.on('message')` loops over
handlers with no per-handler try/catch — one throwing handler would starve the
rest. Not the cause here (handlers either early-return or emit safely), but worth
hardening if message-dispatch reliability ever comes up.
