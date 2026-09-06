---
name: BlueBee audit trail
description: Key design decisions for the Trilha de Auditoria backend (why login is special, security rules, scoping).
---

# Audit trail (Trilha de Auditoria)

Feeds the frontend "Relatório de Auditoria" screen via `/reports/audit/preview`
(JSON, `AuditPreviewEntry` contract) and `/reports/audit` (PDF/CSV). The
contract shape is duplicated on frontend + backend reports services — keep both
in lockstep.

## Why login is audited outside the global interceptor
A global `AuditInterceptor` records mutating routes from an **explicit
allowlist** (routes not listed are silently unaudited — adding a new mutating
route does NOT auto-audit it). Login is **excluded** from that allowlist and
audited directly in `AuthService` instead.
**Why:** the interceptor only fires on handler success/exception, but login must
record FAILURE for wrong-password AND unknown-user, with the attempted email.
- Unknown user → `actor.name = 'desconhecido'`, `actor.email = attempted email`
  (report renders `actorName ?? actorEmail`, so user shows "desconhecido" while
  the attempted email stays queryable). This is an explicit acceptance criterion.

## Hard security rule
Never write `req.body` into audit `before`/`after`/metadata — `/auth/register`
carries a plaintext password. Only curated fields are stored (severity diff,
entityId/name, IP).

## Other durable constraints
- `AuditService.record` is fire-and-forget (try/catch, never throws) so logging
  failures can't break the audited operation.
- Actor/tenant names are denormalized into the row so audit survives deletion of
  the user/tenant.
- IP stored raw, masked only on display (`maskIp`).
- Tenant scope reuses ReportsController `scope()`: global roles see all / filter
  by tenantId; tenant users locked to their own.
