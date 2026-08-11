---
name: Módulo SCA (controladoras de acesso)
description: Regras duráveis para tipos monitorados SNMP além de câmeras
---
Novos tipos monitorados (ex.: controladoras de acesso) devem ser filtrados pelo campo canônico `monitoredDeviceType`, nunca por `protocol` — o BMS já exclui qualquer `monitoredDeviceType != null`, então novos tipos ficam fora do BMS de graça, e filtrar por protocolo vaza dispositivos entre módulos.

**Why:** serviços SNMP (teste, diagnóstico, backfill, capability probe) são agnósticos de tipo e compartilhados; filtros por protocolo já quebraram a separação CFTV/SCA durante o desenvolvimento.

**How to apply:** ao criar um novo tipo monitorado — adicionar o DeviceKind e perfis no gateway (base + vendors com fallback MIB-II e overrides por device), bump de versão + manifest; o publisher de config deve declarar `monitoredDeviceType` explicitamente no contrato de tipo (não confiar em cast/runtime do Prisma); perfis base fazem parte de um conjunto explícito de fallbacks no identify() do driver. Disponibilidade de não-câmeras usa entityType 'device'. Vendors sem OIDs proprietários validados devem se rotular como "monitoramento genérico MIB-II" — nunca alegar mapeamento proprietário.
