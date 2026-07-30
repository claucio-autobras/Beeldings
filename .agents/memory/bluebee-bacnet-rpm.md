---
name: BACnet RPM polling
description: How the gateway polls BACnet via ReadPropertyMultiple with batching, APDU-split, and per-device fallback.
---

# BACnet polling via RPM (gateway)

The gateway polls BACnet objects via **ReadPropertyMultiple (RPM)** in batches, not point-by-point. Fallback to individual `ReadProperty` keeps old hardware working.

**Failure handling (the important part):**
- A failed RPM batch is NOT immediately treated as "device lacks RPM". A batch with >1 object is **split in half and retried** — this distinguishes *APDU oversize* (device supports RPM but batch too big) from *no RPM support*.
- Only when a **single-object** RPM fails AND the individual `ReadProperty` of that same object succeeds do we conclude "online but no RPM" and add the device to `rpmUnsupported` (keyed by `ip:port`), switching it to point-by-point for subsequent cycles.
- `rpmUnsupported` is cleared on every `applyDeviceConfig`/`stopPoll`, so a device that was offline (individual read also failed → never marked) retries RPM once it's back.

**Why:** an earlier naive heuristic marked a device RPM-unsupported on any first-batch failure with a working individual read; that would permanently disable RPM on a large-batch/APDU-oversize device and kill the perf win. The task explicitly required respecting APDU/segmentation limits.

**Contracts that must not change:**
- MQTT telemetry payload shape and topic `bluebee/{tenant}/gateway/{gw}/telemetry` — RPM is purely an internal read optimization.
- RPM response parse (node-bacnet shape): `{ values:[{ objectId:{type,instance}, values:[{ id, index, value:[{type,value}] }] }] }`. Index results by `type:instance:property`; a property that errored inside a successful RPM shows up as a non-numeric/object value and is skipped (not a fallback trigger).
- Client must use a **timeout-guarded** RPM (`readPropertyMultipleSafe`) — node-bacnet does not retransmit a lost first ACK, so an unguarded callback hangs forever.

**Env knobs:** `BACNET_RPM_ENABLED=false` forces point-by-point globally; `BACNET_RPM_BATCH_SIZE` (default 20) caps objects per RPM request.

**Out of scope here:** COV (separate, dependent task) and Modbus batching.
