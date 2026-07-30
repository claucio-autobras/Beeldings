---
name: Sensitive-delete confirmation
description: Convention for password-confirmed critical deletions (which routes, how to add new ones, rate-limit caveat)
---

# Password-confirmed critical deletions

**Rule:** the 7 critical DELETEs (tenant, site, project, gateway, device, SCADA screen, SCADA project) require a short-lived confirmation JWT (`purpose:'sensitive-action'`, 5 min) sent via `X-Sensitive-Action-Token`, obtained from `POST /auth/confirm-password` (operator re-enters login password).

**Why:** irreversible cascade deletes; spec demanded operator password re-check + audit note ("Confirmado com senha do operador").

**How to apply:** when adding a new critical deletion, do all three in lockstep:
1. Backend: add `SensitiveActionGuard` to the DELETE route (after JwtAuthGuard).
2. Frontend: use `PasswordConfirmDialog` (components/) — it verifies the password itself and hands the token to `onConfirm(token)`; the delete service must forward it via `sensitiveActionHeaders()`.
3. Audit interceptor allowlist already appends the confirmation note for DELETEs on guarded routes.

**Caveats:**
- Rate limit (5 wrong passwords/5 min → 429 + 5 min block) is in-memory per backend process — cleared on restart, per-instance in multi-instance deploys.
- Legacy Supabase-migrated users have no local passwordHash → confirm-password returns a clear 400; they cannot delete until password reset.
- Virtual-bench point deletion deliberately stays password-free (simple inline confirm only).
