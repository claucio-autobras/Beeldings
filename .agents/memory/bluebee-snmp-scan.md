---
name: SNMP camera scan robustness
description: How the CFTV SNMP range scan stays fast while being tolerant (combos in parallel, TCP-alive caveat, progress polling pattern)
---

- Per-host version/community fallback combos run **in parallel** (first success wins) so worst case stays ~5s/host regardless of combo count; running combos sequentially would blow past the backend scan timeout on dead ranges.
- **Why:** dead hosts pay full timeout for every combo; parallelizing keeps 254-IP scans under ~1 min.
- TCP "alive without SNMP" check treats ECONNREFUSED (RST) as alive. Caveat: on loopback every 127.x IP answers RST, so local tests always show "alive" — expected, not a bug.
- Progress reaches the UI via client-generated scanId → gateway publishes per-batch to `.../discovery/snmp-scan-progress` → backend in-memory map → frontend polls GET /cftv/scan/:scanId/progress. No socket involved on purpose (blocking POST stays the source of truth).
- Quick e2e recipe: net-snmp `createAgent` on a high port (register sysDescr/sysObjectID/sysUpTime/sysName providers) + `net.createServer` on 127.0.0.2 simulates a camera and an alive-no-SNMP host; run the service directly with a fake mqtt publisher via ts-node.
