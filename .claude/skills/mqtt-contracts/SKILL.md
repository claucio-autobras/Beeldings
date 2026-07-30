---
name: mqtt-contracts
description: Contratos MQTT do BlueBee IoT para tópicos, payloads, telemetria, status, comandos, heartbeat, alarmes e logs. Use quando Codex precisar criar, revisar ou sincronizar contratos MQTT em packages/mqtt-contracts, gateway, backend, frontend ou documentação de integração cloud-edge.
---

# Mqtt Contracts

## Visão geral do protocolo MQTT

MQTT é um protocolo pub/sub leve para IoT (ISO/IEC 20922, MQTT v5.0 OASIS). Opera sobre TCP/IP:
- **Broker**: intermediário central (BlueBee usa EMQX)
- **Publisher**: envia mensagens para tópicos (gateway → nuvem)
- **Subscriber**: recebe mensagens de tópicos (backend → alertas, frontend via Socket.IO)
- Porta padrão: **1883** (sem TLS), **8883** (com TLS/mTLS)
- Porta WebSocket: **8083** (sem TLS), **8084** (com TLS)

---

## QoS — Quality of Service

| QoS | Nome | Garantia | Uso no BlueBee |
|-----|------|----------|----------------|
| 0 | At most once | Pode perder mensagens | Telemetria contínua (aceitável perder ponto) |
| 1 | At least once | Garante entrega, pode duplicar | Status, alarmes, heartbeat |
| 2 | Exactly once | Garante entrega única | Comandos (crítico, sem duplicar execução) |

---

## Tópicos

```typescript
// packages/mqtt-contracts/topics.ts

export const Topics = {
  telemetry:   (tenantId: string, deviceId: string) => `bluebee/${tenantId}/devices/${deviceId}/telemetry`,
  status:      (tenantId: string, deviceId: string) => `bluebee/${tenantId}/devices/${deviceId}/status`,
  commands:    (tenantId: string, deviceId: string) => `bluebee/${tenantId}/devices/${deviceId}/commands`,
  commandAck:  (tenantId: string, deviceId: string) => `bluebee/${tenantId}/devices/${deviceId}/commands/ack`,
  heartbeat:   (tenantId: string, gatewayId: string) => `bluebee/${tenantId}/gateway/${gatewayId}/heartbeat`,
  alarmEvent:  (tenantId: string, deviceId: string) => `bluebee/${tenantId}/alarms/${deviceId}/event`,
  mqttLog:     (tenantId: string) => `bluebee/${tenantId}/mqtt-logs`,
};

export const Wildcards = {
  allTelemetry:   'bluebee/+/devices/+/telemetry',
  allStatus:      'bluebee/+/devices/+/status',
  allHeartbeat:   'bluebee/+/gateway/+/heartbeat',
  allAlarmEvents: 'bluebee/+/alarms/+/event',
  allCommands:    'bluebee/+/devices/+/commands',
  allCommandAcks: 'bluebee/+/devices/+/commands/ack',
  // '#' = wildcard multinível — subscrever TODO o tenant
  allTenantData:  (tenantId: string) => `bluebee/${tenantId}/#`,
};
```

---

## Payloads

### Telemetria (gateway → nuvem)

```typescript
interface TelemetryPayload {
  device_id:  string;
  tenant_id:  string;
  timestamp:  string;            // ISO 8601 — ex: "2025-01-15T14:30:00.000Z"
  protocol:   'modbus' | 'bacnet';
  points: {
    tag:         string;         // ex: 'NTC_01', 'BI_05', 'temp_retorno'
    value:       number | boolean | null;
    unit:        string | null;  // ex: '°C', '%', null
    quality?:    'good' | 'uncertain' | 'bad_comm_failure' | 'bad_device_failure';
  }[];
}
```

**Exemplo real — MPC46D via BACnet:**
```json
{
  "device_id": "mpc46d-01",
  "tenant_id": "cliente-abc",
  "timestamp": "2025-01-15T14:30:00.000Z",
  "protocol": "bacnet",
  "points": [
    { "tag": "NTC_01", "value": 22.5, "unit": "°C", "quality": "good" },
    { "tag": "NTC_02", "value": 23.1, "unit": "°C", "quality": "good" },
    { "tag": "BI_01",  "value": true, "unit": null,  "quality": "good" },
    { "tag": "BI_02",  "value": false,"unit": null,  "quality": "good" }
  ]
}
```

**Exemplo real — MPC46D via Modbus:**
```json
{
  "device_id": "mpc46d-01",
  "tenant_id": "cliente-abc",
  "timestamp": "2025-01-15T14:30:00.000Z",
  "protocol": "modbus",
  "points": [
    { "tag": "NTC_01", "value": 22.5,  "unit": "°C", "quality": "good" },
    { "tag": "DO_01",  "value": 1,      "unit": null,  "quality": "good" },
    { "tag": "DI_05",  "value": 0,      "unit": null,  "quality": "good" }
  ]
}
```

---

### Status do dispositivo (gateway → nuvem)

```typescript
interface DeviceStatusPayload {
  device_id:  string;
  tenant_id:  string;
  timestamp:  string;
  status:     'online' | 'offline' | 'error';
  error?:     string;           // mensagem de erro quando status='error'
  protocol?:  'modbus' | 'bacnet';
}
```

> **Retain = true** para este tópico — novo subscriber recebe o último status imediatamente.

---

### Heartbeat do gateway (gateway → nuvem)

```typescript
interface HeartbeatPayload {
  gateway_id:        string;
  tenant_id:         string;
  timestamp:         string;
  uptime_seconds:    number;
  devices_connected: number;
  buffer_pending:    number;    // mensagens aguardando envio (store-forward)
}
```

> Backend considera gateway `offline` se não receber heartbeat em **90 segundos**.

---

### Comando (nuvem → gateway)

```typescript
interface CommandPayload {
  command_id:  string;          // UUID para rastreamento
  tenant_id:   string;
  device_id:   string;
  protocol:    'modbus' | 'bacnet';
  action:      'set_point' | 'set_mode' | 'restart' | 'write';
  parameters: {
    tag:   string;
    value: number | boolean | string;
    // Modbus:
    register?: number;
    // BACnet:
    objectType?:     number;
    objectInstance?: number;
    property?:       number;
    priority?:       number;    // BACnet priority array (1–16)
  };
  approved_by: string;          // user_id do CCO que aprovou
  timestamp:   string;
}
```

---

### Confirmação de comando (gateway → nuvem)

```typescript
interface CommandAckPayload {
  command_id: string;
  device_id:  string;
  tenant_id:  string;
  status:     'executed' | 'failed';
  error?:     string;
  timestamp:  string;
}
```

---

### Evento de alarme (gateway → nuvem)

```typescript
interface AlarmEventPayload {
  device_id:   string;
  tenant_id:   string;
  timestamp:   string;
  tag:         string;          // ponto que disparou o alarme
  value:       number | boolean;
  severity:    'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  description: string;          // ex: "NTC_01 acima do limite: 45.2°C > 40.0°C"
  // BACnet: pode vir de COVNotification com inAlarm=true
  // Modbus: calculado no gateway após comparar com threshold configurado
}
```

---

## QoS por tipo de tópico

| Tópico | QoS | Retain | Justificativa |
|--------|-----|--------|---------------|
| telemetry | 0 | false | Alta frequência; perda pontual aceitável |
| status | 1 | **true** | Novo subscriber precisa do estado atual |
| heartbeat | 0 | false | Periodicidade própria; próximo chegará em 30s |
| commands | **2** | false | Execução exatamente uma vez — crítico |
| commands/ack | 1 | false | Confirmar entrega da resposta |
| alarm/event | 1 | false | Garantir chegada; duplicata tem tratamento |
| mqtt-logs | 0 | false | Diagnóstico; não crítico |

---

## Will Message — MQTT Last Will

O gateway deve configurar uma Last Will Message para que o broker notifique automaticamente quando a conexão cair de forma inesperada:

```typescript
// Configuração do MQTT client no gateway
const willPayload: DeviceStatusPayload = {
  device_id:  process.env.GATEWAY_ID,
  tenant_id:  process.env.TENANT_ID,
  timestamp:  new Date().toISOString(),
  status:     'offline',
  error:      'Conexão perdida inesperadamente (will message)',
};

const mqttOptions = {
  // ...
  will: {
    topic:   Topics.status(tenantId, gatewayId),
    payload: JSON.stringify(willPayload),
    qos:     1,
    retain:  true,
  },
};
```

---

## Convenção de Client ID

```typescript
// Formato: {tipo}-{tenantId}-{identificador}
// Exemplos:
const clientIds = {
  gateway:  `gateway-${tenantId}-${gatewayId}`,    // ex: gateway-cliente-abc-gw01
  backend:  `backend-${tenantId}-subscriber`,       // ex: backend-cliente-abc-subscriber
  nodeRed:  `nodered-${tenantId}-bridge`,           // ex: nodered-cliente-abc-bridge
};
// Client IDs devem ser únicos por broker — duplicata causa desconexão do anterior
```

---

## Segurança MQTT

```typescript
// Produção: sempre usar MQTT over TLS (porta 8883)
// Autenticação: usuário/senha por gateway + ACL por tópico

// ACL recomendada para um gateway:
// PUBLISH:   bluebee/{tenantId}/devices/+/telemetry
// PUBLISH:   bluebee/{tenantId}/devices/+/status
// PUBLISH:   bluebee/{tenantId}/gateway/{gatewayId}/heartbeat
// PUBLISH:   bluebee/{tenantId}/alarms/+/event
// SUBSCRIBE: bluebee/{tenantId}/devices/+/commands

// Teste local: sem TLS, sem auth — NUNCA em produção
```

---

## Exemplo de subscription no backend NestJS

```typescript
// mqtt.subscriber.service.ts
@Injectable()
export class TelemetrySubscriberService implements OnModuleInit {
  constructor(private readonly mqttClient: MqttService) {}

  onModuleInit() {
    this.mqttClient.subscribe(Wildcards.allTelemetry, { qos: 0 });
    this.mqttClient.on('message', (topic: string, payload: Buffer) => {
      const data = JSON.parse(payload.toString()) as TelemetryPayload;
      // validar tenant_id, processar pontos...
    });
  }
}
```
