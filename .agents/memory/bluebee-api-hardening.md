---
name: BlueBee API hardening
description: Constraints around Helmet, global throttler and CORS in the NestJS backend behind the Next/Replit proxy.
---

## Throttler behind the Next/Replit proxy needs an XFF-based tracker
The global `ThrottlerGuard` must NOT use plain `req.ip`: behind the Next rewrite proxy every request arrives from loopback, so all clients would share one rate-limit bucket (one user could 429 everyone).
**Why:** frontend calls go browser → Next (`/api/*` rewrite) → localhost:4000; only `x-forwarded-for` carries the real client IP.
**How to apply:** the custom guard overrides `getTracker` with the same `getClientIp` used by the audit trail (first XFF entry), and `main.ts` sets `trust proxy`. Also skip non-HTTP contexts (`context.getType() !== 'http'`) or the guard breaks/needlessly limits the Socket.IO telemetry gateway.

## CORS policy is centralized and env-driven
`resolveCorsOrigins()` (common/cors.util) is the single source for HTTP CORS *and* the Socket.IO gateway decorator: `CORS_ORIGINS` (comma list) wins everywhere; production without it falls back to `REPLIT_DOMAINS` (https-prefixed); dev returns null = permissive. New gateways/servers must reuse it instead of `origin: '*'`.

## Helmet must keep SCADA images embeddable
Helmet's default `Cross-Origin-Resource-Policy: same-origin` would block the SCADA asset images when the frontend hits the backend on another origin/port; bootstrap sets `crossOriginResourcePolicy: 'cross-origin'`. Strict per-route limits on auth use `@Throttle` decorators (login/confirm-password 10/min); the generous global default (600/min) exists because dashboards poll many endpoints per screen.
