---
name: lastCommunication durável
description: Regra da fonte do "visto por último" exibido nos equipamentos/câmeras
---
Regra: `lastCommunication` NUNCA cai em `createdAt`/`updatedAt` (data de cadastro ≠ comunicação). Fonte: memória (`DeviceStatusService.lastSeen`) primeiro; se vazia (pós-boot), fallback durável = max(última transição em `status_events`, maior `DevicePoint.lastValueAt`), cacheado; sem dado real → `null` e a UI mostra "sem dados".

**Why:** após restart do backend o mapa em memória zera e o fallback antigo mostrava "há 14 dias" (idade do cadastro) para equipamentos que caíram há minutos.

**How to apply:** qualquer endpoint novo que exponha `lastCommunication` deve usar `DeviceStatusService.resolveLastSeen[Many]` (batch na listagem — 2 queries agrupadas) e permitir `null`; frontend formata via `formatLastCommunication` (que trata null).
