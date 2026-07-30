---
name: BACnet routed addressing & discovery tiers
description: How MS/TP-behind-router devices are addressed (net/adr in Device.config) and how discovery source tiers work end-to-end.
---

# Rota net/adr (MS/TP atrás de roteador BACnet)

- A rota é capturada do NPDU do I-Am pelo gateway (source net + adr). `ip` é sempre o IP do ROTEADOR; `net`/`adr` endereçam o device na rede remota.
- **Persistência**: `Device.config` (Json) guarda `{ deviceInstance, net, adr, pollingIntervalMs }`. Todo consumidor (config publisher → polling/COV, writes via automation, discovery) lê dali. Não há colunas dedicadas.
- **Convenção de validade**: `net` válido quando `> 0`; `adr` válido quando array não-vazio. Ambos ou nenhum.
- `ip` pode vir como `"ip:porta"` do scan; o client do gateway só concatena `:port` se o ip não contiver `:`. Frontend separa em campos IP/porta ao selecionar do scan.

# Tiers de discovery (discoverySource)

1. `objectList` — leitura da propriedade objectList inteira (exato).
2. `objectListIndex` — leitura índice a índice quando a leitura inteira falha (exato, lento).
3. `scan` — SCAN_MAP heurístico quando a controladora não expõe objectList (pode faltar objeto).

**Why:** controladoras de fabricantes diversos (ex.: MCP46D) não respondem Who-Is nem expõem objectList; o resultado heurístico precisa ser sinalizado ao usuário (badge no AddBACnetDeviceModal e no BACnetSyncModal) para não parecer lista completa.

**How to apply:** qualquer novo fluxo que fale com controladora BACnet deve aceitar/propagar `net`/`adr` + `deviceInstance` e repassar `discoverySource` quando enumerar objetos. Pontos sem nome recebem default `TYPE-instance` + flag `unnamed` (não persistida — indicação só pré-save).

# Telemetria com strings (CharacterString Value, tipo 40)

- O contrato de telemetria aceita `value: number | string` fim a fim (gateway polling/COV → MQTT → backend gateway socket → frontend). Strings numéricas continuam viradas número; texto puro flui como string aparada.
- Consumidores numéricos (trends, alarmes) fazem skip silencioso de strings não-numéricas (`Number()` → NaN → continue). Automação: string textual só suporta EQ/NEQ (comparada com `String(target)`).
- **Why:** antes o `toNumericValue` descartava CharacterStrings — pontos tipo 40 eram descobertos mas nunca monitoráveis.
- **How to apply:** qualquer novo consumidor de telemetria deve tratar `typeof value === 'string'` explicitamente (exibir como texto ou pular), nunca assumir número.
