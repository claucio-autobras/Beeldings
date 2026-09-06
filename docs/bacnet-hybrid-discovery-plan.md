# Plano — Descoberta híbrida de controladoras BACnet

> Documento de design para evolução **futura**. Não é implementação imediata.
> Ponto de partida: commit `e8bf95c` (varredura unicast em produção).

## 1. Objetivo

Unificar, numa única descoberta robusta, os dois mecanismos de discovery de
controladoras BACnet/IP, cobrindo o máximo de cenários de campo:

1. **Who-Is broadcast** — rápido, padrão, funciona através de roteadores (via
   BBMD/Foreign-Device). Limitação: controladoras que **não respondem Who-Is**
   (ex: MCP46D/Climate) ficam invisíveis.
2. **Varredura unicast** (atual) — lê o Device Object de cada IP da subrede
   local. Acha quem ignora Who-Is. Limitação: só cobre subredes **locais** do
   host e a **porta 47808**.

O híbrido roda os dois e **mescla** o resultado (sem duplicar), entregando a
cobertura combinada.

## 2. Estado atual (o que já existe)

| Peça | Arquivo | Situação |
|------|---------|----------|
| Varredura unicast | `apps/gateway/.../infrastructure/node-bacnet.client.ts` → `getScanTargets()`, `probeDeviceObject()` | **Em uso** pelo scan |
| Who-Is broadcast | mesmo arquivo → `whoIsBroadcast()`, `broadcastTargets`, `resolveBroadcastTargets()` | **Implementado, porém NÃO usado** pelo scan |
| Orquestração gateway | `apps/gateway/.../application/bacnet-network-discovery.service.ts` → `executeScan()` | Faz só a varredura unicast |
| Orquestração backend | `apps/backend/.../application/bacnet-network-discovery.service.ts` | MQTT round-trip, timeout 60s |
| Contrato MQTT | `bluebee/{tenant}/gateway/{gw}/commands` (action=scan) → `.../discovery/scan-result` | Não muda no híbrido |

> Vantagem: o código de Who-Is broadcast **já está pronto** no cliente — o
> híbrido é majoritariamente orquestração + merge.

## 3. Arquitetura proposta

```
handleScanCommand(action=scan)
        │
        ├─ Fase A: whoIsBroadcast()            ─┐  (em paralelo)
        │     → [{instance, address, vendorId}]  │
        │                                        │
        └─ Fase B: getScanTargets()+probe...    ─┘
              → [{instance, address, model...}]
        │
        ▼
   mergeDedup(A, B)  → DiscoveredBacnetDevice[]  → publish scan-result
```

- **Paralelo, não sequencial:** rodar Who-Is e varredura ao mesmo tempo. O
  tempo total ≈ `max(whoIs ~10s, sweep ~15-30s)`, não a soma.
- **Enriquecimento:** o Who-Is só dá `instance + ip + vendorId`. Para os
  achados *apenas* por Who-Is, reutilizar `readDeviceInfo()` (já existe) para
  buscar `modelName/objectName`.

### Merge / deduplicação
- Chave primária: **`instance`** (device instance é único na rede BACnet).
- Empate de IP com instâncias diferentes ou vice-versa: preferir o registro
  com mais informação (modelo/nome preenchidos).
- Resultado: união sem duplicar a mesma controladora vista pelos dois caminhos.

## 4. Configuração (env)

| Variável | Função | Default |
|----------|--------|---------|
| `BACNET_SCAN_MODE` | `unicast` \| `broadcast` \| `hybrid` | `unicast` (mantém comportamento atual) |
| `BACNET_SCAN_SUBNETS` | restringe a varredura (lista CIDR) | auto-detect |
| `BACNET_BROADCAST_ADDRESS` | alvos do Who-Is (lista) | auto-detect |
| `BACNET_INTERFACE` | NIC de bind do socket | todas (0.0.0.0) |
| `BACNET_PORT` *(novo)* | porta BACnet a sondar/escutar | `47808` |

Manter `unicast` como default evita regressão: o híbrido só liga quando o
operador escolher.

## 5. Extensões para fechar os gaps restantes

Em ordem de valor/esforço:

1. **Repetição do Who-Is** (baixo esforço): a ASHRAE recomenda reenviar Who-Is
   algumas vezes (perda UDP). Enviar 2–3 rajadas dentro da janela.
2. **Porta configurável** (`BACNET_PORT`): hoje tudo assume 47808. Tornar
   parametrizável cobre controladoras em porta não-padrão. (Sondar múltiplas
   portas encarece a varredura — preferir 1 porta por env.)
3. **BBMD / Foreign Device Registration** (médio/alto esforço): para redes
   **roteadas**, registrar o gateway como Foreign Device num BBMD
   (`registerForeignDevice` existe no node-bacnet) faz o Who-Is alcançar outras
   subredes — único jeito de descobrir além da LAN local.
4. **MS/TP (serial)**: fora do escopo IP. Só descoberta via roteador BACnet/IP
   que exponha os devices MS/TP — depende do hardware. Documentar como "não
   suportado pela descoberta IP".

## 6. Impacto por camada

- **Gateway:** novo `discoverHybrid()` (orquestra A+B+merge); `executeScan()`
  passa a despachar conforme `BACNET_SCAN_MODE`. Reusa tudo que já existe.
- **Backend:** sem mudança de contrato. Opcional: incluir no `scan-result` o
  campo `method` (`unicast`/`broadcast`/`hybrid`) e por-device a origem, para a
  UI. Timeout já em 60s (subir p/ 90s se necessário com Who-Is repetido).
- **Frontend:** opcional — (a) progresso por fase ("Procurando via Who-Is…" /
  "Varrendo IPs…"); (b) seletor de modo em "opções avançadas". Sem isso, o
  híbrido funciona transparente.

## 7. Passos de implementação (incrementais e seguros)

1. **`BACNET_SCAN_MODE`** lido em `executeScan()`, default `unicast` → zero
   regressão.
2. **`mergeDedup()`** + `discoverHybrid()` no gateway (Who-Is ∥ sweep). Ligar via
   `BACNET_SCAN_MODE=hybrid`.
3. **Enriquecer** achados só-Who-Is com `readDeviceInfo()`.
4. **Testes:** rede com a MCP46D (só sweep) + uma controladora Who-Is-compatível
   → ambas aparecem **uma única vez**.
5. *(Opcional)* repetição de Who-Is, `BACNET_PORT`, BBMD/FDR.
6. *(Opcional)* UI: progresso por fase + seletor de modo.

## 8. Critérios de aceite

- [ ] `BACNET_SCAN_MODE=hybrid` encontra **tanto** controladoras que ignoram
      Who-Is (MCP46D) **quanto** as que só respondem Who-Is, **sem duplicar**.
- [ ] `BACNET_SCAN_MODE=unicast` (default) mantém exatamente o comportamento
      atual — nenhuma regressão.
- [ ] Tempo total do modo híbrido ≈ `max(Who-Is, varredura)` (execução paralela).
- [ ] Fluxos existentes (adicionar por IP / discover unicast / polling / write)
      permanecem intactos.

## 9. Riscos e cuidados

- **Tempestade de broadcast** em redes com BBMD mal configurado — limitar
  repetições do Who-Is.
- **Sobrecarga de controladoras embarcadas** — manter os lotes
  (`PROBE_BATCH_SIZE`) e timeouts curtos da varredura.
- **Dedup incorreto** se um device responder com instância 0/ inválida — tratar
  como no `whoIsBroadcast()` atual (ignora instance 0).
