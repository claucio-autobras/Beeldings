---
name: modbus-mapping
description: Mapeamento de registradores Modbus para tags do BlueBee IoT, incluindo tipos de registrador, function codes, endereçamento, conversão, escala, unidades, signed/unsigned, endianness e convenções BMS. Inclui mapa completo do controlador MPC46D (Mercato, base 20.000). Use quando Codex precisar modelar, implementar ou revisar integrações Modbus TCP/RTU, mapas de pontos, drivers, schemas ou normalização de telemetria.
---

# Modbus Mapping

## Visão geral do protocolo Modbus

Modbus é um protocolo de comunicação serial definido pela ANSI (camada 7 OSI). Segue modelo request/reply cliente-servidor:
- **Client** (mestre): inicia requests
- **Server** (escravo): responde com dados ou executa comandos
- Endianness: **Big-Endian** (byte mais significativo primeiro)
- PDU máximo: 253 bytes
- ADU TCP: MBAP Header (7 bytes) + PDU

### Variantes

| Variante | Camada física | Porta | Uso típico |
|----------|---------------|-------|------------|
| Modbus TCP | Ethernet | 502 | Controladores modernos, gateways |
| Modbus RTU | RS-485/RS-232 | - | Equipamentos legados |
| Modbus ASCII | RS-485/RS-232 | - | Sistemas mais antigos |

### MBAP Header (Modbus TCP)

```
Byte 0-1: Transaction Identifier  — correlaciona request/response
Byte 2-3: Protocol Identifier     — sempre 0x0000 para Modbus
Byte 4-5: Length                  — número de bytes seguintes
Byte 6:   Unit Identifier         — ID do escravo (1–247; 255 = broadcast)
Byte 7+:  PDU (Function Code + Data)
```

---

## Tipos de registrador

| Tipo | Prefixo | Endereço | Acesso | Uso típico em BMS |
|------|---------|----------|--------|-------------------|
| Coil (0x) | 0 | 1–9999 | R/W | Status digital — liga/desliga |
| Discrete Input (1x) | 1 | 10001–19999 | R | Entrada digital — status de sensor |
| Input Register (3x) | 3 | 30001–39999 | R | Medição analógica — temperatura, pressão |
| Holding Register (4x) | 4 | 40001–49999 | R/W | Configuração e medição — setpoints, leituras |

---

## Function Codes (FC)

### Leitura

| FC | Nome | Registrador | Múltiplo? | Max por request |
|----|------|-------------|-----------|-----------------|
| 01 (0x01) | Read Coils | Coils (0x) | Sim | 2000 coils |
| 02 (0x02) | Read Discrete Inputs | Discrete Inputs (1x) | Sim | 2000 inputs |
| 03 (0x03) | Read Holding Registers | Holding Registers (4x) | Sim | 125 registers |
| 04 (0x04) | Read Input Registers | Input Registers (3x) | Sim | 125 registers |

### Escrita

| FC | Nome | Registrador | Múltiplo? |
|----|------|-------------|-----------|
| 05 (0x05) | Write Single Coil | Coil (0x) | Não |
| 06 (0x06) | Write Single Register | Holding Register (4x) | Não |
| 15 (0x0F) | Write Multiple Coils | Coils (0x) | Sim |
| 16 (0x10) | Write Multiple Registers | Holding Registers (4x) | Sim |

### Leitura + Escrita

| FC | Nome | Uso |
|----|------|-----|
| 23 (0x17) | Read/Write Multiple Registers | Otimização: ler e escrever em uma transação |

### Diagnóstico

| FC | Nome | Sub-function |
|----|------|--------------|
| 07 (0x07) | Read Exception Status | Status interno de 8 bits |
| 08 (0x08) | Diagnostics | Vários sub-codes |

---

## Estrutura PDU — exemplos

### FC03 Read Holding Registers (request)
```
01 03 00 00 00 0A ...
^^    ^^^^^ ^^^^^
|     |     Quantidade de registradores (10)
|     Endereço inicial (base 0 = registrador 40001)
Function Code (03)
```

### FC03 Read Holding Registers (response)
```
01 03 14 00 00 01 2C ...
^^    ^^ ^^^^^^^^^
|     |  Dados (20 bytes = 10 registradores × 2 bytes each)
|     Byte Count (20 = 0x14)
Function Code (03)
```

### FC05 Write Single Coil (request)
```
01 05 00 05 FF 00
^^    ^^^^^ ^^^^^
|     |     Valor: FF 00 = ON, 00 00 = OFF
|     Endereço do coil (base 0 = coil 6)
Function Code (05)
```

---

## Códigos de exceção

| Código | Nome | Causa |
|--------|------|-------|
| 0x01 | Illegal Function | FC não suportado pelo servidor |
| 0x02 | Illegal Data Address | Endereço fora do range do servidor |
| 0x03 | Illegal Data Value | Valor inválido para o registrador |
| 0x04 | Server Device Failure | Erro interno no servidor |
| 0x05 | Acknowledge | Server iniciou processamento longo (aguardar) |
| 0x06 | Server Device Busy | Servidor ocupado, tentar novamente |
| 0x08 | Memory Parity Error | Erro de paridade na memória do servidor |
| 0x0A | Gateway Path Unavailable | Gateway sem rota para o dispositivo |
| 0x0B | Gateway Target Device Failed | Dispositivo não respondeu ao gateway |

```typescript
// Detectar resposta de exceção: bit 7 do Function Code setado
function isExceptionResponse(fc: number, responseFc: number): boolean {
  return responseFc === (fc | 0x80);
}
// Ex: request FC=0x03, response FC=0x83 → exceção
```

---

## Tipos de dado e conversão

```typescript
// uint16 — registrador de 16 bits sem sinal (0–65535)
const raw = buffer.readUInt16BE(0);

// Com escala (ex: temperatura × 10 → raw 72 = 7.2°C)
const value = raw * scale;  // scale = 0.1

// int16 — registrador de 16 bits com sinal (-32768 a 32767)
const raw = buffer.readInt16BE(0);

// float32 — IEEE 754, ocupa 2 registradores consecutivos (big-endian word order)
const raw1 = buffer.readUInt16BE(0);  // high word
const raw2 = buffer.readUInt16BE(2);  // low word
const buf = Buffer.alloc(4);
buf.writeUInt16BE(raw1, 0);
buf.writeUInt16BE(raw2, 2);
const value = buf.readFloatBE(0);

// float32 — little-endian word order (alguns equipamentos invertem as words)
const buf = Buffer.alloc(4);
buf.writeUInt16BE(raw2, 0);  // low word primeiro
buf.writeUInt16BE(raw1, 2);  // high word depois
const value = buf.readFloatBE(0);

// coil / discrete (boolean)
const value = buffer[0] === 1;  // ou buffer[0] !== 0

// WORD (16-bit integer — padrão MPC46D para DI e DO)
const value = buffer.readUInt16BE(0);  // 0 = inativo, 1 = ativo
```

---

## Configuração de ponto (padrão do projeto BlueBee)

```typescript
interface ModbusPoint {
  tag:        string;           // identificador amigável (ex: 'NTC_01', 'DO_05')
  register:   number;          // número do registrador com prefixo (ex: 20100)
  type:       'holding' | 'input' | 'coil' | 'discrete';
  dataType:   'uint16' | 'int16' | 'float32' | 'boolean' | 'word';
  unit:       string | null;
  scale:      number;          // fator de escala aplicado após leitura (padrão: 1)
  offset:     number;          // offset adicionado após escala (padrão: 0)
  wordOrder:  'big' | 'little'; // ordem das words para float32 (padrão: 'big')
  // formula: value = (raw * scale) + offset
  writable:   boolean;         // se pode ser escrito (coils e holding R/W)
}
```

---

## Endereçamento na lib modbus-serial (Node.js)

```typescript
// modbus-serial usa endereçamento base-0 internamente
// Registrador 40001 → endereço 0 na lib
// Registrador 40010 → endereço 9 na lib
// Registrador 20000 → endereço 0 na lib (holding, pois está na faixa 4x do MPC46D)

function toModbusAddress(register: number): number {
  if (register >= 40001) return register - 40001;  // holding padrão
  if (register >= 30001) return register - 30001;  // input
  if (register >= 20000) return register - 20000;  // holding MPC46D (base 20.000)
  if (register >= 10001) return register - 10001;  // discrete
  return register - 1;                              // coil
}

// Exemplo: NTC_01.VAL no MPC46D = endereço 20100 → toModbusAddress(20100) = 100
```

---

## MPC46D (Mercato) — Mapa de Registradores Modbus (Tabela 5)

**Configuração do dispositivo:**
- IP padrão: `10.1.1.240`
- Porta Modbus TCP: `502`
- Acesso web: `http://10.1.1.240` (user: `config` / pass: `config`)
- Base address: `20.000` (todos os registradores começam em 20000)
- Todos os registradores são do tipo **Holding Register** (FC03 para leitura)

### Entradas Digitais — DI_01 a DI_26

| Tag | Endereço Modbus | Tipo | Acesso | Descrição |
|-----|-----------------|------|--------|-----------|
| DI_01 | 20000 | WORD | R | Entrada digital 1 (0=inativo, 1=ativo) |
| DI_02 | 20001 | WORD | R | Entrada digital 2 |
| DI_03 | 20002 | WORD | R | Entrada digital 3 |
| DI_04 | 20003 | WORD | R | Entrada digital 4 |
| DI_05 | 20004 | WORD | R | Entrada digital 5 |
| DI_06 | 20005 | WORD | R | Entrada digital 6 |
| DI_07 | 20006 | WORD | R | Entrada digital 7 |
| DI_08 | 20007 | WORD | R | Entrada digital 8 |
| DI_09 | 20008 | WORD | R | Entrada digital 9 |
| DI_10 | 20009 | WORD | R | Entrada digital 10 |
| DI_11 | 20010 | WORD | R | Entrada digital 11 |
| DI_12 | 20011 | WORD | R | Entrada digital 12 |
| DI_13 | 20012 | WORD | R | Entrada digital 13 |
| DI_14 | 20013 | WORD | R | Entrada digital 14 |
| DI_15 | 20014 | WORD | R | Entrada digital 15 |
| DI_16 | 20015 | WORD | R | Entrada digital 16 |
| DI_17 | 20016 | WORD | R | Entrada digital 17 |
| DI_18 | 20017 | WORD | R | Entrada digital 18 |
| DI_19 | 20018 | WORD | R | Entrada digital 19 |
| DI_20 | 20019 | WORD | R | Entrada digital 20 |
| DI_21 | 20020 | WORD | R | Entrada digital 21 |
| DI_22 | 20021 | WORD | R | Entrada digital 22 |
| DI_23 | 20022 | WORD | R | Entrada digital 23 |
| DI_24 | 20023 | WORD | R | Entrada digital 24 |
| DI_25 | 20024 | WORD | R | Entrada digital 25 |
| DI_26 | 20025 | WORD | R | Entrada digital 26 |

### Sensores NTC — NTC_01 a NTC_26

> Cada sensor ocupa 3 endereços: VAL (FLOAT = 2 words) + STAT (WORD)

| Tag | End. VAL | End. STAT | Tipo | Unidade | Descrição |
|-----|----------|-----------|------|---------|-----------|
| NTC_01 | 20100–20101 | 20102 | FLOAT | °C | Temperatura NTC 1 |
| NTC_02 | 20103–20104 | 20105 | FLOAT | °C | Temperatura NTC 2 |
| NTC_03 | 20106–20107 | 20108 | FLOAT | °C | Temperatura NTC 3 |
| NTC_04 | 20109–20110 | 20111 | FLOAT | °C | Temperatura NTC 4 |
| NTC_05 | 20112–20113 | 20114 | FLOAT | °C | Temperatura NTC 5 |
| NTC_06 | 20115–20116 | 20117 | FLOAT | °C | Temperatura NTC 6 |
| NTC_07 | 20118–20119 | 20120 | FLOAT | °C | Temperatura NTC 7 |
| NTC_08 | 20121–20122 | 20123 | FLOAT | °C | Temperatura NTC 8 |
| NTC_09 | 20124–20125 | 20126 | FLOAT | °C | Temperatura NTC 9 |
| NTC_10 | 20127–20128 | 20129 | FLOAT | °C | Temperatura NTC 10 |
| NTC_11 | 20130–20131 | 20132 | FLOAT | °C | Temperatura NTC 11 |
| NTC_12 | 20133–20134 | 20135 | FLOAT | °C | Temperatura NTC 12 |
| NTC_13 | 20136–20137 | 20138 | FLOAT | °C | Temperatura NTC 13 |
| NTC_14 | 20139–20140 | 20141 | FLOAT | °C | Temperatura NTC 14 |
| NTC_15 | 20142–20143 | 20144 | FLOAT | °C | Temperatura NTC 15 |
| NTC_16 | 20145–20146 | 20147 | FLOAT | °C | Temperatura NTC 16 |
| NTC_17 | 20148–20149 | 20150 | FLOAT | °C | Temperatura NTC 17 |
| NTC_18 | 20151–20152 | 20153 | FLOAT | °C | Temperatura NTC 18 (MCP46D) |
| NTC_19 | 20154–20155 | 20156 | FLOAT | °C | Temperatura NTC 19 (MCP46D) |
| NTC_20 | 20157–20158 | 20159 | FLOAT | °C | Temperatura NTC 20 (MCP46D) |
| NTC_21 | 20160–20161 | 20162 | FLOAT | °C | Temperatura NTC 21 (MCP46D) |
| NTC_22 | 20163–20164 | 20165 | FLOAT | °C | Temperatura NTC 22 (MCP46D) |
| NTC_23 | 20166–20167 | 20168 | FLOAT | °C | Temperatura NTC 23 (MCP46D) |
| NTC_24 | 20169–20170 | 20171 | FLOAT | °C | Temperatura NTC 24 (MCP46D) |
| NTC_25 | 20172–20173 | 20174 | FLOAT | °C | Temperatura NTC 25 (MCP46D) |
| NTC_26 | 20175–20176 | 20177 | FLOAT | °C | Temperatura NTC 26 (MCP46D) |

**STAT Word — interpretação:**
```
0 = OK (leitura válida)
1 = Erro de sensor (sensor desconectado ou fora de range)
```

### Entradas Analógicas — AI_1 a AI_8 (apenas MCP46A)

> Ocupa 3 endereços: VAL (FLOAT = 2 words) + STAT (WORD)

| Tag | End. VAL | End. STAT | Tipo | Unidade |
|-----|----------|-----------|------|---------|
| AI_1 | 20154–20155 | 20156 | FLOAT | % (0–100) |
| AI_2 | 20157–20158 | 20159 | FLOAT | % (0–100) |
| AI_3 | 20160–20161 | 20162 | FLOAT | % (0–100) |
| AI_4 | 20163–20164 | 20165 | FLOAT | % (0–100) |
| AI_5 | 20166–20167 | 20168 | FLOAT | % (0–100) |
| AI_6 | 20169–20170 | 20171 | FLOAT | % (0–100) |
| AI_7 | 20172–20173 | 20174 | FLOAT | % (0–100) |
| AI_8 | 20175–20176 | 20177 | FLOAT | % (0–100) |

### Saídas Digitais — DO_01 a DO_16

| Tag | Endereço | Tipo | Acesso | Descrição |
|-----|----------|------|--------|-----------|
| DO_01 | 20200 | WORD | R/W | Relé 1 (0=aberto, 1=fechado) |
| DO_02 | 20201 | WORD | R/W | Relé 2 |
| DO_03 | 20202 | WORD | R/W | Relé 3 |
| DO_04 | 20203 | WORD | R/W | Relé 4 |
| DO_05 | 20204 | WORD | R/W | Relé 5 |
| DO_06 | 20205 | WORD | R/W | Relé 6 |
| DO_07 | 20206 | WORD | R/W | Relé 7 |
| DO_08 | 20207 | WORD | R/W | Relé 8 |
| DO_09 | 20208 | WORD | R/W | Relé 9 |
| DO_10 | 20209 | WORD | R/W | Relé 10 |
| DO_11 | 20210 | WORD | R/W | Relé 11 |
| DO_12 | 20211 | WORD | R/W | Relé 12 |
| DO_13 | 20212 | WORD | R/W | Relé 13 |
| DO_14 | 20213 | WORD | R/W | Relé 14 |
| DO_15 | 20214 | WORD | R/W | Relé 15 |
| DO_16 | 20215 | WORD | R/W | Relé 16 |

### Saídas Analógicas — AO_1 a AO_4

| Tag | Endereços | Tipo | Acesso | Unidade |
|-----|-----------|------|--------|---------|
| AO_1 | 20300–20301 | FLOAT | R/W | V ou mA (conf. hardware) |
| AO_2 | 20302–20303 | FLOAT | R/W | V ou mA |
| AO_3 | 20304–20305 | FLOAT | R/W | V ou mA |
| AO_4 | 20306–20307 | FLOAT | R/W | V ou mA |

### RTC — Relógio em tempo real

| Campo | Endereço | Tipo | Descrição |
|-------|----------|------|-----------|
| Dia | 20500 | WORD | 1–31 |
| Mês | 20501 | WORD | 1–12 |
| Ano | 20502 | WORD | ex: 2025 |
| Hora | 20503 | WORD | 0–23 |
| Minuto | 20504 | WORD | 0–59 |
| Segundo | 20505 | WORD | 0–59 |

---

## Como ler NTC no MPC46D (exemplo prático)

```typescript
import ModbusRTU from 'modbus-serial';

const client = new ModbusRTU();
await client.connectTCP('10.1.1.240', { port: 502 });
client.setID(1);  // Unit ID padrão

// Ler NTC_01 (endereço 20100, 2 registradores para FLOAT + 1 para STATUS)
const BASE = 20000;
const NTC01_ADDR = 100;  // 20100 - 20000 = 100

const result = await client.readHoldingRegisters(NTC01_ADDR, 3);
// result.data = [word1, word2, status_word]

const buf = Buffer.alloc(4);
buf.writeUInt16BE(result.data[0], 0);  // high word
buf.writeUInt16BE(result.data[1], 2);  // low word
const temperature = buf.readFloatBE(0);
const statusOk = result.data[2] === 0;

console.log(`NTC_01: ${temperature.toFixed(1)}°C — ${statusOk ? 'OK' : 'ERRO'}`);

// Ler todas as DIs de uma vez (FC03, 26 registradores a partir de 20000)
const diResult = await client.readHoldingRegisters(0, 26);
const digitalInputs = diResult.data.map((word, i) => ({
  tag: `DI_${String(i + 1).padStart(2, '0')}`,
  value: word === 1,
}));

// Escrever em DO_01 (endereço 20200 → offset 200)
await client.writeRegister(200, 1);  // ligar relé 1
await client.writeRegister(200, 0);  // desligar relé 1
```

---

## Equipamentos comuns em BMS — mapa de referência genérico

### Chiller genérico

| Tag | Registrador | Tipo | FC | Scale | Unidade |
|-----|-------------|------|----|-------|---------|
| temp_saida | 40001–40002 | float32 | FC03 | 1.0 | °C |
| temp_retorno | 40003–40004 | float32 | FC03 | 1.0 | °C |
| pressao_condensacao | 40005–40006 | float32 | FC03 | 1.0 | bar |
| pressao_evaporacao | 40007–40008 | float32 | FC03 | 1.0 | bar |
| corrente_motor | 40009–40010 | float32 | FC03 | 1.0 | A |
| status_compressor | 1 | coil/boolean | FC01 | 1 | null |
| falha_geral | 2 | coil/boolean | FC01 | 1 | null |

### UTA/AHU genérica

| Tag | Registrador | Tipo | FC | Scale | Unidade |
|-----|-------------|------|----|-------|---------|
| temp_ar_insuflamento | 40001–40002 | float32 | FC03 | 1.0 | °C |
| temp_ar_retorno | 40003–40004 | float32 | FC03 | 1.0 | °C |
| umidade_relativa | 40005 | uint16 | FC03 | 0.1 | % |
| status_ventilador | 1 | coil/boolean | FC01 | 1 | null |
| status_valvula_agua | 2 | coil/boolean | FC01 | 1 | null |
| alarme_filtro | 3 | coil/boolean | FC01 | 1 | null |
