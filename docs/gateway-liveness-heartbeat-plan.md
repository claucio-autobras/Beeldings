# Plano — Status online/offline do gateway via heartbeat + Last Will

> Documento de design para evolução **futura**. Não é implementação imediata.
> Quando for executar, basta solicitar e apontar este arquivo.

## 1. Problema

Hoje o status **online/offline do gateway** exibido na web não reflete a
conexão do gateway ao broker — reflete apenas **chegada de telemetria**.

Cadeia atual:

1. O backend deriva o status de `DeviceStatusService.getStatus(gateway.id)`
   → [`gateways.service.ts`](../apps/backend/src/modules/gateways/application/gateways.service.ts) (`withLiveStatus`).
2. `getStatus` só retorna `online` se houve `markSeen(gatewayId)` nos últimos
   45s → [`device-status.service.ts`](../apps/backend/src/modules/mqtt/device-status.service.ts) (`ONLINE_THRESHOLD_MS = 45_000`).
3. `markSeen(gatewayId)` **só é chamado quando chega telemetria** no tópico
   `bluebee/{tenant}/gateway/{id}/telemetry` →
   [`bacnet-mqtt.subscriber.ts`](../apps/backend/src/modules/mqtt/bacnet-mqtt.subscriber.ts) (`gatewayId = topic.split('/')[3]`).

E o gateway **não publica heartbeat nem status** ao conectar — só assina
`commands` e `config` e fica esperando →
[`gateway-mqtt.service.ts`](../apps/gateway/src/mqtt/gateway-mqtt.service.ts).

**Consequência:** um gateway conectado ao broker mas **sem controladora
enviando dados** aparece como **offline**, mesmo o EMQX mostrando o cliente
como `Connected`.

> **Nota:** existe uma alternativa rápida e só-backend (consultar a API REST do
> EMQX `GET /api/v5/clients` para saber se o gateway está conectado, sem tocar
> no gateway nem regerar o `.exe`). Este documento descreve o caminho
> **definitivo / correto a longo prazo** — heartbeat de aplicação + Last Will —
> que dá liveness em nível de aplicação, não só estado de TCP.

## 2. Objetivo

Fazer o status online/offline do gateway depender da **própria saúde do
gateway**, independente de haver telemetria de controladora:

- **online** → gateway conectado e batendo o heartbeat.
- **offline** → gateway caiu (detecção quase instantânea via Last Will) **ou**
  heartbeat obsoleto (timeout).

Sem regredir o comportamento atual de telemetria (telemetria continua sendo
uma prova de vida válida — os dois caminhos coexistem).

## 3. Arquitetura proposta

```
GATEWAY (apps/gateway)                         BACKEND (apps/backend)
─────────────────────                          ──────────────────────
mqtt.connect({                                 subscribe:
  will: {                          ── LWT ──▶     bluebee/+/gateway/+/status
    topic:  .../gateway/{id}/status
    payload:{status:"offline"}     ◀─ EMQX publica o will se cair
    retain: true, qos: 1
  }
})
  │ on('connect')
  ├─ publish status {online} retain  ── MQTT ─▶  markSeen(gatewayId)
  │                                              + status online
  └─ setInterval(15s)
       publish heartbeat             ── MQTT ─▶  markSeen(gatewayId)
```

### 3.1. Lado gateway — `gateway-mqtt.service.ts`

1. **Last Will (LWT)** nas opções do `mqtt.connect`:
   - `topic`: `bluebee/{tenantId}/gateway/{gatewayId}/status`
   - `payload`: `{ "status": "offline", "ts": <epoch> }`
   - `qos: 1`, `retain: true`
   - O EMQX publica isso **automaticamente** se o gateway cair sem desconectar
     limpo → offline quase instantâneo.

2. **Publicar "online" no `connect`** (no callback `on('connect')`, junto dos
   `subscribe` já existentes):
   - mesmo tópico `.../status`, `payload { status: "online", ts }`,
     `retain: true`.

3. **Heartbeat periódico** — `setInterval` (15–30s; alinhar com o
   `ONLINE_THRESHOLD_MS = 45s`, mantendo período < threshold/2):
   - publicar em `.../status` (ou `.../heartbeat`) com `{ status:"online", ts }`.
   - limpar o intervalo no `onModuleDestroy`.

4. **Desconexão limpa** no `onModuleDestroy`: publicar `{status:"offline"}`
   retido antes do `client.end()` (cobre parada graciosa do serviço Windows).

> Como mexe no gateway, **exige regerar o `.exe`** (`npm run package:win`) e
> redistribuir às máquinas — ver memória de _Gateway Packaging_.

### 3.2. Lado backend — subscriber MQTT

Atualmente o `markSeen(gatewayId)` vive no subscriber de telemetria. Opções:

- **Adicionar subscription** ao tópico `bluebee/+/gateway/+/status` (ou
  `/heartbeat`) e, ao receber, extrair `gatewayId = topic.split('/')[3]`:
  - `status: "online"` → `deviceStatus.markSeen(gatewayId)`.
  - `status: "offline"` → marcar offline imediato (ver §3.3).

Reaproveita o mesmo `DeviceStatusService` — sem novo mecanismo de estado.

### 3.3. Offline imediato (opcional, recomendado)

O `DeviceStatusService` hoje só sabe "visto por último" (timeout). Para o LWT
derrubar o status **na hora** (sem esperar 45s), adicionar um
`markOffline(gatewayId)` que zera/expira o `lastSeen`. Sem isso, o offline
ainda funciona, mas só por timeout.

## 4. Contrato MQTT (registrar em `packages/mqtt-contracts`)

| Item | Valor |
|------|-------|
| Tópico | `bluebee/{tenantId}/gateway/{gatewayId}/status` |
| Payload | `{ "status": "online" \| "offline", "ts": <epoch_ms> }` |
| QoS | 1 |
| Retain | `true` (último estado conhecido entregue a quem subscrever depois) |
| LWT | mesmo tópico, payload `{"status":"offline"}`, retain `true` |
| Heartbeat | mesmo tópico, intervalo 15–30s |

> A ACL atual já libera `bluebee/{tenant}/gateway/{gatewayId}/#` para o gateway
> ([`emqx-provisioning.service.ts`](../apps/backend/src/modules/sites/application/emqx-provisioning.service.ts)),
> então `/status` **já está autorizado** — não precisa mexer em ACL.

## 5. Arquivos afetados

| Arquivo | Mudança |
|---------|---------|
| `apps/gateway/src/mqtt/gateway-mqtt.service.ts` | LWT no connect, publish online, setInterval heartbeat, cleanup no destroy |
| `apps/backend/src/modules/mqtt/bacnet-mqtt.subscriber.ts` (ou novo subscriber) | subscribe `.../status`, tratar online/offline |
| `apps/backend/src/modules/mqtt/device-status.service.ts` | (opcional) `markOffline()` para offline imediato |
| `packages/mqtt-contracts` | registrar tópico/payload de status |

> **Não muda:** `GatewaysService.withLiveStatus` continua igual — ele já lê do
> `DeviceStatusService`, que passará a ser alimentado também pelo heartbeat.

## 6. Decisões a confirmar na hora de implementar

1. **Período do heartbeat** vs. `ONLINE_THRESHOLD_MS` (hoje 45s) — manter
   período < threshold/2 para tolerar uma perda de batimento.
2. **Persistir `lastSeen` no banco?** Hoje é só memória — reinício do backend
   zera o estado até o próximo heartbeat (≤ período). Provavelmente aceitável.
3. **`/status` único vs. `/status` + `/heartbeat` separados** — um tópico só
   (status com retain) é mais simples e suficiente.
4. **Offline imediato** (§3.3) — implementar junto ou deixar só por timeout.

## 7. Pré-requisitos / atenção

- Regerar e redistribuir o `.exe` do gateway (`npm run package:win`).
- Validar que o EMQX está com retained messages habilitado (padrão: sim).
