---
name: SNMP canonical units
description: SNMP bindings and telemetry use canonical bytes, seconds, Celsius, and bit/s units at the collector boundary.
---

The SNMP collector normalizes units before publishing: memory/storage values are bytes, uptime is seconds, temperature is Celsius, and octet rates are bit/s. Legacy B/s and kB payloads are accepted only at the gateway configuration boundary and converted there.

**Why:** Multiple consumers previously displayed the same value with different conversions, and fixed interface/processor indexes made generic devices unreliable.

**How to apply:** New SNMP bindings should persist the resolved OID/index and canonical unit; presentation code should format the received value without converting it.

Linux/UCD controladoras publish `memory_available` as `(memAvailReal + memBuffer + memCached)`, capped by total RAM when available; missing optional fields fall back to memAvailReal, while vendor percentage sources remain untouched.

**Why:** `memAvailReal` alone underestimates reclaimable RAM and produced artificially high usage on iDFlex, but not every firmware exposes the extra UCD counters.

**How to apply:** Keep the composition in the gateway polling path and include all UCD dependencies in the same GET; migrate only legacy AC seeds, not manually selected proprietary bindings.