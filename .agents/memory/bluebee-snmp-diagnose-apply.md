---
name: SNMP diagnose apply verification
description: Vendor OIDs can be valid even when generic walk semantics marks them unconfirmed.
---

The guided SNMP apply flow must validate rejected vendor OIDs against the same persisted diagnosis job that produced the UI suggestion; a global `snmpUnconfirmedOids` list alone can reject valid Hikvision CPU/memory bindings.

**Why:** Generic semantic validation can flag proprietary OIDs while the gateway probe and capability map have already confirmed that those OIDs return the intended metric.

**How to apply:** Keep direct or stale payloads blocked, but pass the diagnosis identity from the modal and allow only OIDs marked as responded in that tenant/device-scoped job. Do not report success when every requested binding was rejected.