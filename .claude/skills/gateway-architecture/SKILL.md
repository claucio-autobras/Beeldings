---
name: gateway-architecture
description: Arquitetura do gateway local do BlueBee IoT, incluindo NestJS Microservice, leitura Modbus/BACnet, publicação MQTT, store-and-forward, heartbeat, comandos reversos e buffer offline. Inclui setup Docker Compose para ambiente de teste local (EMQX + Node-RED) e fluxo Node-RED para MPC46D → EMQX. Use quando Codex precisar projetar, implementar ou revisar o gateway industrial, seus módulos, fluxos de telemetria, comandos cloud-to-edge e resiliência de conexão.
---

# Gateway Architecture

## O que é o gateway

O gateway é um **processo NestJS** instalado na rede local do cliente. Ele:
1. Lê dados dos equipamentos via Modbus TCP/RTU ou BACnet/IP
2. Publica esses dados no broker MQTT na nuvem
3. Recebe comandos da nuvem e os executa nos equipamentos
4. Mantém buffer local quando o MQTT está offline (store-and-forward)
5. Envia heartbeat periódico para indicar que está online

---

## Estrutura modular do gateway

```
apps/gateway/src/
├── main.ts                          # bootstrap NestJS Microservice
├── app.module.ts                    # registra: MqttModule, HeartbeatModule, CommandsModule, StoreForwardModule, ModbusModule, BacnetModule
│
├── mqtt/            ← gateway-agent    # conexão com broker, publish/subscribe
├── heartbeat/       ← gateway-agent    # envio periódico de heartbeat
├── commands/        ← gateway-agent    # recepção e dispatch de comandos reversos
├── store-forward/   ← gateway-agent    # buffer SQLite + reenvio
├── config/          ← gateway-agent    # leitura de variáveis de ambiente
│
├── modbus/          ← modbus-agent     # polling Modbus, mapeamento de registradores
└── bacnet/          ← bacnet-agent     # leitura BACnet, COV, discovery
```

---

## Fluxo de dados — leitura (gateway → nuvem)

```
Equipamento BMS
    ↕ Modbus TCP / BACnet IP
modbus-agent / bacnet-agent (polling ou COV)
    ↓ payload JSON montado
GatewayMqttService.publish(topic, payload)
    ↓ (se MQTT online)
Broker EMQX
    ↓ (se MQTT offline)
StoreForwardService → SQLite local (buffer)
    ↓ quando MQTT reconectar
StoreForwardService → publish em ordem FIFO
```

---

## Fluxo de dados — comandos reversos (nuvem → equipamento)

```
Backend NestJS (automation-agent)
    ↓ MQTT publish
Broker EMQX → tópico: bluebee/{tenant_id}/devices/{device_id}/commands
    ↓
gateway-agent: CommandSubscriberService recebe
    ↓
CommandDispatcherService → EventEmitter2.emit('command.modbus', cmd)
                                              ou emit('command.bacnet', cmd)
    ↓
modbus-agent: escuta 'command.modbus' → escreve registrador
bacnet-agent: escuta 'command.bacnet' → escreve propriedade BACnet
    ↓
ACK publicado de volta: bluebee/{tenant_id}/devices/{device_id}/commands/ack
```

---

## Store-and-Forward — SQLite local

```sql
-- Criado automaticamente no primeiro boot
CREATE TABLE IF NOT EXISTS buffer (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic       TEXT NOT NULL,
  payload     TEXT NOT NULL,     -- JSON serializado
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent        INTEGER DEFAULT 0  -- 0 = pendente, 1 = enviado
);
```

```typescript
// store-forward.service.ts
export class StoreForwardService {
  // Chamado quando MQTT falha ao publicar
  async buffer(topic: string, payload: object): Promise<void> {
    await this.db.run(
      'INSERT INTO buffer (topic, payload) VALUES (?, ?)',
      [topic, JSON.stringify(payload)]
    );
  }

  // Chamado quando MQTT reconecta
  async flush(): Promise<void> {
    const pending = await this.db.all(
      'SELECT * FROM buffer WHERE sent = 0 ORDER BY created_at ASC'
    );

    for (const row of pending) {
      await this.mqtt.publish(row.topic, JSON.parse(row.payload));
      await this.db.run('UPDATE buffer SET sent = 1 WHERE id = ?', [row.id]);
    }

    // Limpar registros enviados com mais de 24h
    await this.db.run(
      "DELETE FROM buffer WHERE sent = 1 AND created_at < datetime('now', '-1 day')"
    );
  }
}
```

---

## Heartbeat

```typescript
// Publicado a cada 30 segundos no tópico:
// bluebee/{tenant_id}/gateway/{gateway_id}/heartbeat

interface HeartbeatPayload {
  gateway_id:    string;
  tenant_id:     string;
  timestamp:     string;    // ISO 8601
  status:        'online';
  uptime_seconds: number;
  buffer_pending: number;   // qtd de mensagens aguardando reenvio
}
```

O backend monitora o heartbeat: se não receber em 90 segundos, marca o gateway como `offline` e pode disparar alarme de conectividade.

---

## Estrutura do comando reverso

```typescript
// Payload recebido no tópico de commands:
interface GatewayCommand {
  command_id:   string;       // UUID para rastreamento e ACK
  device_id:    string;
  tenant_id:    string;
  protocol:     'modbus' | 'bacnet';
  action:       'write';
  target: {
    // Modbus:
    register?:  number;
    value?:     number | boolean;
    // BACnet:
    objectType?:     string;
    objectInstance?: number;
    property?:       string;
  };
  requested_by: string;       // user_id de quem solicitou
  approved_by:  string;       // user_id do CCO que aprovou
}
```

---

## Reconexão MQTT com backoff exponencial

```typescript
// gateway-mqtt.client.ts
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS  = 60_000;
let   reconnectAttempts = 0;

client.on('close', async () => {
  const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, reconnectAttempts), BACKOFF_MAX_MS);
  reconnectAttempts++;
  setTimeout(() => client.reconnect(), delay);
});

client.on('connect', () => {
  reconnectAttempts = 0;
  storeForwardService.flush(); // reenviar mensagens em buffer
});
```

---

## Variáveis de ambiente obrigatórias

```bash
GATEWAY_ID=gw-cliente-abc-01        # ID único do gateway
TENANT_ID=cliente-abc               # tenant ao qual pertence
MQTT_BROKER_URL=mqtts://broker.bluebee.io:8883
MQTT_CLIENT_ID=gateway-cliente-abc-01
MQTT_USERNAME=gw-cliente-abc
MQTT_PASSWORD=senha-segura
MQTT_CA_CERT_PATH=./certs/ca.crt
SQLITE_DB_PATH=./data/buffer.db
HEARTBEAT_INTERVAL_MS=30000
```

---

## Ambiente de Teste Local — Docker Compose (Windows)

Para testar a comunicação com dispositivos de campo **antes** de ter o gateway NestJS pronto, use EMQX (broker MQTT) + Node-RED (bridge BACnet/Modbus → MQTT) via Docker Desktop.

### Pré-requisitos
- Docker Desktop instalado no Windows
- MPC46D acessível na rede local (IP padrão: `10.1.1.240`)

### docker-compose.yml

```yaml
version: '3.8'

services:
  emqx:
    image: emqx/emqx:5.8.3
    container_name: bluebee-emqx
    ports:
      - "1883:1883"    # MQTT (sem TLS — apenas para testes locais)
      - "8083:8083"    # MQTT sobre WebSocket
      - "18083:18083"  # Dashboard web (admin:public)
    environment:
      - EMQX_NODE_NAME=emqx@127.0.0.1
      - EMQX_DASHBOARD__DEFAULT_PASSWORD=bluebee123
    volumes:
      - emqx_data:/opt/emqx/data
      - emqx_log:/opt/emqx/log
    restart: unless-stopped
    networks:
      - bluebee-test

  nodered:
    image: nodered/node-red:4.0.9
    container_name: bluebee-nodered
    ports:
      - "1880:1880"    # Interface web do Node-RED
    environment:
      - TZ=America/Sao_Paulo
    volumes:
      - nodered_data:/data
    restart: unless-stopped
    networks:
      - bluebee-test
    extra_hosts:
      - "host.docker.internal:host-gateway"  # acessa a rede local do host

volumes:
  emqx_data:
  emqx_log:
  nodered_data:

networks:
  bluebee-test:
    driver: bridge
```

### Comandos

```bash
# Subir o ambiente
docker compose up -d

# Verificar status
docker compose ps

# Ver logs do EMQX
docker compose logs -f emqx

# Ver logs do Node-RED
docker compose logs -f nodered

# Derrubar o ambiente
docker compose down
```

### Acessos após subir

| Serviço | URL | Credenciais |
|---------|-----|-------------|
| EMQX Dashboard | http://localhost:18083 | admin / bluebee123 |
| Node-RED | http://localhost:1880 | - (sem auth por padrão) |
| MQTT Broker | localhost:1883 | - (sem auth para testes) |

---

## Node-RED — Instalação de paletas necessárias

Após abrir o Node-RED (`http://localhost:1880`), instalar via **Menu → Manage palette → Install**:

| Paleta | Função |
|--------|--------|
| `node-red-contrib-bacnet` | Leitura de objetos BACnet/IP |
| `node-red-contrib-modbus` | Leitura de registradores Modbus TCP |
| `node-red-contrib-mqtt-broker` | (já incluído no Node-RED base) |

Ou via terminal Docker:
```bash
docker exec -it bluebee-nodered npm install \
  node-red-contrib-bacnet \
  node-red-contrib-modbus
# Reiniciar o container após instalar
docker restart bluebee-nodered
```

---

## Node-RED — Fluxo BACnet MPC46D → EMQX

### Estrutura do fluxo

```
[Inject 10s] → [BACnet ReadProperty] → [Function: formatar payload] → [MQTT Out]
```

### Configuração do nó BACnet ReadProperty

```json
{
  "type": "BACnet-read",
  "deviceIp": "10.1.1.240",
  "devicePort": 47808,
  "objectType": 0,
  "objectInstance": 0,
  "property": 85,
  "name": "Ler NTC_01"
}
```

### Function node — formatar payload BlueBee

```javascript
// Formatar leitura BACnet para o padrão de telemetria BlueBee
const tenantId = 'tenant-teste';
const deviceId = 'mpc46d-01';

const point = {
  tag: 'NTC_01',
  value: msg.payload,           // valor lido pelo BACnet node
  unit: '°C',
  quality: 'good',
  statusFlags: {
    inAlarm: false,
    fault: false,
    overridden: false,
    outOfService: false,
  },
};

msg.topic = `bluebee/${tenantId}/devices/${deviceId}/telemetry`;
msg.payload = JSON.stringify({
  device_id:  deviceId,
  tenant_id:  tenantId,
  timestamp:  new Date().toISOString(),
  protocol:   'bacnet',
  points: [point],
});

return msg;
```

### Configuração do nó MQTT Out

```json
{
  "type": "mqtt out",
  "broker": "localhost",
  "port": 1883,
  "topic": "",        // tópico vem do msg.topic da Function
  "qos": "0",
  "retain": false
}
```

---

## Node-RED — Fluxo Modbus MPC46D → EMQX

### Estrutura do fluxo — leitura de NTCs

```
[Inject 10s] → [Modbus Read] → [Function: converter float32] → [Function: payload BlueBee] → [MQTT Out]
```

### Configuração do nó Modbus Read

```json
{
  "type": "modbus-read",
  "dataType": "HoldingRegister",
  "adr": 100,         // endereço 20100 - 20000 = 100
  "quantity": 3,      // 2 words float + 1 word status
  "server": {
    "host": "10.1.1.240",
    "port": 502,
    "unitId": 1
  },
  "name": "Ler NTC_01 Modbus"
}
```

### Function node — converter float32 do MPC46D

```javascript
// msg.payload.data = [word1, word2, statusWord]
const data = msg.payload.data;

// Montar float32 a partir de 2 words big-endian
const buf = Buffer.alloc(4);
buf.writeUInt16BE(data[0], 0);  // high word
buf.writeUInt16BE(data[1], 2);  // low word
const temperature = buf.readFloatBE(0);
const statusOk = data[2] === 0;

msg.parsed = {
  tag: 'NTC_01',
  value: parseFloat(temperature.toFixed(2)),
  unit: '°C',
  quality: statusOk ? 'good' : 'bad_device_failure',
};

return msg;
```

### Function node — payload BlueBee Modbus

```javascript
const tenantId = 'tenant-teste';
const deviceId = 'mpc46d-01';

msg.topic = `bluebee/${tenantId}/devices/${deviceId}/telemetry`;
msg.payload = JSON.stringify({
  device_id:  deviceId,
  tenant_id:  tenantId,
  timestamp:  new Date().toISOString(),
  protocol:   'modbus',
  points: [msg.parsed],
});

return msg;
```

---

## Node-RED — Fluxo multi-ponto (leitura em batch)

Para publicar todas as 26 DIs e todos os NTCs em uma única mensagem:

```javascript
// Function node — processar leitura em batch de DIs (FC03, 26 regs a partir de addr 0)
// msg.payload.data = array com 26 words [DI_01...DI_26]

const tenantId = 'tenant-teste';
const deviceId = 'mpc46d-01';

const points = msg.payload.data.map((word, i) => ({
  tag:     `DI_${String(i + 1).padStart(2, '0')}`,
  value:   word === 1,
  unit:    null,
  quality: 'good',
}));

msg.topic = `bluebee/${tenantId}/devices/${deviceId}/telemetry`;
msg.payload = JSON.stringify({
  device_id:  deviceId,
  tenant_id:  tenantId,
  timestamp:  new Date().toISOString(),
  protocol:   'modbus',
  points,
});

return msg;
```

---

## Verificar dados chegando no EMQX

```bash
# Assinar todos os tópicos de telemetria (usando mosquitto_sub via Docker)
docker run --rm --network host eclipse-mosquitto \
  mosquitto_sub -h localhost -p 1883 -t "bluebee/+/devices/+/telemetry" -v

# Ou usar o EMQX Dashboard:
# http://localhost:18083 → Diagnose → WebSocket Client → Subscribe
```

---

## Arquitetura de testes vs produção

```
TESTE LOCAL (agora)
─────────────────────────────────────────────────────
MPC46D ──BACnet/IP──▶ Node-RED (Docker) ──MQTT──▶ EMQX (Docker) ──▶ Backend BlueBee

PRODUÇÃO (Fase 2)
─────────────────────────────────────────────────────
MPC46D ──BACnet/IP──▶ apps/gateway/ (NestJS) ──MQTT TLS──▶ EMQX Cloud ──▶ Backend BlueBee
```

O fluxo Node-RED serve como **prova de conceito** e validação dos payloads. Quando o gateway NestJS estiver pronto, substitui o Node-RED com o mesmo formato de payload.
