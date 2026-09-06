---
name: EMQX broker recovery & backend auth-refused
description: Mass re-provisioning of MQTT credentials after broker state loss, boot check, and visible backend auth refusal with anti-flapping backoff.
---

## Broker state is disposable — the database is the credential source of truth
EMQX (single node) keeps MQTT users, ACLs and retained messages in Mnesia. If
that state is lost, every client is refused and nothing self-heals. Recovery is
`EmqxReprovisionService` (health module): iterates gateways (`mqttPass`,
`sensorMqttPass`) and root-mode MQTT devices (`config.deviceMqttPass`) and
re-runs the same idempotent provisioning upserts used at registration.
- Admin action: `POST /health/broker/reprovision` (global ADMIN only — write on
  infra); button on the admin cluster page's broker card.
- Boot check (leader-only, delayed, once): probes a sample of gateway users via
  `mqttUserExists`; only a CONFIRMED 404 triggers full re-provisioning —
  inconclusive (API down → `null`) must only log, never act.
- Root devices without a persisted password can only get their ACL reapplied;
  the report flags them as pending manual credential re-issue.
- Runbook: `infra/emqx/RUNBOOK.md` (backup/restore + the backend's own MQTT user
  must be recreated manually first, or the backend can't even connect).

**Why:** re-provisioning is safe to run repeatedly because provisioning does
POST-with-PUT-fallback upserts; deriving everything from the DB means recovery
takes minutes without touching each registration.

## Backend auth refusal must be visible + slow, or EMQX bans it
CONNACK auth codes (4/5/134/135) set `authRefused` in `MqttConnectionStatus`
(exposed at `/health/comms`, red banner on the admin cluster page) and slow
`client.options.reconnectPeriod` from 5s to 60s — EMQX `flapping_detect` bans
fast-retrying clients, which turns a credential problem into a lockout.
Successful connect restores the 5s period and clears the flag.
