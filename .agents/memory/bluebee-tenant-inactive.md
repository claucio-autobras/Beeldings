---
name: Tenant inactive semantics
description: Conventions for tenant active/inactive across auth, sockets, and alarm feeds
---

# Tenant active/inactive

**Rule:** Inactive tenants are blocked at login AND on every authenticated request (jwt.strategy) with 403 `{code:'TENANT_INACTIVE'}` + fixed PT-BR message; frontend clears session and redirects `/login?reason=tenant-inactive`. Global admins (tenantId null) are never affected.

**Alarm silencing convention:** global-scope alarm feeds (bell, lists, stats) exclude inactive tenants ONLY when no explicit tenantId filter is present — an explicit filter still returns data so admins can audit. Events keep being recorded; only emission/visibility is suppressed. Any new global alarm/report query must follow this same rule (reuse `inactiveTenantIds()` helper pattern in AlarmEventsService).

**Sockets:** handshake checks tenant active (30s TTL cache, fail-open); status changes publish on cluster channel `tenant_status`, every instance disconnects room `tenant:{id}` — direct per-instance, not leader-only, matching direct-emit topology.

**Why:** silencing is operational (CCO noise), not data deletion; fail-open avoids locking out everyone if DB check hiccups.

**How to apply:** when adding tenant-scoped global queries or new realtime channels, wire the same exclusion + cluster-driven disconnect; when adding UI listing tenants, show the shared "Inativo" badge (with dark variants).
