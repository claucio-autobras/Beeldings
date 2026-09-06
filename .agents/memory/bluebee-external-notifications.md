---
name: BlueBee external notifications (Resend + Z-API)
description: Architecture and key decisions for the external notification system (email via Resend, WhatsApp via Z-API).
---

# External Notifications Module

## Location
`apps/backend/src/modules/external-notifications/`

## Key decisions

- **Anti-storm queue**: per-recipient, 60s window. Multiple alarms in window → single digest email/WhatsApp. `STORM_WINDOW_MS = 60_000`.
- **Retry**: 3 attempts, exponential backoff, non-retryable 4xx fails immediately.
- **Isolamento de canal**: email and WhatsApp are completely independent — one failing never affects the other.
- **Alarm notifier hook**: `AlarmEngineService.setAlarmNotifier(fn)` — registered by `AlarmNotifierService.onModuleInit()`. The notifier is called AFTER `await this.emit(rt, event)` in both new activation and reactivation paths. Pattern: optional callback (null when not registered) — existing specs unaffected.
- **Insight notifier**: subscribes to `INSIGHT_GENERATED_CHANNEL` via `cluster.on(...)` — the payload already contains `recipients` resolved by `InsightsService.emitInsightGenerated`.
- **Leader-only**: alarm engine already runs leader-only; insight notifier receives from cluster bus (all instances get it, but dispatch is idempotent since insights are sent once per event publication).
- **Test endpoint**: `POST /notification-recipients/:id/test` + `GET /notification-recipients/providers-status` — separate controller `ExternalNotificationsTestController` in `ExternalNotificationsModule` (avoids circular deps with `NotificationRecipientsModule`).
- **Graceful degradation**: when `RESEND_API_KEY` or `ZAPI_*` secrets absent → log only, never throws.
- **Providers status**: `ExternalNotificationsService.providersStatus()` returns `{email, whatsapp}` booleans — used by UI to show warning badge and conditionally render test buttons.

**Why:**
- Separate controller avoids NotificationRecipientsModule ↔ ExternalNotificationsModule circular dep.
- Optional notifier callback in AlarmEngineService preserves existing spec compatibility.
- ClusterService is @Global so `InsightNotifierService` can inject it directly.

## Module graph
`ExternalNotificationsModule` imports: `AlarmsModule`, `NotificationRecipientsModule`
`ExternalNotificationsModule` registered in: `AppModule`

## Templates
`notification-templates.ts` — all email HTML + WhatsApp text builders. Dates via `formatDateSp(date)` using `America/Sao_Paulo`.

## WhatsApp auto-reply webhook (added 2026-08-18)
- WhatsApp cannot block replies; the closest UX is an auto-reply "canal não monitorado". Public controller `POST /webhooks/zapi/receive?token=<ZAPI_CLIENT_TOKEN>` (no JWT — Z-API can't authenticate; timing-safe token compare, instanceId REQUIRED and matched via `ZapiAdapter.matchesInstance`).
- Always returns 200 (even on bad token/payload) so Z-API never retries; per-phone in-memory cooldown 24h (capped map) — silent-by-design, so repeated curl tests with the same phone produce NO log lines (this is not a bug).
- **Prod URL needs the `/api` prefix**: Next rewrites only `/api/:path*` → backend root, NOT `/:path*`. Z-API `update-webhook-received` is configured to `https://www.beeldings.com.br/api/webhooks/zapi/receive?token=...` — only works after Publish.
- Email templates carry a shared NO_REPLY_NOTE footer; WhatsApp text via `buildWhatsAppAutoReply()` in notification-templates.
- Known limits (accepted): cooldown is per-instance/per-process (duplicate reply possible in multi-instance prod; VM is single instance today) and the webhook secret reuses ZAPI_CLIENT_TOKEN in a query string.

## Config tolerance (validated 2026-08-18)
- `ZAPI_INSTANCE_ID` secret in this workspace contains the FULL Z-API URL (https://api.z-api.io/instances/<id>/token/<token>/send-text), not just the id. `ZapiAdapter` now parses id/token out of a URL-shaped value; keep that tolerance if the adapter is refactored.
- Validation recipe: Z-API GET .../status returns {connected, smartphoneConnected}; Resend/WhatsApp end-to-end via POST /notification-recipients/:id/test (channel email|whatsapp) as admin. providersStatus only checks env presence, not credential validity.
