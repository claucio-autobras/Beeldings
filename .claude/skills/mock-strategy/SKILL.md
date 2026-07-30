---
name: mock-strategy
description: Estratégia de mocks do BlueBee IoT durante a Fase 0, incluindo estrutura em apps/frontend/src/mocks, dados realistas de BMS, troca mock-API em services e simulação de tempo real. Use quando Codex precisar criar, organizar, atualizar ou substituir mocks do frontend sem acoplar componentes a dados falsos.
---

# Mock Strategy

## Princípios

1. Mocks ficam SEMPRE em `apps/frontend/src/mocks/`
2. A troca mock → API real exige alteração SOMENTE em `services/`
3. Dados mock devem ser realistas para sistemas BMS (valores condizentes com equipamentos reais)
4. Simular variação de tempo real com `setInterval` onde fizer sentido

---

## Estrutura de arquivos

```
apps/frontend/src/mocks/
├── data/
│   ├── tenants.mock.ts        # tenants, projetos e sites
│   ├── devices.mock.ts        # equipamentos BACnet e Modbus com pontos
│   ├── alarms.mock.ts         # alarmes com severidade e histórico
│   ├── telemetry.mock.ts      # séries temporais simuladas
│   ├── trends.mock.ts         # dados históricos para gráficos
│   ├── automation.mock.ts     # regras e comandos
│   └── scada.mock.ts          # configuração de telas gráficas
└── handlers/
    ├── telemetry.handler.ts   # simula polling em tempo real
    └── alarms.handler.ts      # simula chegada de alarmes
```

---

## Tipos de dispositivo

O sistema tem dois tipos de dispositivo com estruturas de pontos distintas:

- **BACnet** — pontos descobertos automaticamente via discovery ao informar IP da controladora
- **Modbus** — pontos cadastrados manualmente com campos técnicos (registrador, tipo, escala etc.)

---

## Estrutura de dados mock

### Dispositivos BACnet

```typescript
// mocks/data/devices.mock.ts

export interface BACnetPoint {
  tag: string;
  displayName: string;
  objectType: 'AI' | 'AO' | 'AV' | 'BI' | 'BO' | 'BV' | 'MSI' | 'MSO';
  objectInstance: number;
  value: number | boolean;
  unit: string | null;
  status: 'normal' | 'alarm' | 'fault' | 'offline';
  lastUpdatedAt: string;
}

export interface BACnetDevice {
  id: string;
  tenantId: string;
  siteId: string;
  name: string;
  protocol: 'bacnet';
  ipAddress: string;
  port: number;           // padrão: 47808
  deviceInstance: number; // BACnet Device Instance
  status: 'online' | 'offline' | 'connecting';
  lastSeenAt: string;
  points: BACnetPoint[];
}

export const mockBACnetDevices: BACnetDevice[] = [
  {
    id: 'bacnet-jci-fxpcg-01',
    tenantId: 'tenant-demo',
    siteId: 'site-bloco-a',
    name: 'Controladora Johnson Controls FX-PCG',
    protocol: 'bacnet',
    ipAddress: '192.168.1.100',
    port: 47808,
    deviceInstance: 1001,
    status: 'online',
    lastSeenAt: new Date().toISOString(),
    points: [
      { tag: 'temp_agua_gelada_saida',  displayName: 'Temp. Água Gelada Saída',   objectType: 'AI',  objectInstance: 1, value: 7.2,  unit: '°C',  status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'temp_agua_gelada_retorno',displayName: 'Temp. Água Gelada Retorno', objectType: 'AI',  objectInstance: 2, value: 12.8, unit: '°C',  status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'setpoint_temp',           displayName: 'Setpoint Temperatura',      objectType: 'AV',  objectInstance: 1, value: 7.0,  unit: '°C',  status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'status_bomba_primaria',   displayName: 'Status Bomba Primária',     objectType: 'BI',  objectInstance: 1, value: true, unit: null,  status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'status_valvula_bypass',   displayName: 'Status Válvula Bypass',     objectType: 'BI',  objectInstance: 2, value: false,unit: null,  status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'cmd_bomba_primaria',      displayName: 'Comando Bomba Primária',    objectType: 'BO',  objectInstance: 1, value: true, unit: null,  status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'modo_operacao',           displayName: 'Modo de Operação',          objectType: 'MSI', objectInstance: 1, value: 2,    unit: null,  status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'pressao_diferencial',     displayName: 'Pressão Diferencial',       objectType: 'AI',  objectInstance: 3, value: 2.4,  unit: 'bar', status: 'normal', lastUpdatedAt: new Date().toISOString() },
    ],
  },
  {
    id: 'bacnet-distech-ecb-01',
    tenantId: 'tenant-demo',
    siteId: 'site-bloco-b',
    name: 'Controladora Distech ECB-PTU',
    protocol: 'bacnet',
    ipAddress: '192.168.1.101',
    port: 47808,
    deviceInstance: 1002,
    status: 'online',
    lastSeenAt: new Date().toISOString(),
    points: [
      { tag: 'temp_ambiente',      displayName: 'Temperatura Ambiente',    objectType: 'AI',  objectInstance: 1, value: 23.5, unit: '°C', status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'setpoint_ambiente',  displayName: 'Setpoint Ambiente',       objectType: 'AV',  objectInstance: 1, value: 22.0, unit: '°C', status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'umidade_relativa',   displayName: 'Umidade Relativa',        objectType: 'AI',  objectInstance: 2, value: 58.0, unit: '%',  status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'status_ventilador',  displayName: 'Status Ventilador',       objectType: 'BI',  objectInstance: 1, value: false,unit: null, status: 'alarm',  lastUpdatedAt: new Date().toISOString() },
      { tag: 'status_valvula_agua',displayName: 'Status Válvula Água Fria',objectType: 'BI',  objectInstance: 2, value: true, unit: null, status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'modo_operacao_vav',  displayName: 'Modo Operação VAV',       objectType: 'MSI', objectInstance: 1, value: 1,    unit: null, status: 'normal', lastUpdatedAt: new Date().toISOString() },
    ],
  },
];
```

### Dispositivos Modbus

```typescript
export interface ModbusPoint {
  tag: string;
  displayName: string;
  register: number;
  registerType: 'holding' | 'input' | 'coil' | 'discrete';
  dataType: 'uint16' | 'int16' | 'float32' | 'boolean';
  scale: number;
  offset: number;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  value: number | boolean;
  status: 'normal' | 'alarm' | 'fault' | 'offline';
  lastUpdatedAt: string;
}

export interface ModbusDevice {
  id: string;
  tenantId: string;
  siteId: string;
  name: string;
  equipmentType: 'multimedidor' | 'gerador' | 'chiller' | 'bomba' | 'ventilador' | 'outro';
  protocol: 'modbus';
  ipAddress: string;
  port: number;           // padrão: 502
  unitId: number;         // padrão: 1
  pollingIntervalMinutes: number;
  status: 'online' | 'offline' | 'connecting';
  lastSeenAt: string;
  points: ModbusPoint[];
}

export const mockModbusDevices: ModbusDevice[] = [
  {
    id: 'modbus-powerlogic-01',
    tenantId: 'tenant-demo',
    siteId: 'site-bloco-a',
    name: 'Multimedidor PowerLogic PM5560',
    equipmentType: 'multimedidor',
    protocol: 'modbus',
    ipAddress: '192.168.1.110',
    port: 502,
    unitId: 1,
    pollingIntervalMinutes: 1,
    status: 'online',
    lastSeenAt: new Date().toISOString(),
    points: [
      { tag: 'tensao_fase_a',     displayName: 'Tensão Fase A',      register: 40001, registerType: 'holding', dataType: 'float32', scale: 0.1,  offset: 0, unit: 'V',   minValue: 198, maxValue: 242, value: 220.3, status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'corrente_fase_a',   displayName: 'Corrente Fase A',    register: 40003, registerType: 'holding', dataType: 'float32', scale: 0.01, offset: 0, unit: 'A',   minValue: 0,   maxValue: 100, value: 42.7,  status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'potencia_ativa',    displayName: 'Potência Ativa',     register: 40005, registerType: 'holding', dataType: 'float32', scale: 1,    offset: 0, unit: 'kW',  minValue: 0,   maxValue: 500, value: 28.4,  status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'fator_potencia',    displayName: 'Fator de Potência',  register: 40007, registerType: 'holding', dataType: 'float32', scale: 0.01, offset: 0, unit: null,  minValue: 0.8, maxValue: 1.0, value: 0.92,  status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'frequencia',        displayName: 'Frequência',         register: 40009, registerType: 'holding', dataType: 'float32', scale: 0.01, offset: 0, unit: 'Hz',  minValue: 59,  maxValue: 61,  value: 60.0,  status: 'normal', lastUpdatedAt: new Date().toISOString() },
      { tag: 'energia_acumulada', displayName: 'Energia Acumulada',  register: 40011, registerType: 'holding', dataType: 'float32', scale: 1,    offset: 0, unit: 'kWh', minValue: null,maxValue: null,value: 1842.6,status: 'normal', lastUpdatedAt: new Date().toISOString() },
    ],
  },
  {
    id: 'modbus-cummins-gen-01',
    tenantId: 'tenant-demo',
    siteId: 'site-bloco-a',
    name: 'Gerador Cummins C150D5',
    equipmentType: 'gerador',
    protocol: 'modbus',
    ipAddress: '192.168.1.111',
    port: 502,
    unitId: 1,
    pollingIntervalMinutes: 1,
    status: 'offline',
    lastSeenAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    points: [
      { tag: 'status_gerador',    displayName: 'Status Gerador',      register: 1,     registerType: 'coil',    dataType: 'boolean', scale: 1,    offset: 0, unit: null,  minValue: null,maxValue: null,value: false, status: 'offline', lastUpdatedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString() },
      { tag: 'tensao_saida',      displayName: 'Tensão de Saída',     register: 40001, registerType: 'holding', dataType: 'float32', scale: 0.1,  offset: 0, unit: 'V',   minValue: 198, maxValue: 242, value: 0,     status: 'offline', lastUpdatedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString() },
      { tag: 'corrente_saida',    displayName: 'Corrente de Saída',   register: 40003, registerType: 'holding', dataType: 'float32', scale: 0.1,  offset: 0, unit: 'A',   minValue: 0,   maxValue: 200, value: 0,     status: 'offline', lastUpdatedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString() },
      { tag: 'rpm_motor',         displayName: 'RPM do Motor',        register: 40005, registerType: 'holding', dataType: 'uint16',  scale: 1,    offset: 0, unit: 'RPM', minValue: 1780,maxValue: 1820,value: 0,     status: 'offline', lastUpdatedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString() },
      { tag: 'temp_motor',        displayName: 'Temperatura do Motor',register: 40007, registerType: 'holding', dataType: 'float32', scale: 0.1,  offset: 0, unit: '°C',  minValue: 0,   maxValue: 120, value: 0,     status: 'offline', lastUpdatedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString() },
    ],
  },
];

// Export unificado para uso nos componentes
export const mockDevices = [...mockBACnetDevices, ...mockModbusDevices];
```

---

## Mock de discovery BACnet

Simula o retorno de pontos quando o usuário clica em "Testar Conexão e Carregar Pontos":

```typescript
// mocks/handlers/bacnet-discovery.handler.ts

export async function mockBACnetDiscovery(ipAddress: string): Promise<BACnetPoint[]> {
  // Simula delay de conexão
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Retorna pontos simulados baseados no IP
  return [
    { tag: 'temp_agua_gelada_saida',   displayName: 'Temp. Água Gelada Saída',   objectType: 'AI',  objectInstance: 1, value: 7.2,  unit: '°C',  status: 'normal', lastUpdatedAt: new Date().toISOString() },
    { tag: 'temp_agua_gelada_retorno', displayName: 'Temp. Água Gelada Retorno', objectType: 'AI',  objectInstance: 2, value: 12.8, unit: '°C',  status: 'normal', lastUpdatedAt: new Date().toISOString() },
    { tag: 'setpoint_temp',            displayName: 'Setpoint Temperatura',      objectType: 'AV',  objectInstance: 1, value: 7.0,  unit: '°C',  status: 'normal', lastUpdatedAt: new Date().toISOString() },
    { tag: 'status_bomba_primaria',    displayName: 'Status Bomba Primária',     objectType: 'BI',  objectInstance: 1, value: true, unit: null,  status: 'normal', lastUpdatedAt: new Date().toISOString() },
    { tag: 'cmd_bomba_primaria',       displayName: 'Comando Bomba Primária',    objectType: 'BO',  objectInstance: 1, value: true, unit: null,  status: 'normal', lastUpdatedAt: new Date().toISOString() },
    { tag: 'modo_operacao',            displayName: 'Modo de Operação',          objectType: 'MSI', objectInstance: 1, value: 2,    unit: null,  status: 'normal', lastUpdatedAt: new Date().toISOString() },
  ];
}
```

---

## Simulação de tempo real

```typescript
// mocks/handlers/telemetry.handler.ts

export function simulateRealtimeTelemetry(
  baseValue: number,
  variance: number,
  callback: (value: number) => void,
  intervalMs = 5_000,
): () => void {
  const id = setInterval(() => {
    const noise = (Math.random() - 0.5) * variance;
    callback(parseFloat((baseValue + noise).toFixed(2)));
  }, intervalMs);

  return () => clearInterval(id);
}

// Uso em componente React:
useEffect(() => {
  const cleanup = simulateRealtimeTelemetry(7.2, 0.8, (value) => {
    setTempSaida(value);
  });
  return cleanup;
}, []);
```

---

## Geração de série temporal histórica

```typescript
// mocks/data/trends.mock.ts

export function generateTrendData(
  hours: number,
  baseValue: number,
  variance: number,
  intervalMinutes = 5,
): TrendPoint[] {
  const points: TrendPoint[] = [];
  const now = Date.now();
  const totalPoints = (hours * 60) / intervalMinutes;

  for (let i = totalPoints; i >= 0; i--) {
    const timestamp = new Date(now - i * intervalMinutes * 60 * 1000).toISOString();
    const noise = (Math.random() - 0.5) * variance;
    points.push({
      timestamp,
      value: parseFloat((baseValue + noise).toFixed(2)),
    });
  }
  return points;
}

export const chillerTempTrend = generateTrendData(24, 7.2, 2.0);
```

---

## Alarmes mock

```typescript
// mocks/data/alarms.mock.ts
// Modelo BINÁRIO: status é 'active', 'acknowledged' ou 'normalized'
// Não existe severidade — todo alarme é tratado igualmente

export const mockAlarms = [
  {
    id: 'alm-001',
    tenantId: 'tenant-demo',
    deviceId: 'bacnet-distech-ecb-01',
    deviceName: 'Controladora Distech ECB-PTU',
    tag: 'status_ventilador',
    status: 'active',               // ativo, sem reconhecimento
    message: 'Falha no ventilador da UTA — Pavimento 5',
    valueAtTrigger: 0,
    triggeredAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
    normalizedAt: null,
  },
  {
    id: 'alm-002',
    tenantId: 'tenant-demo',
    deviceId: 'modbus-powerlogic-01',
    deviceName: 'Multimedidor PowerLogic PM5560',
    tag: 'corrente_fase_a',
    status: 'acknowledged',         // reconhecido pela equipe
    message: 'Corrente Fase A acima do limite (42.7A)',
    valueAtTrigger: 42.7,
    triggeredAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
    acknowledgedBy: 'joao.silva',
    acknowledgedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    note: 'Monitorando — possível necessidade de manutenção preventiva',
    normalizedAt: null,
  },
  {
    id: 'alm-003',
    tenantId: 'tenant-demo',
    deviceId: 'modbus-cummins-gen-01',
    deviceName: 'Gerador Cummins C150D5',
    tag: 'status_gerador',
    status: 'active',               // ativo, sem reconhecimento
    message: 'Gerador offline — sem comunicação',
    valueAtTrigger: 0,
    triggeredAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
    normalizedAt: null,
  },
  {
    id: 'alm-004',
    tenantId: 'tenant-demo',
    deviceId: 'bacnet-jci-fxpcg-01',
    deviceName: 'Controladora Johnson Controls FX-PCG',
    tag: 'pressao_diferencial',
    status: 'normalized',           // ponto voltou ao normal
    message: 'Pressão diferencial abaixo do mínimo',
    valueAtTrigger: 0.8,
    triggeredAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
    acknowledgedBy: 'maria.tech',
    acknowledgedAt: new Date(Date.now() - 100 * 60 * 1000).toISOString(),
    note: 'Verificado in loco — filtro trocado',
    normalizedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
  },
];
```

---

## Variável de ambiente

```bash
# .env.development — usar mock
NEXT_PUBLIC_USE_MOCK=true

# .env.production — usar API real
NEXT_PUBLIC_USE_MOCK=false
```

