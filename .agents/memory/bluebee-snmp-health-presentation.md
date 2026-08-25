---
name: SNMP health presentation
description: Shared frontend contract for displaying and selecting CFTV/SCA SNMP health metrics.
---

The CFTV and SCA card, telemetry modal, and SNMP diagnosis modal must normalize aliases, validate readings, apply scale, and format values through the same health utility. Cards must recognize both legacy point metrics and the canonical bindings persisted by diagnostic apply (`cpu_usage`, `memory_used_percent`, `memory_total`, `cpu_temperature`, `net_discard_rate`, `storage_used_percent`); memory totals/availability are normalized to MB before display. A source without a validated current sample must not be presented as a healthy mapping. The effective source state is explicit: active, broken, suggested, or pending; suggestions never replace the active binding until Apply and a confirmed first reading.

**Why:** Different local formatters caused the same device metric to show different units, rounding, and confidence across surfaces; nested picker render functions also reset expansion during selection.

**How to apply:** Extend the shared health utility and parent-owned picker state first. Keep IF-MIB counters distinct from percentage packet loss, and preserve raw OIDs only in advanced diagnostic details. Broken bindings must hide stale values; applying a replacement reuses the point ID, clears its last-value seed, publishes pending state, and becomes active after the first real telemetry sample.