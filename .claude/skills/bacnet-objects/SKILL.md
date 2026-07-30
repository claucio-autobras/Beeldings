---
name: bacnet-objects
description: Tipos de objeto BACnet, propriedades, unidades, mapeamento para tags e convenções BMS usadas no BlueBee IoT. Use quando Codex precisar modelar, implementar, revisar ou documentar integrações BACnet/IP, objetos AI/AO/AV/BI/BO/BV/MSI/MSO/MSV, propriedades BACnet, normalização de valores e descoberta de pontos. Inclui mapa completo do controlador MPC46D (Mercato).
---

# Bacnet Objects

## Visão geral do protocolo BACnet

BACnet (Building Automation and Control Networks) é definido pela ASHRAE 135 / ISO 16484-5.
Funciona em camadas:

```
Aplicação  → APDU (Application PDU) — serviços, objetos, propriedades
Rede       → NPDU (Network PDU) — roteamento multi-rede
Enlace/Fís → BACnet/IP (UDP 47808), MS/TP (RS-485), BACnet/SC (WebSocket+TLS)
```

### BACnet/IP (porta UDP 47808)
- Comunicação direta via Ethernet/Wi-Fi
- Cada dispositivo tem Device Instance (0–4194302) único globalmente
- Object Identifier = (tipo << 22) | instância (32 bits)
- BBMD (BACnet Broadcast Management Device) para roteamento entre sub-redes

### BACnet MS/TP (RS-485)
- Barramento serial token-passing
- MAC address 0–127 (slaves), 0–127 (masters)
- Velocidades: 9600, 19200, 38400, 76800 bps

---

## Tipos de objeto mais comuns em BMS

| Tipo | Código | Sigla | Acesso | Uso típico |
|------|--------|-------|--------|------------|
| Analog Input | 0 | AI | R | Temperatura, pressão, umidade, corrente |
| Analog Output | 1 | AO | R/W | Setpoints, sinal de controle 0–10V |
| Analog Value | 2 | AV | R/W | Valor calculado internamente |
| Binary Input | 3 | BI | R | Status digital — ligado/desligado, falha |
| Binary Output | 4 | BO | R/W | Comando digital — ligar/desligar |
| Binary Value | 5 | BV | R/W | Flag interna do controlador |
| Multi-State Input | 13 | MSI | R | Modo de operação (auto, manual, off) |
| Multi-State Output | 14 | MSO | R/W | Seleção de modo por comando |
| Multi-State Value | 19 | MSV | R/W | Valor de estado interno |
| Device | 8 | - | R | Objeto obrigatório — identifica o dispositivo |
| Notification Class | 15 | NC | R/W | Configuração de alarmes |
| TrendLog | 20 | TL | R | Histórico de valores amostrados |
| Schedule | 17 | SCH | R/W | Agendamentos de operação |

---

## Propriedades mais lidas

```typescript
export enum BACnetProperty {
  PRESENT_VALUE      = 85,   // valor atual — MAIS USADA
  OBJECT_NAME        = 77,   // nome configurado no controlador
  DESCRIPTION        = 28,   // descrição do objeto
  UNITS              = 117,  // unidade de engenharia
  STATUS_FLAGS       = 111,  // in-alarm | fault | overridden | out-of-service
  EVENT_STATE        = 36,   // normal | fault | offnormal
  OUT_OF_SERVICE     = 81,   // objeto em modo manual
  RELIABILITY        = 103,  // no-fault-detected | no-sensor | over-range | etc.
  MIN_PRES_VALUE     = 69,   // valor mínimo (AI/AV)
  MAX_PRES_VALUE     = 65,   // valor máximo (AI/AV)
  POLARITY           = 84,   // normal | reverse (BI/BO)
  PRIORITY_ARRAY     = 87,   // 16 níveis de prioridade (AO/BO/MSO)
  RELINQUISH_DEFAULT = 104,  // valor ao liberar controle
  NOTIFICATION_CLASS = 17,   // referência à Notification Class
  EVENT_ENABLE       = 35,   // to-offnormal | to-fault | to-normal
  ACKED_TRANSITIONS  = 0,    // quais transições foram confirmadas
  HIGH_LIMIT         = 45,   // limite superior para alarme (AI)
  LOW_LIMIT          = 59,   // limite inferior para alarme (AI)
  DEADBAND           = 25,   // banda morta para alarme (AI)
  COV_INCREMENT      = 22,   // incremento mínimo para disparo de COV
}
```

---

## Status_Flags — interpretação dos bits

```typescript
// Status_Flags é um BIT_STRING de 4 bits
interface StatusFlags {
  inAlarm:      boolean;  // bit 0 — objeto em estado de alarme
  fault:        boolean;  // bit 1 — falha detectada (sensor, comunicação)
  overridden:   boolean;  // bit 2 — valor forçado manualmente
  outOfService: boolean;  // bit 3 — objeto fora de serviço (modo manual)
}

function parseStatusFlags(raw: number[]): StatusFlags {
  return {
    inAlarm:      (raw[0] & 0b1000) !== 0,
    fault:        (raw[0] & 0b0100) !== 0,
    overridden:   (raw[0] & 0b0010) !== 0,
    outOfService: (raw[0] & 0b0001) !== 0,
  };
}
```

---

## Serviços BACnet

### Serviços de Objeto (Object Access Services)

| Serviço | Direção | Uso |
|---------|---------|-----|
| ReadProperty | Client→Server | Ler uma propriedade de um objeto |
| WriteProperty | Client→Server | Escrever em uma propriedade |
| ReadPropertyMultiple | Client→Server | Ler várias propriedades de vários objetos em uma única request |
| WritePropertyMultiple | Client→Server | Escrever em várias propriedades |
| SubscribeCOV | Client→Server | Subscrever notificações de mudança de valor |
| COVNotification | Server→Client | Notificação de COV (unconfirmed) |
| ConfirmedCOVNotification | Server→Client | Notificação de COV (confirmed, aguarda ACK) |

### Serviços de Descoberta (Who-Is / I-Am)

```typescript
// Who-Is: broadcast para descobrir dispositivos na rede
// Parâmetros opcionais: lowLimit e highLimit restringem a faixa de Device Instances
client.whoIs({ lowLimit: 0, highLimit: 4194303 });

// Resposta: I-Am — cada dispositivo responde com:
interface IAmResponse {
  deviceId:         number;   // Device Instance
  maxApduLength:    number;   // tamanho máximo do APDU suportado
  segmentation:     number;   // 0=both, 1=transmit, 2=receive, 3=none
  vendorId:         number;   // código do fabricante (ASHRAE)
}
```

### ReadPropertyMultiple — uso preferido para polling eficiente

```typescript
// Ler Present_Value e Status_Flags de múltiplos objetos em uma request
const requestList = [
  {
    objectId:   { type: 0, instance: 0 },  // AI 0
    properties: [{ id: 85 }, { id: 111 }],  // PresentValue + StatusFlags
  },
  {
    objectId:   { type: 0, instance: 1 },  // AI 1
    properties: [{ id: 85 }, { id: 111 }],
  },
  {
    objectId:   { type: 3, instance: 0 },  // BI 0
    properties: [{ id: 85 }, { id: 111 }],
  },
];
```

---

## COV — Change of Value Subscription

```typescript
// COV é mais eficiente que polling para objetos que mudam por evento
// O controlador notifica ativamente quando o valor muda além de COV_Increment

interface COVSubscriptionRequest {
  subscriberProcessId: number;    // ID local para correlacionar notificações
  monitoredObjectId:   { type: number; instance: number };
  issueConfirmedNotifications: boolean;  // true = confirmed (ACK), false = unconfirmed
  lifetime:            number;    // segundos; 0 = cancelar; renovar antes de expirar
}

// COV_Increment define sensibilidade:
// Analog: notifica se valor mudar mais que X unidades (ex: 0.5°C)
// Binary: notifica em qualquer mudança de estado

// Boas práticas:
// - Usar COV para: BI (status equipamentos), BO (comandos), alarmes
// - Usar polling para: AI temperatura/pressão (valor contínuo)
// - Renovar subscriptions a cada lifetime/2 para evitar expiração
```

---

## Alarmes BACnet

```typescript
// Tipos de alarme por tipo de objeto:
// AI/AO/AV: HIGH_LIMIT, LOW_LIMIT com DEADBAND
// BI/BO/BV: CHANGE_OF_STATE (qualquer mudança)
// MSI/MSO/MSV: CHANGE_OF_VALUE (lista de estados que disparam alarme)

// Event States:
enum EventState {
  NORMAL    = 0,
  FAULT     = 1,
  OFFNORMAL = 2,
  HIGH_LIMIT = 3,
  LOW_LIMIT  = 4,
}

// Notification Class define destino do alarme:
interface NotificationClass {
  notificationClass: number;  // instância
  priority:          [number, number, number];  // [TO_OFFNORMAL, TO_FAULT, TO_NORMAL]
  ackRequired:       [boolean, boolean, boolean];
  recipientList:     Recipient[];
}

// Serviços de alarme:
// GetEventInformation — listar todos os alarmes ativos
// AcknowledgeAlarm    — reconhecer um alarme
// GetAlarmSummary     — resumo de alarmes (deprecated, preferir GetEventInformation)
```

---

## Priority Array — controle de escrita

```typescript
// Objetos de saída (AO, BO, MSO) têm Priority Array com 16 níveis
// Nível 1 = mais prioritário (Life Safety), nível 16 = menos prioritário
// RELINQUISH_DEFAULT é o valor quando todos os níveis estão NULL

// Prioridades definidas pela ASHRAE:
const PRIORITY_LEVELS = {
  1:  'Life_Safety',
  2:  'Critical_Equipment_Control',
  3:  'Minimum_On_Off',
  4:  'Manual_Life_Safety',
  5:  'CAD_Commands',
  6:  'Minimum_On_Off_2',
  7:  'Available',
  8:  'Manual_Operator',  // mais comum para comandos manuais
  9:  'Available',
  10: 'Available',
  11: 'Available',
  12: 'Available',
  13: 'Available',
  14: 'Available',
  15: 'Available',
  16: 'Available',        // mais comum para automação
};

// Para escrever em um AO com prioridade 16 (automação):
// writeProperty({ objectId: {type: 1, instance: 0}, property: 85, priority: 16, value: 22.5 })
// Para liberar (relinquish):
// writeProperty({ ..., value: null })  // escreve NULL no nível → libera controle
```

---

## Configuração de objeto (padrão do projeto BlueBee)

```typescript
interface BACnetObject {
  tag:            string;     // identificador amigável (ex: 'temp_retorno_chiller')
  objectType:     number;     // código numérico: 0=AI, 1=AO, 3=BI, 4=BO, etc.
  objectInstance: number;     // número da instância do objeto
  property:       number;     // 85=presentValue, 111=statusFlags, 36=eventState
  unit:           string | null;  // unidade de engenharia textual
  useCov:         boolean;    // true = COV subscription, false = polling
  covIncrement?:  number;     // apenas se useCov=true: sensibilidade (ex: 0.5)
  pollInterval?:  number;     // apenas se useCov=false: intervalo em ms
}
```

---

## Estratégia de leitura

```typescript
// COV (Change of Value) — para variáveis de estado/evento
// + Mais eficiente: controlador notifica proativamente
// + Latência baixa para mudanças
// - Requer renovação periódica da subscription
// Usar para: BI status equipamentos, BO, alarmes, modo de operação

// Polling — para variáveis analógicas contínuas
// + Simples, sem gestão de subscription
// - Gera tráfego constante
// Usar para: temperatura, pressão, corrente, umidade

const strategy = (obj: BACnetObject): 'cov' | 'polling' =>
  obj.useCov ? 'cov' : 'polling';
```

---

## Discovery de dispositivos

```typescript
// Who-Is broadcast — descobrir todos os dispositivos na rede
async discoverDevices(): Promise<BACnetDevice[]> {
  return new Promise((resolve) => {
    const devices: BACnetDevice[] = [];
    this.bacnet.on('iAm', (device) => {
      devices.push({
        deviceId:  device.deviceId,
        address:   device.address,
        maxApdu:   device.maxApduLength,
        vendorId:  device.vendorId,
      });
    });
    this.bacnet.whoIs();
    setTimeout(() => resolve(devices), 3000); // aguardar 3s pelas respostas
  });
}

// Read Property — ler uma propriedade específica
async readProperty(
  address:        string,    // IP do dispositivo
  objectType:     number,
  objectInstance: number,
  property:       number,
): Promise<unknown> {
  return this.bacnet.readProperty(
    address,
    { type: objectType, instance: objectInstance },
    property,
  );
}

// Read Property Multiple — leitura eficiente em batch
async readMultiple(
  address:     string,
  requestList: Array<{ objectId: { type: number; instance: number }; properties: Array<{ id: number }> }>,
): Promise<unknown> {
  return this.bacnet.readPropertyMultiple(address, requestList);
}
```

---

## Unidades de engenharia BACnet comuns

| Código | Unidade | Uso típico |
|--------|---------|------------|
| 62 | °C (degrees-celsius) | Temperatura |
| 64 | °F (degrees-fahrenheit) | Temperatura (EUA) |
| 55 | % (percent) | Umidade relativa, abertura de válvula |
| 53 | Pa (pascals) | Pressão diferencial |
| 141 | bar | Pressão |
| 84 | A (amperes) | Corrente elétrica |
| 116 | V (volts) | Tensão elétrica |
| 48 | W (watts) | Potência |
| 93 | kWh (kilowatt-hours) | Energia consumida |
| 83 | m³/h (cubic-meters-per-hour) | Vazão de fluido |
| 186 | l/s (liters-per-second) | Vazão de ar |
| 47 | Hz (hertz) | Frequência |
| 119 | rpm (revolutions-per-minute) | Rotação |
| 98 | no-units | Digital, adimensional |

---

## MPC46D (Mercato) — Mapa de Objetos BACnet (Tabela 4)

**Configuração do dispositivo:**
- IP padrão: `10.1.1.240`
- Porta BACnet/IP: UDP `47808`
- Acesso web: `http://10.1.1.240` (user: `config` / pass: `config`)
- Device Instance: configurável (0–4194302)
- APDU Timeout: 500–10000 ms (padrão 3000 ms)
- APDU Retries: 0–5 (padrão 3)

### Objetos disponíveis no MPC46D

| Tipo | Objeto | Instância | Descrição | Unidade | Acesso |
|------|--------|-----------|-----------|---------|--------|
| Device | Device | - | Objeto do dispositivo | - | R |
| NotificationClass | NC_1 | 1 | Classe de notificação de alarmes | - | R/W |
| Analog Input | NTC_01 | 0 | Sensor temperatura NTC 1 | °C | R |
| Analog Input | NTC_02 | 1 | Sensor temperatura NTC 2 | °C | R |
| Analog Input | NTC_03 | 2 | Sensor temperatura NTC 3 | °C | R |
| Analog Input | NTC_04 | 3 | Sensor temperatura NTC 4 | °C | R |
| Analog Input | NTC_05 | 4 | Sensor temperatura NTC 5 | °C | R |
| Analog Input | NTC_06 | 5 | Sensor temperatura NTC 6 | °C | R |
| Analog Input | NTC_07 | 6 | Sensor temperatura NTC 7 | °C | R |
| Analog Input | NTC_08 | 7 | Sensor temperatura NTC 8 | °C | R |
| Analog Input | NTC_09 | 8 | Sensor temperatura NTC 9 | °C | R |
| Analog Input | NTC_10 | 9 | Sensor temperatura NTC 10 | °C | R |
| Analog Input | NTC_11 | 10 | Sensor temperatura NTC 11 | °C | R |
| Analog Input | NTC_12 | 11 | Sensor temperatura NTC 12 | °C | R |
| Analog Input | NTC_13 | 12 | Sensor temperatura NTC 13 | °C | R |
| Analog Input | NTC_14 | 13 | Sensor temperatura NTC 14 | °C | R |
| Analog Input | NTC_15 | 14 | Sensor temperatura NTC 15 | °C | R |
| Analog Input | NTC_16 | 15 | Sensor temperatura NTC 16 | °C | R |
| Analog Input | NTC_17 | 16 | Sensor temperatura NTC 17 | °C | R |
| Analog Input | NTC_18 | 17 | Sensor temperatura NTC 18 | °C | R |
| Analog Input | NTC_19 | 18 | Sensor temperatura NTC 19 | °C | R |
| Analog Input | NTC_20 | 19 | Sensor temperatura NTC 20 | °C | R |
| Analog Input | NTC_21 | 20 | Sensor temperatura NTC 21 | °C | R |
| Analog Input | NTC_22 | 21 | Sensor temperatura NTC 22 | °C | R |
| Analog Input | NTC_23 | 22 | Sensor temperatura NTC 23 | °C | R |
| Analog Input | NTC_24 | 23 | Sensor temperatura NTC 24 | °C | R |
| Analog Input | NTC_25 | 24 | Sensor temperatura NTC 25 | °C | R |
| Analog Input | NTC_26 | 25 | Sensor temperatura NTC 26 | °C | R |
| Analog Output | AO_1 | 0 | Saída analógica 1 | - | R/W |
| Analog Output | AO_2 | 1 | Saída analógica 2 | - | R/W |
| Analog Output | AO_3 | 2 | Saída analógica 3 | - | R/W |
| Analog Output | AO_4 | 3 | Saída analógica 4 | - | R/W |
| Binary Input | BI_01 | 0 | Entrada digital 1 | - | R |
| Binary Input | BI_02 | 1 | Entrada digital 2 | - | R |
| Binary Input | BI_03 | 2 | Entrada digital 3 | - | R |
| Binary Input | BI_04 | 3 | Entrada digital 4 | - | R |
| Binary Input | BI_05 | 4 | Entrada digital 5 | - | R |
| Binary Input | BI_06 | 5 | Entrada digital 6 | - | R |
| Binary Input | BI_07 | 6 | Entrada digital 7 | - | R |
| Binary Input | BI_08 | 7 | Entrada digital 8 | - | R |
| Binary Input | BI_09 | 8 | Entrada digital 9 | - | R |
| Binary Input | BI_10 | 9 | Entrada digital 10 | - | R |
| Binary Input | BI_11 | 10 | Entrada digital 11 | - | R |
| Binary Input | BI_12 | 11 | Entrada digital 12 | - | R |
| Binary Input | BI_13 | 12 | Entrada digital 13 | - | R |
| Binary Input | BI_14 | 13 | Entrada digital 14 | - | R |
| Binary Input | BI_15 | 14 | Entrada digital 15 | - | R |
| Binary Input | BI_16 | 15 | Entrada digital 16 | - | R |
| Binary Input | BI_17 | 16 | Entrada digital 17 | - | R |
| Binary Input | BI_18 | 17 | Entrada digital 18 | - | R |
| Binary Input | BI_19 | 18 | Entrada digital 19 | - | R |
| Binary Input | BI_20 | 19 | Entrada digital 20 | - | R |
| Binary Input | BI_21 | 20 | Entrada digital 21 | - | R |
| Binary Input | BI_22 | 21 | Entrada digital 22 | - | R |
| Binary Input | BI_23 | 22 | Entrada digital 23 | - | R |
| Binary Input | BI_24 | 23 | Entrada digital 24 | - | R |
| Binary Input | BI_25 | 24 | Entrada digital 25 | - | R |
| Binary Input | BI_26 | 25 | Entrada digital 26 | - | R |
| Binary Output | BO_01 | 0 | Saída digital relé 1 | - | R/W |
| Binary Output | BO_02 | 1 | Saída digital relé 2 | - | R/W |
| Binary Output | BO_03 | 2 | Saída digital relé 3 | - | R/W |
| Binary Output | BO_04 | 3 | Saída digital relé 4 | - | R/W |
| Binary Output | BO_05 | 4 | Saída digital relé 5 | - | R/W |
| Binary Output | BO_06 | 5 | Saída digital relé 6 | - | R/W |
| Binary Output | BO_07 | 6 | Saída digital relé 7 | - | R/W |
| Binary Output | BO_08 | 7 | Saída digital relé 8 | - | R/W |
| Binary Output | BO_09 | 8 | Saída digital relé 9 | - | R/W |
| Binary Output | BO_10 | 9 | Saída digital relé 10 | - | R/W |
| Binary Output | BO_11 | 10 | Saída digital relé 11 | - | R/W |
| Binary Output | BO_12 | 11 | Saída digital relé 12 | - | R/W |
| Binary Output | BO_13 | 12 | Saída digital relé 13 | - | R/W |
| Binary Output | BO_14 | 13 | Saída digital relé 14 | - | R/W |
| Binary Output | BO_15 | 14 | Saída digital relé 15 | - | R/W |
| Binary Output | BO_16 | 15 | Saída digital relé 16 | - | R/W |

> **Nota MCP46A:** Versão com entradas analógicas tem objetos adicionais AI_1–AI_8 (instâncias 18–25), escala 0–100%.

---

## Payload de telemetria BACnet — padrão BlueBee

```typescript
// Tópico MQTT: bluebee/{tenantId}/devices/{deviceId}/telemetry
// Protocolo identificado como 'bacnet'

interface BACnetTelemetryPoint {
  tag:         string;   // nome amigável (ex: 'NTC_01', 'BI_05')
  objectType:  number;   // 0=AI, 3=BI, etc.
  instance:    number;   // instância do objeto
  value:       number | boolean | null;
  unit:        string | null;
  quality:     'good' | 'uncertain' | 'bad_comm_failure' | 'bad_device_failure';
  statusFlags: { inAlarm: boolean; fault: boolean; overridden: boolean; outOfService: boolean };
}

// Qualidade do dado:
// good               — leitura OK, statusFlags.fault = false
// uncertain          — valor lido mas statusFlags.overridden = true
// bad_comm_failure   — timeout de comunicação com o dispositivo
// bad_device_failure — statusFlags.fault = true
```

---

## Equipamentos comuns em BMS — mapa de referência BACnet

### Chiller com controlador BACnet

| Tag | Tipo | Instância | Escala | Unidade | COV? |
|-----|------|-----------|--------|---------|------|
| temp_saida | AI | 0 | 0.1 | °C | Não |
| temp_retorno | AI | 1 | 0.1 | °C | Não |
| pressao_condensacao | AI | 2 | 0.01 | bar | Não |
| pressao_evaporacao | AI | 3 | 0.01 | bar | Não |
| corrente_motor | AI | 4 | 0.1 | A | Não |
| status_compressor | BI | 0 | - | null | Sim |
| falha_geral | BI | 1 | - | null | Sim |
| setpoint_saida | AO | 0 | 0.1 | °C | Não |

### UTA/AHU com controlador BACnet

| Tag | Tipo | Instância | Escala | Unidade | COV? |
|-----|------|-----------|--------|---------|------|
| temp_insuflamento | AI | 0 | 0.1 | °C | Não |
| temp_retorno | AI | 1 | 0.1 | °C | Não |
| umidade_relativa | AI | 2 | 0.1 | % | Não |
| status_ventilador | BI | 0 | - | null | Sim |
| status_valvula | BI | 1 | - | null | Sim |
| alarme_filtro | BI | 2 | - | null | Sim |
| modo_operacao | MSI | 0 | - | null | Sim |
