---
name: Monitoramento por tipo + motor de perfis
description: monitoredDeviceType, DeviceCapabilityMap, perfis em camadas no gateway, contrato de overrides
---

- `Device.monitoredDeviceType` (String, 'CAMERA'/'SWITCH'/'NVR') é o critério canônico dos filtros CFTV vs BMS (`ONLY_CAMERA_DEVICES`); protocolo NÃO identifica mais o tipo (switch também é SNMP). **Todo caminho de criação/upsert de dispositivo monitorado DEVE setar o tipo**, senão o registro some das listagens — já causou rejeição em review.
- Motor de perfis no gateway (`apps/gateway/src/profiles/`): base aberto → vendor em arquivo TS versionado → override por dispositivo via config payload. Marca desconhecida cai no base e marca o resto UNSUPPORTED, nunca falha. Nova marca = novo arquivo de perfil + registro em ALL_PROFILES + bump versão + manifest --update (guia em `docs/como-adicionar-nova-marca-camera.md`).
- `profileOverrides` trafega como `Record<string,string>` (métrica→OID); o gateway normaliza para `MetricMapping` (`normalizeProfileOverrides` no snmp.driver) antes do `resolveProfile`. Nunca fazer spread de string como objeto.
- `profileId='generic'` no PATCH = reset (profileId null, source generic); só IDs desconhecidos dão 400 — lista de perfis e validação do PATCH devem ficar consistentes.
- `DeviceCapabilityMap`: 4 estados (SUPPORTED/UNSUPPORTED/TEMPORARY_ERROR/NO_PERMISSION), unique (deviceId, metricKey). O catálogo testa o mesmo metricKey via vários perfis → agregar por métrica com prioridade SUPPORTED>TEMPORARY_ERROR>NO_PERMISSION>UNSUPPORTED antes de persistir (Promise.all de upserts na mesma chave = corrida).
- Probe periódico 6h pula gateways offline; cause=community → NO_PERMISSION, no_response → TEMPORARY_ERROR.
- **Why:** fase 1 da generalização câmera→dispositivo monitorado; switches (SNMP) e NVRs virão por cima desta abstração sem tocar o núcleo.
- **Cuidado:** `prisma migrate dev` pode incluir DROP de índices manuais (ex.: hnsw do pgvector) por drift — revisar o SQL gerado antes de commitar.
