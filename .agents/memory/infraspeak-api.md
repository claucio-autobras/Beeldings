---
name: Infraspeak API integration
description: How to read Infraspeak's Stoplight docs, and what is/isn't confirmable from public docs.
---

# Infraspeak Stoplight docs are a JS-rendered SPA

The official docs at `https://infraspeak.stoplight.io/docs/api` are a single-page
app. Static HTTP fetch returns empty content for most pages. The `screenshot` tool
(`type: external_url`) renders them in a real browser and shows the actual content —
use it to read Pagination, Requirements, Revoking a Token, etc.

**Why:** A research task to document the API repeatedly failed via static fetch;
screenshots were the method that actually surfaced the content.

# What is NOT confirmable from the PUBLIC docs (require Stoplight login)

- The real **API base URL** (docs only show the placeholder `<API base URL>`).
- Individual **resource pages** (e.g. the "Requests" resource — the closest match
  to "chamados do negócio"): exact path, response fields, resource-specific filters.
- "Using the Token" and "Request/Response Format" pages render blank without login.

**How to apply:** When implementing an Infraspeak client, drive base URL, PAT, and
the resource path entirely from env vars (`INFRASPEAK_API_BASE_URL`,
`INFRASPEAK_API_TOKEN`, `INFRASPEAK_REQUESTS_PATH`) — never hardcode an unconfirmed
endpoint. Field mapping needs a real sandbox PAT response; until then return the raw
payload rather than inventing fields.

# Confirmed API mechanics (safe to rely on)

PAT Bearer auth (long-lived, per-environment, no self-service — obtained by
contacting Infraspeak); pagination `limit` (default 200) + `page` (1-based), more
pages via `links.next`; response envelope `{ data, meta.pagination, links }`; rate
limit 60/min with `Retry-After` / `X-RateLimit-Reset`; errors 400/401/404/405/429/500
with `{ status, error: { http_code, message, properties } }`. Full report:
`docs/infraspeak-requirements-api.md`.

# Integration location

NestJS backend at `apps/backend/src/modules/infraspeak/` — `infrastructure/`
(InfraspeakClient = single integration layer), `application/` (RequestsService =
auto-paginates + consolidates), `presentation/` (read-only controller). Uses native
`fetch` (no new deps), ConfigService, NestJS Logger — mirrors `emqx-provisioning.service.ts`.
