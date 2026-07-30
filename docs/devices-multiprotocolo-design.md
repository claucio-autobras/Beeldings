# Design — Devices Multiprotocolo (BACnet · Modbus · MQTT)

> Base para implementação. Generaliza o módulo de **devices** (hoje BACnet-cêntrico)
> para suportar três protocolos de aquisição mantendo o backend **protocol-agnostic**.
> ⚠️ Requer **migração de banco** (coluna nova em `device_points`) — só aplicar com autorização.
> Decisões fechadas com o usuário: **normalização na borda (gateway faz bridge)** +
> **coluna `binding Json?`** no `DevicePoint`.

---

## 1. Princípios

- **Backbone único de telemetria.** Toda telemetria entra no backend por **um só**
  tópico canônico — `bluebee/{tenant}/gateway/{gw}/telemetry` com `{ deviceId, points[] }`.
  Quem decide o protocolo é o **gateway**, não o backend.
- **Backend protocol-agnostic.** O backend é a **fonte da verdade** do cadastro
  (devices + pontos + binding) e empurra a config ao gateway. Ele não fala BACnet,
  Modbus nem MQTT-nativo — só publica config e consome telemetria normalizada.
- **Normalização na borda.** O gateway traduz cada protocolo para o formato canônico:
  - BACnet → polling (já existe).
  - Modbus → polling de registradores.
  - MQTT-nativo → **bridge**: assina o tópico do equipamento, extrai o valor, republica
    no tópico canônico.
- **Reuso total do downstream.** `BacnetMqttSubscriber`, `TrendRecorderService`,
  `AlarmEngineService`, `DeviceStatusService` e o websocket **não mudam** — eles já
  consomem o payload canônico por `deviceId`+`tag`.
- **Binding flexível.** A config específica de protocolo de cada ponto vive numa
  coluna `binding Json?` no `DevicePoint` — sem nova migração a cada protocolo.

---

## 2. Decisões (fechadas)

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | Onde normaliza payload nativo | **Gateway (borda)**. Backend continua agnóstico. |
| 2 | Modelo de config por protocolo | **Coluna `binding Json?`** em `device_points`. |
| 3 | MQTT-nativo do cliente | **Via gateway** (bridge), pois sensor e gateway estão na mesma rede local. |
| 4 | Descoberta Modbus | **Sem auto-discovery**. Conecta no IP:porta:unitId e os registradores são **adicionados manualmente** (clássico Modbus). |
| 5 | Identidade do ponto | `tag` continua a chave lógica que casa telemetria↔ponto. `objectType/instance` viram **legado BACnet**; novos protocolos usam só `tag` + `binding`. |
| 6 | Coluna `protocol` do device | Mantida (`'bacnet' | 'modbus' | 'mqtt'`) — passa a rotear qual bloco de config é publicado. |
| 7 | Isolamento do bridge MQTT | **Conexão MQTT dedicada** no gateway p/ a entrada nativa (separada da conexão cloud existente). Saída reusa `GatewayMqttService.publish()` no tópico canônico. **Guard anti-loop**: `sourceTopic` proibido dentro de `bluebee/`. Broker de origem configurável (`BRIDGE_BROKER_URL`) — pode ser local ou o mesmo EMQX. |
| 8 | Ordem de entrega | **Modbus primeiro** (testável já com simulador Modbus TCP). MQTT depois (sem hardware ainda). |

---

## 3. Estado atual (o que já existe e o gap)

- `Device` é BACnet-cêntrico: `port @default(47808)`, `DevicePoint` com `objectType`/`instance`.
- **Já existe `POST /devices/modbus`** ([devices.controller.ts:206](../apps/backend/src/modules/devices/presentation/devices.controller.ts#L206)),
  mas está **enganoso**: aceita e devolve `registerType/dataType/scale/offset/unitId/pollingInterval`,
  porém **não persiste nada disso** (não há colunas) e o `DeviceConfigPublisherService`
  filtra `protocol: 'bacnet'` — **a config Modbus nunca chega ao gateway**. Quem olha a
  API hoje acha que Modbus funciona; não funciona.
- **Não existe caminho MQTT-nativo** em nenhuma camada.
- No gateway, o `CommandDispatcherService` já tem um ramo `modbus` que só loga
  "não implementado" ([command-dispatcher.service.ts:71](../apps/gateway/src/commands/command-dispatcher.service.ts#L71)).

Este design fecha esses três gaps.

---

## 4. Modelo de dados (Prisma — migração a autorizar)

Migração **aditiva** e nullable — não quebra os pontos BACnet existentes.

```prisma
model DevicePoint {
  id         String   @id @default(uuid())
  deviceId   String   @map("device_id")
  device     Device   @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  tag        String
  objectName String   @map("object_name")
  objectType String   @map("object_type")   // legado BACnet; "modbus"/"mqtt" p/ novos
  instance   Int                             // legado BACnet (= register no modbus atual)
  unit       String?
  binding    Json?                           // ◄── NOVO: config específica de protocolo
  createdAt  DateTime @default(now()) @map("created_at")
  ...
  @@unique([deviceId, objectType, instance])
  @@map("device_points")
}
```

> Nota: o `@@unique([deviceId, objectType, instance])` continua válido para BACnet e
> Modbus (instance=register). Para MQTT, onde não há "instance" natural, usar um índice
> incremental por device como `instance` apenas para satisfazer a constraint — a chave
> real do ponto MQTT vive no `binding`.

### Shapes do `binding` por protocolo

```ts
// BACnet (opcional — hoje vive em colunas; binding pode ficar null)
type BacnetBinding = {
  objectType: number;   // 0=AI,1=AO,2=AV,3=BI,4=BO,5=BV,13=MSI,14=MSO
  instance: number;
  property: number;     // 85 = presentValue
};

// Modbus
type ModbusBinding = {
  register: number;                              // ex.: 20001 (base MPC46D)
  registerType: 'holding' | 'input' | 'coil' | 'discrete';
  dataType: 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32';
  endianness?: 'big' | 'little';                 // p/ 32 bits
  scale?: number;                                // default 1
  offset?: number;                               // default 0
};

// MQTT-nativo (bridge)
type MqttBinding = {
  sourceTopic: string;       // tópico que o equipamento publica, ex.: "sensors/temp-sala-01"
  jsonPath?: string;         // caminho do valor no payload, ex.: "$.temperature". Ausente = payload é o valor cru
  valueType?: 'number' | 'boolean';
};
```

Config do **device** (não-ponto) também vai pro `binding`/colunas do device:
- Modbus: `unitId`, `pollingIntervalMs` → reaproveitar `port` + novo campo, ou guardar
  num `Device.config Json?` (mesma estratégia). **A decidir na implementação**: por
  simplicidade, propõe-se `Device.config Json?` para `{ unitId, pollingIntervalMs }`.

---

## 5. Contrato MQTT — config estendida (backend → gateway)

Tópico **inalterado** (retido, QoS 1): `bluebee/{tenant}/gateway/{gw}/config`.
O `DeviceConfigPublisherService` deixa de filtrar `bacnet` e passa a emitir, **por device**,
um bloco conforme o `protocol`:

```jsonc
{
  "tenantId": "...",
  "gatewayId": "...",
  "devices": [
    // BACnet (formato atual, inalterado)
    { "deviceId": "...", "protocol": "bacnet", "ip": "...", "port": 47808,
      "pollingIntervalMs": 15000,
      "objects": [{ "tag": "...", "objectType": 0, "objectInstance": 1, "property": 85, "unit": "°C", "useCov": false }] },

    // Modbus (NOVO)
    { "deviceId": "...", "protocol": "modbus", "ip": "...", "port": 502,
      "unitId": 1, "pollingIntervalMs": 15000,
      "registers": [{ "tag": "temp_agua", "register": 20001, "registerType": "holding",
                      "dataType": "float32", "scale": 1, "offset": 0, "unit": "°C" }] },

    // MQTT-nativo (NOVO) — mapa de bridge
    { "deviceId": "...", "protocol": "mqtt",
      "bridge": [{ "tag": "temperatura", "sourceTopic": "sensors/temp-sala-01",
                   "jsonPath": "$.temperature", "valueType": "number", "unit": "°C" }] }
  ]
}
```

O gateway roteia cada bloco para o serviço do protocolo correspondente. Como é **retido**,
o gateway recebe a última config ao (re)conectar — comportamento já existente.

---

## 6. Fluxos por protocolo no gateway

### 6.1 BACnet (existente, sem mudança)
`BacnetPollingService` faz polling e publica no tópico canônico.

### 6.2 Modbus (novo — `ModbusPollingService`)
1. Recebe bloco `protocol: 'modbus'` da config.
2. Abre conexão Modbus TCP em `ip:port`, `unitId`.
3. A cada `pollingIntervalMs`, lê os `registers`, aplica `dataType`/`scale`/`offset`/`endianness`.
4. Monta `{ deviceId, points: [{ tag, value }] }` e publica no **tópico canônico**.
> **Sem discovery**: não há "scan Modbus". Os registradores são cadastrados manualmente
> no frontend (mapa do fabricante / MPC46D base 20.000 — ver skill `modbus-mapping`).

### 6.3 MQTT-nativo (novo — `MqttBridgeService`)
1. Recebe bloco `protocol: 'mqtt'` com o array `bridge`.
2. Assina cada `sourceTopic` numa **conexão MQTT dedicada** (`BRIDGE_BROKER_URL` — broker
   local do cliente ou o próprio EMQX). **Nunca** reusar a conexão cloud do gateway.
3. Ao receber mensagem: extrai o valor via `jsonPath` (ou usa payload cru), converte para `valueType`.
4. Reagrupa em `{ deviceId, points: [{ tag, value }] }` e publica no **tópico canônico**
   via `GatewayMqttService.publish()` (mesmo caminho do BACnet).
> A partir daqui o pipeline (trends/alarmes/status/websocket) funciona **sem nenhuma
> alteração**, porque o dado já está normalizado.

**Não quebrar o que já existe (isolamento):**
- **Conexão separada** para a entrada nativa → a conexão cloud existente (telemetria
  out / config in / comandos in) fica intocada; zero risco de regressão no BACnet.
- **Guard anti-loop**: rejeitar qualquer `sourceTopic` que comece com `bluebee/`. O bridge
  só assina tópicos nativos do fabricante — nunca o namespace canônico, senão republicaria
  o próprio output em loop. Validar no cadastro (backend) **e** ao aplicar a config (gateway).
- **Saída no caminho canônico já existente** → para o downstream o dado é indistinguível
  de telemetria BACnet.

---

## 7. Backend — endpoints

| Método | Rota | Mudança |
|--------|------|---------|
| `POST` | `/devices/bacnet` | Inalterado. |
| `POST` | `/devices/modbus` | **Corrigir**: persistir `binding` Modbus + `Device.config` (`unitId`, `pollingIntervalMs`); chamar `configPublisher.publishForDevice`. |
| `POST` | `/devices/mqtt` | **Novo**: cadastra device + pontos com `MqttBinding`; publica mapa de bridge. |
| `POST` | `/devices/:id/points` | **Novo (genérico)**: adicionar registradores Modbus / pontos MQTT manualmente (Modbus não tem sync/discovery). |
| `PATCH`/`DELETE` | `/devices/:id` | Inalterado (já republicam config). |

`DeviceConfigPublisherService`: remover filtro `protocol: 'bacnet'` no
`onApplicationBootstrap` e `publishForGateway`; montar bloco por protocolo (seção 5).

---

## 8. Frontend

Wizard de "Adicionar dispositivo" com seleção de protocolo:
- **BACnet**: fluxo atual (scan de rede → discovery de objetos → seleção de pontos).
- **Modbus**: form de conexão (IP, porta=502, unitId, polling) → **tabela manual de
  registradores** (tag, register, registerType, dataType, scale, offset, unit). Sem scan.
- **MQTT**: form (nome, site) → **tabela manual de pontos** (tag, sourceTopic, jsonPath,
  valueType, unit). Sem scan.

---

## 9. Ordem de implementação

> **Modbus primeiro** — é testável já com um simulador Modbus TCP (diagslave,
> `modbus-server`), sem precisar de hardware. MQTT fica por último porque ainda não há
> equipamento em campo. BACnet **não é tocado** em nenhum passo.

**Bloco 1 — Modbus (entregar e testar primeiro)**
1. **Migração**: `DevicePoint.binding Json?` + `Device.config Json?` (autorizar antes).
2. **Backend — config publisher**: remover filtro `bacnet`; emitir bloco `modbus`.
3. **Backend — endpoints**: corrigir `/devices/modbus` (persistir `binding` + `config`) e
   criar `POST /devices/:id/points` (adicionar registradores manualmente).
4. **Gateway — `ModbusPollingService`** + ramo `modbus` no `CommandDispatcherService`.
5. **Frontend** — aba Modbus no wizard (conexão + tabela manual de registradores).
6. **Teste E2E** com simulador Modbus TCP.

**Bloco 2 — MQTT (quando houver/antes do hardware chegar)**
7. **Backend — endpoint** `POST /devices/mqtt` + bloco `mqtt` no config publisher (com
   guard anti-loop no cadastro).
8. **Gateway — `MqttBridgeService`** (conexão dedicada + guard anti-loop — ver §6.3).
9. **Frontend** — aba MQTT no wizard (tabela manual de pontos: tag/sourceTopic/jsonPath).
</content>
</invoke>
