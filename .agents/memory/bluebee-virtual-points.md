---
name: BlueBee virtual points (Bancada de Testes)
description: Virtual SCADA test points are stored as Device protocol='virtual' but must never count/appear as real equipment.
---

# Pontos virtuais (Bancada de Testes) — artefato exclusivo do SCADA

A Bancada de Testes do módulo SCADA reaproveita as tabelas de equipamento real:
cada bancada é um `Device` com `protocol='virtual'`, `gatewayId=null`,
`config={virtual:true,projectId}`, e os pontos ficam em `DevicePoint` (kind/currentValue/states no Json `binding`).

**Regra:** um device virtual é ferramenta de teste do SCADA, NUNCA equipamento real.
Ele não pode ser listado nem contado em nenhuma superfície de "equipamento".

**Why:** foi implementado reaproveitando a plumbing de telemetria;
sem filtro, vazava para a lista de dispositivos e para as contagens do dashboard.

**How to apply:** toda nova query em `prisma.device` que represente equipamento real
deve mesclar o fragmento `EXCLUDE_VIRTUAL_DEVICES` (`{ protocol: { not: 'virtual' } }`)
de `modules/prisma/device-filters.ts`. Superfícies já filtradas: dashboard admin-stats
e client-stats, `GET /devices`, `DeviceConfigPublisherService` (boot groupBy + publishForGateway),
e a busca de equipamento da IA (`AiService`). O `SimulatorService` é o ÚNICO consumidor
que consulta explicitamente `protocol:'virtual'` — não filtrar lá.

## Telemetria/valor no frontend
O frontend renderiza o valor do ponto virtual a partir do mapa de telemetria ao vivo,
NÃO de `point.currentValue`. Por isso o backend precisa emitir `bacnet:telemetry`
ao criar um ponto e a cada mudança de valor. Mapeamento kind→objectType:
analog→AV(2), digital→BV(5), multistate→MSI(13) (ver OBJECT_TYPE_NUM).
