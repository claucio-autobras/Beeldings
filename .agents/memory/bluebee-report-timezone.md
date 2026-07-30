---
name: Report timezone fixed at America/Sao_Paulo
description: Reports (PDF/CSV/preview) format and filter in Brasília time end-to-end; server runs UTC.
---

Rule: all report output (alarms/trends/audit PDF+CSV, preview, "gerado em"/period labels) formats with an explicit `timeZone: 'America/Sao_Paulo'` (central helper `report-time.ts` in the backend reports module). Never rely on server-default `Intl.DateTimeFormat` — the server runs UTC, producing +3h timestamps.

Frontend: the reports page parses `datetime-local` inputs explicitly as São Paulo time (`report-period.ts`), NOT via `new Date(value)` (browser-tz dependent). The end date is made inclusive to the whole minute (…:59.999) so an alarm at 10:46:30 isn't dropped by a "até 10:46" filter. Preview and download share the same parsed Dates so counts always match.

**Why:** users reported reports 3h ahead and alarms "missing" from filtered periods; audit preview looked right (client-side formatting) while files were wrong.

**How to apply:** any new backend-generated export or date label must use the reports `fmtDateTime` helper; any new period picker feeding backend queries must reuse the São Paulo parsing helpers.
