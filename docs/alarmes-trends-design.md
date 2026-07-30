# Design — Alarmes & Trends (BlueBee)

> Base para implementação. Modelo **por-ponto** (estilo EBO): cada ponto de
> controladora pode ter um **Alarme** e/ou uma **Trend**.
> Ordem de implementação: **Trends primeiro, Alarmes depois**.
> ⚠️ Requer **migração de banco** (novas tabelas) — só aplicar com autorização.

---

## 1. Princípios

- **Por-ponto**: Alarme e Trend são configurações sobre um `DevicePoint`.
- **Config × ocorrência**: separar a *regra* (config) do *evento* (ocorrência).
- **Backbone único**: ambos consomem o mesmo stream de telemetria que já chega
  no backend (`bluebee/+/gateway/+/telemetry` → `BacnetMqttSubscriber`).
- **Motor portável**: a lógica de avaliação de alarme é uma peça **pura**
  (entra valor → sai transição de estado), sem dependência de banco/HTTP, para
  poder migrar para o gateway (edge) no futuro sem reescrever.
- **Persistência seletiva**: histórico só existe para pontos com **Trend
  configurada**. Telemetria "ao vivo" continua só via Socket.IO (não persiste).

---

## 2. Decisões (fechadas)

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | Severidade | **3 níveis**: `LOW / MEDIUM / HIGH` (substitui as 5 do schema e o binário do front) |
| 2 | Onde avaliar alarme | **Backend**, event-driven na ingestão da telemetria; evaluator **puro/portável** p/ futuro edge |
| 3 | Escalonamento + Infraspeak | **Deferido** (Fase 3+) — fora do MVP |
| 4 | Condição analógica | `GT, LT, GTE, LTE, BETWEEN, OUTSIDE`. `BETWEEN` = dispara **dentro** de [low, high]; `OUTSIDE` = dispara **fora** (caso clássico de BMS) |
| 5 | Coleta de trend | **Backend grava do stream** (gateway segue burro publicando telemetria) |
| 6 | `quality` (good/bad/unavailable) | Campo já existe no modelo; **Fase 1 grava `GOOD`**. `UNAVAILABLE` depende do gateway reportar falha (Fase 3) |
| 7 | Persistir só pontos trended | **Sim** (opt-in, modelo EBO) |
| 8 | Scheduler | **`@nestjs/schedule` (cron)** p/ retenção; timers in-process p/ delay/histerese. **Não precisa de Redis/BullMQ no MVP** |

**Derivação digital × analógico** (sem novo campo no schema): BACnet `objectType`
0/1/2 (AI/AO/AV) = **analógico**; 3/4/5/13/14/19 (BI/BO/BV/MSx) = **digital**.
Modbus: derivar de `dataType` quando disponível, senão tratar como analógico.
Valor sempre persistido como `Float` (digital = 0.0/1.0); o tipo do ponto dita a
renderização (linha vs degrau).

---

## 3. Modelo de dados (Prisma — migração a autorizar)

```prisma
// ─── Alarmes ───────────────────────────────────────────────
enum AlarmType        { STATE_CHANGE  VALUE_RANGE }
enum AlarmSeverity    { LOW  MEDIUM  HIGH }
enum AlarmCondition   { GT  LT  GTE  LTE  BETWEEN  OUTSIDE }
enum AlarmEventState  { ACTIVE  ACTIVE_ACK  NORMALIZED_UNACK  NORMALIZED_ACK }

model AlarmRule {
  id              String         @id @default(uuid())
  tenantId        String         @map("tenant_id")
  pointId         String         @map("point_id")
  point           DevicePoint    @relation(fields: [pointId], references: [id], onDelete: Cascade)
  name            String
  message         String
  type            AlarmType
  severity        AlarmSeverity
  enabled         Boolean        @default(true)
  // STATE_CHANGE (digital)
  activationState Boolean?       @map("activation_state")   // dispara quando o ponto == este estado
  // VALUE_RANGE (analógico)
  condition       AlarmCondition?
  limitValue      Float?         @map("limit_value")        // p/ GT/LT/GTE/LTE
  limitLow        Float?         @map("limit_low")          // p/ BETWEEN/OUTSIDE
  limitHigh       Float?         @map("limit_high")
  hysteresis      Float          @default(0)
  delaySeconds    Int            @default(0) @map("delay_seconds")
  createdAt       DateTime       @default(now()) @map("created_at")
  updatedAt       DateTime       @updatedAt @map("updated_at")
  events          AlarmEvent[]
  @@index([tenantId])
  @@index([pointId])
  @@map("alarm_rules")
}

model AlarmEvent {
  id              String          @id @default(uuid())
  alarmRuleId     String          @map("alarm_rule_id")
  alarmRule       AlarmRule       @relation(fields: [alarmRuleId], references: [id], onDelete: Cascade)
  tenantId        String          @map("tenant_id")
  state           AlarmEventState @default(ACTIVE)
  valueAtTrigger  Float?          @map("value_at_trigger")
  activatedAt     DateTime        @map("activated_at")
  normalizedAt    DateTime?       @map("normalized_at")
  acknowledgedAt  DateTime?       @map("acknowledged_at")
  acknowledgedBy  String?         @map("acknowledged_by")   // userId
  createdAt       DateTime        @default(now()) @map("created_at")
  @@index([tenantId, activatedAt(sort: Desc)])
  @@index([alarmRuleId])
  @@index([state])
  @@map("alarm_events")
}

// ─── Trends ────────────────────────────────────────────────
enum TrendMode    { ON_CHANGE  INTERVAL }
enum TrendQuality { GOOD  BAD  UNAVAILABLE }

model Trend {
  id              String        @id @default(uuid())
  tenantId        String        @map("tenant_id")
  pointId         String        @map("point_id")
  point           DevicePoint   @relation(fields: [pointId], references: [id], onDelete: Cascade)
  name            String
  mode            TrendMode
  intervalSeconds Int?          @map("interval_seconds")   // só p/ INTERVAL (60/300/900/1800/3600)
  retentionDays   Int           @map("retention_days")     // 30/90/365/1825
  enabled         Boolean       @default(true)
  startDate       DateTime      @default(now()) @map("start_date")
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")
  records         TrendRecord[]
  @@index([tenantId])
  @@index([pointId])
  @@map("trends")
}

model TrendRecord {
  id        BigInt        @id @default(autoincrement())   // eficiente p/ alto volume
  trendId   String        @map("trend_id")
  trend     Trend         @relation(fields: [trendId], references: [id], onDelete: Cascade)
  tenantId  String        @map("tenant_id")
  timestamp DateTime
  value     Float                                         // digital = 0.0/1.0
  quality   TrendQuality  @default(GOOD)
  @@index([trendId, timestamp(sort: Desc)])
  @@index([tenantId, timestamp(sort: Desc)])
  @@map("trend_records")
}
```

**Relations a adicionar em modelos existentes:**
- `DevicePoint`: `alarmRules AlarmRule[]` e `trends Trend[]`.
- O model **`Alarm` atual** (5 severidades) e os enums `Severity`/`AlarmStatus`
  são **removidos/substituídos**. Como os dados são mock, a migração pode dropar
  a tabela `alarms` antiga (confirmar que não há dado real a preservar).

> **Nota TimescaleDB (discussão futura):** `trend_records` é a série temporal —
> candidata a hypertable + compressão. **Pegadinha:** a retenção é **por-Trend**
> (cada trend escolhe 30/90/365/1825 dias); a *retention policy* nativa do
> Timescale é por-hypertable. Logo, a limpeza por-trend será sempre um **job
> custom** (deletar por `trendId` + idade) — o Timescale só ajuda na
> escala/compressão. O `BigInt autoincrement` será revisto na migração Timescale
> (PK precisa incluir a coluna de tempo para particionar).

---

## 4. Arquitetura — backend

```
gateway ─telemetry─► MQTT ─► BacnetMqttSubscriber.handleTelemetry()
                                   │  (já existe: status + Socket.IO)
                                   ▼
                          TelemetryDispatcher (NOVO)
                          p/ cada {pointId,value,ts,quality}:
                             ├─► TrendRecorder.consume()   (Fase 1)
                             └─► AlarmEngine.consume()     (Fase 2)
```

### 4.1 Resolução ponto → telemetria
O payload de telemetria traz `points[{tag, objectType, objectInstance, value, unit}]`
por `deviceId`. Para casar com `DevicePoint`/`Trend`/`AlarmRule`, resolver o
`pointId` por `(deviceId, objectType, instance)` (há `@@unique` em DevicePoint).
Manter um **cache em memória** (deviceId+tag → pointId, e configs ativas) para
não consultar o banco a cada ciclo de polling. Invalidar o cache em CRUD de
Trend/AlarmRule (event-emitter interno).

### 4.2 TrendRecorder (Fase 1)
Para cada ponto que tem `Trend.enabled`:
- **INTERVAL**: grava 1 `TrendRecord` quando `now - últimoRegistro >= intervalSeconds`.
- **ON_CHANGE**: mantém `lastValue` em memória; grava só quando `value != lastValue`
  (com tolerância p/ float, ex: |Δ| > epsilon configurável).
- `quality = GOOD` (Fase 1). Gravações em **lote** (`createMany`) por ciclo.

### 4.3 AlarmEngine (Fase 2) — evaluator puro + runtime
**Evaluator puro** (`evaluate(rule, value, prevState, nowMs) → AlarmDecision`):
função sem efeitos colaterais, testável isolada, contendo a lógica de
condição + histerese + delay. Reusável no edge no futuro.

**Runtime por regra** (em memória, re-hidratado no boot a partir dos
`AlarmEvent` não normalizados):
- `STATE_CHANGE`: dispara quando `value == activationState`.
- `VALUE_RANGE`: avalia `condition` contra `limitValue`/`[limitLow,limitHigh]`.
  - **Histerese**: só **normaliza** quando o valor recua além da histerese
    (ex: limite `>50`, histerese `2` → normaliza só `<48`).
  - **Delay**: a condição precisa **persistir** por `delaySeconds` antes de
    virar `ACTIVE`. Implementado com timer in-process + verificação no próximo
    valor; cancela se a condição sair antes do prazo.
- **Máquina de estados** (persistida em `AlarmEvent`):
  `INATIVO → (condição+delay) → ACTIVE → (normaliza) → NORMALIZED_UNACK → (ACK) → NORMALIZED_ACK`
  e `ACTIVE → (ACK enquanto ativo) → ACTIVE_ACK → (normaliza) → NORMALIZED_ACK`.
- Transições emitem evento → **Socket.IO** (reusar `TelemetryGateway`) p/ a tela
  em tempo real.

### 4.4 Retenção (Fase 1)
`@nestjs/schedule` `@Cron` diário (madrugada, ex: 03:17): para cada `Trend`,
`DELETE FROM trend_records WHERE trend_id=? AND timestamp < now()-retentionDays`.
Em lote/por-trend. Sem Redis.

---

## 5. API REST (contratos)

Todos sob `JwtAuthGuard`, escopados por `tenantId` (multi-tenant).

**Trends**
- `POST /trends` — cria Trend `{pointId,name,mode,intervalSeconds?,retentionDays}`
- `GET /trends` — lista trends (filtros `?deviceId&pointId`)
- `PATCH /trends/:id` — editar (enabled, mode, interval, retention, name)
- `DELETE /trends/:id`
- `GET /trends/:id/data?from&to&bucket&page&pageSize` — série p/ gráfico
  (agregada por time-bucket no Postgres: `date_trunc`/`time_bucket`), resumo,
  tabela paginada. **Mantém o shape que o front já espera** (`TrendsData`).
- `GET /trends/:id/export.csv?from&to` — export CSV
- `GET /points?deviceId=` — pontos disponíveis p/ configurar (já dá p/ derivar de `/devices`)

**Alarmes** (Fase 2)
- `POST /alarm-rules`, `GET /alarm-rules?deviceId&pointId`, `PATCH /alarm-rules/:id`, `DELETE /alarm-rules/:id`
- `GET /alarm-events` — lista (filtros: severity, state, dateFrom/To, pointId; ordena por severidade+ativação)
- `POST /alarm-events/:id/acknowledge` — registra `acknowledgedBy` = usuário da sessão
- `GET /alarm-events/stats` — cards (ativos, pendentes ACK, etc.)

---

## 6. Frontend (eu assumo o retrabalho)

> Respeitar as convenções do Next.js do projeto (ver `apps/frontend/AGENTS.md`).

**Ponto de entrada (novo):** na **lista de pontos do dispositivo** (tela de
Dispositivos / detalhe), cada ponto ganha ações **"Criar Alarme"** / **"Criar
Trend"** (e indicador se já tem). É daqui que o wizard abre.

**Wizard de criação (modal multi-passo):**
1. O que criar: `Alarme | Trend | Ambos`
2. Tipo: Alarme → `Mudança de Estado | Intervalo de Valor`; Trend → `Por Mudança | Por Intervalo`
3. Campos específicos (validação por tipo; campos analógicos só p/ ponto analógico)
4. Revisão + confirmação

**Tela de Trends (refazer):** seletor de Trend (por nome/ponto) + intervalo
(1h/24h/7d/custom) + **gráfico de linha** (analógico) / **degrau** (digital) +
tabela paginada + **export CSV**. Reaproveitar `TrendsChart/Table/SummaryCards/
FiltersPanel` adaptando ao novo contrato `Trend`/`TrendRecord`.

**Tela de Alarmes (refazer — Fase 2):** lista em tempo real (Socket.IO) ordenada
por severidade+tempo; colunas Nome/Ponto/Mensagem/Severidade/Estado/Ativado/
Normalizado/Reconhecido por; cores por severidade (Alta=vermelho, Média=âmbar,
Baixa=azul); botão **Reconhecer** nos estados `ACTIVE`/`NORMALIZED_UNACK`;
filtros. Substituir o modelo binário atual (`alarm.types.ts`) pelo novo.

**Realtime:** reaproveitar o cliente Socket.IO já usado p/ telemetria; adicionar
canal de `alarm-event`.

---

## 7. Fases de implementação

| Fase | Escopo | Depende de |
|------|--------|-----------|
| **0 — Backbone** | Migração de schema (4 tabelas + relations + remover Alarm antigo); `TelemetryDispatcher`; cache ponto↔config; ponto de entrada UX + shell do wizard | **autorização de migração** |
| **1 — Trends** | `TrendRecorder` (interval→on_change); API `/trends` + `/data` + `/export.csv`; tela de trends refeita; job de retenção (`@nestjs/schedule`) | Fase 0 |
| **2 — Alarmes** | Evaluator puro + runtime (state_change→value_range c/ delay+histerese); máquina de estados; API alarm-rules/events/ack; realtime; tela de alarmes refeita | Fase 1 (dado real) |
| **3 — Polish/Edge** | `quality`/`UNAVAILABLE` (gateway reporta falha); escalonamento+Infraspeak; mover evaluator p/ o edge; (opcional) TimescaleDB | Fase 2 |

---

## 8. Precisa de você

1. **Autorização da migração de banco** (Fase 0) — sem isso não há como criar
   Trend/TrendRecord/AlarmRule/AlarmEvent. Inclui **dropar a tabela `alarms`
   antiga** (mock) — confirmar que não há dado real.
2. Confirmar **`@nestjs/schedule`** como dep nova (pequena) p/ o job de retenção.
3. (Quando chegarmos na Fase 1) decisão de **TimescaleDB** — com o detalhe da
   retenção por-trend já mapeado acima.

---

## 9. Critérios de aceite / testes

- **Trends**: criar trend (interval e on_change) → ver `TrendRecord` acumulando →
  gráfico (linha/degrau) e tabela com dado real → export CSV → retenção apaga o
  que passou do prazo.
- **Alarmes**: testes unitários do **evaluator puro** cobrindo: GT/LT/BETWEEN/
  OUTSIDE, **histerese** (não normaliza dentro da banda morta), **delay**
  (não dispara antes do tempo; cancela se sair antes), e a **máquina de estados**
  completa (ACTIVE→NORMALIZED_UNACK→NORMALIZED_ACK e ramo ACTIVE_ACK).
- **Multi-tenant**: nenhum dado vaza entre tenants (todas as queries filtram `tenantId`).
</content>
