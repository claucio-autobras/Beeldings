---
name: SNMP walk — normalização ASN.1 e guards
description: TimeTicks normalizado UMA vez na fronteira do walk do gateway; compat gateway antigo; scale de exibição vs scale de binding; guards do walk; filtro loopback/down.
---

# SNMP walk — normalização e guards (Fase 1)

**Regra 1 — normalização única na fronteira do walk (gateway):** o gateway
normaliza varbinds no walk (`normalizeSnmpVarbind`): TimeTicks ÷100 → segundos
com `kind:'duration'`; Counter32/64 mantêm acumulador com `kind:'counter'`
(taxa é responsabilidade do coletor); OCTET STRING numérico via
`parseSnmpNumber`. O caminho GET/telemetria (binding scale) NÃO passa por isso
— continua entregando ticks crus, e o binding precisa de scale 0.01 para
TimeTicks vendor (ex. Dahua deviceUpTime).

**Regra 2 — dois "scales" diferentes; nunca misturar:**
- *Scale de exibição* (view `discovered`): backend converte TimeTicks p/ segundos
  (÷100 só se o entry NÃO tem `kind:'duration'` — compat gateway antigo) e força
  `known.scale = 1`. Frontend também zera scale quando `type==='TimeTicks'`.
- *Scale de binding* (apply): vem do catálogo/`classifySnmpOid` direto (0.01
  p/ TimeTicks), porque o GET continua cru. Os caminhos de apply NÃO leem o
  scale da view — não regredir isso.

**Regra 3 — guards do walk** (`WalkEntryCollector`, puro/testável): OID fora do
prefixo da raiz = fim normal; OID não estritamente crescente (comparação
NUMÉRICA por componente, nunca string) = aborta truncado; varbinds de erro
(types 128/129/130) = fim normal. `tooBig` → loop externo reduz
max-repetitions pela metade (mín 1) dentro do budget de tempo.

**Regra 4 — loopback/down:** filtragem fica no BACKEND, derivada do próprio
walk (`buildInterfaceWalkInfo`: ifTable cols .2/.3/.8). ifType 24 nunca vira
candidato/porta; down fica visível mas fora da criação automática; sem
contexto = não esconder. Rótulo sempre pelo ifDescr, nunca ifIndex.
`counterTableUnit()` decide unidade (octets→B/s, errors/discards→pkt/s).

**Why:** campo (iDFlex V2) mostrou dupla conversão de uptime, card "PACOTES
PERDIDOS — LO", contadores publicados crus e walks em loop com agentes
defeituosos.

**How to apply:** ao mexer em diagnóstico/descoberta SNMP, pergunte sempre "este
valor já foi normalizado na fronteira?" e "este scale é de exibição ou de
binding?". Specs de referência: `snmp-walk-guards.spec.ts` (gateway),
`snmp-discovery-normalization.spec.ts` e `switch-port-filter.util.spec.ts`
(backend). `snmp-walk-parity.spec.ts` exige paridade exata de OIDs — guards não
podem descartar OIDs válidos crescentes dentro da subárvore.
