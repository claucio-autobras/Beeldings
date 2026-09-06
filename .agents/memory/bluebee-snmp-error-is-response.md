---
name: SNMP erro de protocolo = resposta
description: Erros SNMP (noSuchObject/noSuchName) provam câmera viva; só timeout é silêncio. Ping robusto e causa community vs rede.
---

Regra: uma resposta SNMP com erro de protocolo (net-snmp `RequestFailedError`, ex.: noSuchName no v1, noSuchObject) É uma resposta do agente — a câmera está online; só o OID pedido não existe. Só timeout/erro de socket conta como silêncio.

**Why:** Hikvision real em campo responde v2c mas não tem sysUpTime; tratar o erro como "sem resposta" marcava a câmera offline e o diagnóstico como inalcançável.

**How to apply:**
- Toda leitura SNMP (polling, teste, diagnóstico) deve classificar erro via `classifySnmpError` (gateway `snmp-read.util.ts`) antes de concluir "host mudo".
- Ping do diagnóstico: qualquer resposta conta; fallback getNext na raiz `1.3.6.1`; silêncio total + community≠public → probe com `public` distingue cause='community' de 'no_response' (exibido na UI).
- Ponto com OID que não responde numa câmera alcançável vira `binding.unsupported` (UI: "não suportado pela câmera"); aplicar/editar OID limpa a marca.
