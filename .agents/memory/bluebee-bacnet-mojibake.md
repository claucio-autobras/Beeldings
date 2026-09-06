---
name: BACnet mojibake (U+FFFD) repair
description: Controladoras BACnet mandam Latin-1 declarando UTF-8; como o BlueBee repara os nomes com �
---

Controladoras BACnet em campo declaram encoding UTF-8 mas enviam Latin-1 → node-bacnet grava U+FFFD (�) em nomes de pontos.

**Regra:** reparo via `repairMojibake()` (dicionário PT de automação predial, � = curinga de exatamente 1 char, nunca chuta fora do dicionário; ALL CAPS preservado; � na 1ª letra segue contexto Título-Capitalizado do texto). Util duplicado no gateway (domain/bacnet) e backend (common) — mudanças devem ser sincronizadas nas duas cópias.

**Why:** não dá para consertar na origem (firmware da controladora); decodificar como Latin-1 globalmente quebraria devices corretos.

**How to apply:** gateway repara na leitura (discovery + client); backend repara em toda gravação de `objectName`. NUNCA reparar `tag` — correlação de telemetria é deviceId+tag. Qualquer arquivo novo/alterado em apps/gateway exige bump de versão + `gateway-manifest.mjs --update` (senão validação/OTA falha).
