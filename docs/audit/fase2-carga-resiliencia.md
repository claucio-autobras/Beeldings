# Auditoria Fase 2 — Carga, Performance e Resiliência

Data: 28/07/2026 · Ambiente: Replit (dev, CPU compartilhada, Postgres gerenciado, EMQX remoto `mqtt.bluebee.ia.br`)
Escopo: blocos 4–5 do roteiro + extras (frota de gateways, cluster/multi-instância, quotas por tenant). **Somente auditoria — nenhuma correção aplicada.**

Legenda: ✅ testado e aprovado · ⚠️ testado, a melhorar · ❌ testado, reprovado · 📋 não mensurável no Replit (metodologia proposta ao final)

Cópia versionada deste relatório e do harness: `docs/audit/` (o diretório `.local` é ignorado pelo git). Notas brutas dos levantamentos de código: `.local/audit/fase2-notes/`. Saídas brutas dos testes: `.local/audit/tmp/*-results.txt`.

---

## 1. Carga HTTP nos endpoints críticos

Método: `autocannon` contra instância secundária (`node dist/src/main.js`, `PORT=4001`, throttle desativado para medir o serviço e não o rate limit). Token admin real. Percentis são os expostos pelo autocannon (p50/p90/p97.5/p99 — ele não calcula p95).

| Endpoint | Conexões | p50 | p90 | p97.5 | p99 | máx | RPS | 2xx / não-2xx |
|---|---|---|---|---|---|---|---|---|
| `GET /dashboard/overview` | 10 | 27 ms | 36 ms | 44 ms | 53 ms | 110 ms | 346 | 6 915 / 0 |
| `GET /alarm-events?pageSize=50` | 10 | 21 ms | 28 ms | 33 ms | 37 ms | 64 ms | 446 | 8 925 / 0 |
| `GET /trends/:id/data` | 10 | 12 ms | 16 ms | 21 ms | 26 ms | 175 ms | 774 | 15 473 / 0 |
| `GET /trends/history?ids=<5 ids>&pageSize=100` | 10 | 15 ms | 24 ms | 41 ms | 78 ms | 219 ms | 536 | 10 726 / 0 |
| `GET /dashboard/overview` | 25 | 74 ms | 91 ms | 111 ms | 149 ms | 341 ms | 322 | 4 824 / 0 |
| `GET /dashboard/overview` | 50 | 148 ms | 177 ms | 205 ms | 284 ms | 568 ms | 327 | 4 906 / 0 |
| `GET /dashboard/overview` | 100 | 273 ms | 301 ms | 319 ms | 340 ms | 413 ms | 362 | 5 432 / 0 |

- [x] ✅ **Latência em carga moderada (c=10)**: todos os endpoints críticos com p99 ≤ 78 ms e zero erros/timeouts/não-2xx. (`/trends/history` exige `ids`; sem o parâmetro responde 400 por validação — comportamento correto.)
- [x] ⚠️ **Saturação do dashboard**: throughput satura em ~320–360 RPS já a partir de c=10; de c=25 a c=100 o RPS fica flat e só a latência cresce (p50 74→273 ms) — saturação clara de CPU do processo. Causa: `getOverview` executa ~9–11 queries/request sem cache (`dashboard.controller.ts:139`). Primeiro candidato a cache curto (2–5 s) em produção. Severidade: **média**.
- [x] ✅ **Login (POST /auth/login)**: `@Throttle 10/min` funciona — sob flood, 10× 200 e 73 547× 429 imediato (p50 do 429 = 0 ms: o throttler corta antes do bcrypt; sem vetor de exaustão de CPU). Login legítimo medido isoladamente: 99–122 ms (custo bcrypt esperado).
- [x] ✅ **Throttle global (600/min/IP)**: 100 requisições em rajada no :4000 → 100× 200 (abaixo do teto generoso, dimensionado para polling do frontend). Lembrete da fase 1: tracker usa XFF — atrás do proxy Next, clientes de um mesmo IP compartilham o balde.
- [x] ⚠️ **Observação**: números absolutos refletem CPU compartilhada do Replit e banco pequeno; ver metodologia de staging (§9).

## 2. Ingestão MQTT em volume

Método: publisher sintético (`mqtt-flood.js`) publicando telemetria real no broker EMQX para um device/40 pontos/40 trends criados só para o teste (removidos ao final). Backend real consumindo. Taxas abaixo são **efetivas** (mensagens enviadas ÷ tempo decorrido — o timer de 1 s do publisher perde ticks sob jitter, então a taxa nominal não foi atingida).

| Fase | Nominal | Efetivo | Publicado | Gravado em trend_records | Perda |
|---|---|---|---|---|---|
| A | 5 msg/s × 20 s | ~4,4 msg/s (95 msgs / 21,5 s) ≈ 177 pts/s | 95 msgs (3 800 pts) | 3 800 | **0** |
| B | 25 msg/s × 30 s | ~23 msg/s (725 msgs / 31,5 s) ≈ **920 pts/s** | 725 msgs (29 000 pts) | 29 000 | **0** |

- [x] ✅ **Sem perda até ~920 pontos/s sustentados** (pico de 32 372 pts/min reportado por `/health/comms`); `createMany` por mensagem dá conta; `parseErrors: 0`. Não encontramos o ponto de saturação da ingestão dentro do que o broker permitiu (ver ECONNRESET abaixo); acima disso é medição para staging (§9).
- [x] ⚠️ **Sem fila/backpressure entre MQTT e Prisma**: `TrendRecorderService.consume` é fire-and-forget (`trend-recorder.service.ts:109`). Se o banco degradar, promises se acumulam sem limite (risco de OOM sob avalanche) e falha vira só log — sem retry, dados perdidos. Severidade: **média** (mitigada pelo COV/deadband que reduz volume real).
- [x] ⚠️ **Publisher derrubado pelo broker (`ECONNRESET`) ao final da rajada da fase B** — proteção de flood do EMQX. Bom para o backend, mas um gateway legítimo drenando store-and-forward em rajada pode ser derrubado (ver §5).
- [x] ✅ **Contadores de ingestão** (`/health/comms`) bateram exatamente com o publicado — boa observabilidade para repetir em staging.

## 3. Queries e banco

- [x] ✅ **Particionamento**: `trend_records` com partições mensais nativas; criadas com 2 meses de antecedência; retenção dropa partição inteira O(1) quando possível (`trend-retention.service.ts`).
- [x] ✅ **Índices tenant-first**: `trend_records`, `telemetry`, `audit_logs`, `status_events`, `alarm_events`, rollups — todos com `@@index([tenantId, <ts> DESC])`. `EXPLAIN ANALYZE` da série de 24 h confirma **partition pruning + index scan** (execução 1,8 ms).
- [x] ⚠️ **`Device` sem índice em `tenant_id`** (schema.prisma:161-182) e `DevicePoint` sem `tenantId` (filtro de tenant sempre via join). Hoje irrelevante; em 100× tenants dói nas listagens. Severidade: **baixa** (migração trivial na fase de correção).
- [x] ✅ **Leitura de trends com bucket/limite**: séries usam `date_trunc` + faixa temporal (default 24 h); `hour`/`day` leem dos rollups; history paginado (máx. 500/página); export em massa usa keyset + streaming com backpressure.
- [x] ⚠️ **Queries sem `take`**: `reports.service.ts:318` (alarmEvents), `:448` (trendRecords p/ CSV), `:692` (auditLog do relatório completo), `availability.service.ts:145` (statusEvents) — limitadas só pelo período; período longo em tenant grande carrega milhões de linhas em memória. `trends.service.ts:331` (export CSV single-trend) aceita período aberto. Severidade: **média**.
- [x] ⚠️ **N+1 leves**: `reports.service.ts:465` — 1 query por trend (cap 12, paralelo — aceitável); resolução entityId→siteId do histórico de comandos com queries separadas. Severidade: **baixa**.
- [x] ✅ **Rollups**: SUM+COUNT (merge exato) com `INSERT … ON CONFLICT`, cursor único em `trend_rollup_state`, só o líder executa. Sem compressão nativa (Postgres puro) — rollup + drop de partição fazem o papel.
- [x] ⚠️ **Pool do Prisma**: **default** (num_cpus×2+1; sem `connection_limit` na URL). `max_connections` = 112; uso observado sob carga ~17. Projeção 100× tenants: o risco não é o nº de tenants (pool é por instância), e sim **instâncias × pool default** — com 4+ instâncias em máquinas com muitos cores estoura o 112 (cada instância abre ainda +1 conexão dedicada do ClusterService). Recomendar `connection_limit` explícito. Severidade: **média**.

## 4. Cluster / multi-instância

Método: 2ª instância real (`PORT=4001`) contra o mesmo banco/broker + flood MQTT e alternância de limiar de alarme.

- [x] ✅ **Eleição de líder**: advisory lock de sessão do Postgres; 2ª instância subiu como follower (`isLeader:false`); queda do líder libera o lock automaticamente (sessão).
- [x] ✅ **Jobs agendados leader-guarded**: rollups, retenção, AutomationScheduler, EMQXMonitor, AvailabilityRecorder — todos guardados (verificado em código; rollup/retention também idempotentes por upsert).
- [x] ❌ **CRÍTICO — Gravação de trends duplica com 2 instâncias**: 140 msgs publicadas (~8,5 msg/s efetivos × 16,5 s) → **11 200 registros = exatamente 2×** os 5 600 esperados. `BacnetMqttSubscriber.handleTelemetry` chama `trendRecorder.consume` em **toda** instância, sem guarda de líder (`bacnet-mqtt.subscriber.ts:248`). O log do ClusterService ("assumindo ingestão MQTT e motores stateful") é enganoso — a guarda só existe no `AvailabilityRecorder`. Duplica volume e adultera médias/rollups. Severidade: **crítica** (bloqueia >1 instância).
- [x] ❌ **CRÍTICO — Motor de alarmes duplica ocorrências com 2 instâncias**: com 1 instância, 55 cruzamentos de limiar → **1 ocorrência** reutilizada (ciclo ACTIVE/NORMALIZED íntegro sob carga). Com 2 instâncias, mesmo teste → **2 ACTIVE simultâneos + 2 NORMALIZED_UNACK** para a mesma regra (serialização por regra é só local à instância). Notificações duplicadas + trilha adulterada. Severidade: **crítica**.
- [x] ✅ **Race no ciclo de alarme em instância única**: promise chain por regra aguentou ~5 cruzamentos/s sem linha duplicada nem reativação perdida.
- [x] ✅ **AUTOMATION_NOTICE / socket**: leader-only via LISTEN/NOTIFY re-emitido por instância aos seus próprios sockets — sem duplicação por design; telemetria emitida direto por cada instância (correto: cada socket vive numa instância).
- [x] ⚠️ **Estado em memória por instância**: progress maps (scan SNMP, OTA, PDF), `pendingWrites`, lockout de senha, `DeviceStatusService.lastSeen` — inconsistência entre instâncias (progresso invisível noutra instância; lockout contornável alternando instância). Severidade: **média**.
- [x] ⚠️ **`OnvifPendingValidation` roda em toda instância** (sem guarda) — probes redundantes. Severidade: **baixa**.

## 5. Frota de gateways

- [x] ✅ **Versões divergentes**: gateway reporta versão no canal `health`; backend compara com `latestVersion` e persiste; OTA com checksum, confirmação MQTT e watchdog de reversão (auditoria de código; sem frota real no Replit).
- [x] ✅ **Compatibilidade de payload**: campos de telemetria opcionais (`objectType?`, `state?` etc.) — payload antigo não quebra o parser; `parseErrors` contabilizado. Timestamp do gateway é preservado no trend (store-and-forward não adultera a história).
- [x] ⚠️ **Avalanche de reconexão (store-and-forward)**: cada gateway drena até 10 000 msgs em loop apertado ao reconectar (`gateway-mqtt.service.ts:301`); backend não tem backpressure (§2). N gateways reconectando após queda do broker = N×10k msgs em rajada + flood-kick do broker (ECONNRESET observado no teste). Não mensurável com frota real no Replit — ver §9. Severidade: **média**.
- [x] ✅ **Store-and-forward sem perda**: suite unitária executada agora (7/7 verdes) — escrita atômica tmp+rename, recuperação de arquivo truncado, fila cheia com descarte observável (cap 10k + contador de drops).
- [x] ✅ **Config retida por gateway**: 1 tópico retido por gateway; escala linear no broker, sem fan-out cruzado.

## 6. Resiliência

- [x] ✅ **EMQX offline (lado gateway)**: publish sem conexão → enfileira no store-and-forward (testado por unidade); reconexão a cada 5 s; LWT retido garante o offline no backend.
- [x] ✅ **EMQX offline (lado backend)**: reconexão infinita a cada 5 s, resubscribe automático do client mqtt.js; app segue servindo HTTP (degradação, não queda). Verificado em código; não provocamos queda real do broker (compartilhado com gateways de campo — ver §9).
- [x] ⚠️ **Postgres offline**: backend não cai, mas o caminho de ingestão só loga erro (sem retry) — telemetria durante indisponibilidade do banco é perdida mesmo com broker de pé (sem fila interna; QoS 0). ClusterService tem retry próprio para a conexão de liderança. Severidade: **média**.
- [x] ✅ **Idempotência de mensagem MQTT duplicada**: publicação dobrada da mesma telemetria (45 msgs × 2) → **1 800 registros = exatamente 1×** (deadband ON_CHANGE absorve valor idêntico; INTERVAL absorve pelo relógio). Duplicata não dispara alarme duplicado em instância única (absorvida pela ocorrência aberta). Ressalva: pares (trend,timestamp) duplicados aparecem quando *valores diferentes* chegam no mesmo ms (rajada) — cosmético.
- [x] ❌ **Graceful shutdown ausente**: `main.ts` **não chama `app.enableShutdownHooks()`** — em SIGTERM os `onModuleDestroy` (fechar Prisma/cluster/MQTT) não executam. Confirmado no teste: SIGTERM → processo morre sem nenhum log de shutdown. Deploy/restart vira queda suja (a liderança sobrevive só porque a sessão PG morre junto e libera o advisory lock). Severidade: **alta** (correção de 1 linha).
- [x] ⚠️ **Healthchecks**: `/health/comms` rico (MQTT, liderança, ingestão), mas **sem liveness/readiness** separados para orquestrador (Terminus ausente; `/health/comms` responde 200 mesmo com MQTT caído — o estado vai no corpo). Severidade: **baixa/média**.
- [x] ✅ **Redis**: não utilizado (coordenação 100% Postgres: advisory lock + LISTEN/NOTIFY) — um serviço a menos para cair.

## 7. Quotas por tenant (noisy neighbor)

- [x] ⚠️ **Sem quotas por tenant hoje**. Vetores confirmados:
  - **Flood MQTT**: pipeline de ingestão único e sem fila por tenant; ~920 pts/s de um tenant consomem CPU/banco de todos (medido §2 — custo linear e compartilhado). Mitigantes: credencial MQTT por gateway + ACL EMQX (flood exige gateway comprometido) e flood-kick do broker.
  - **Criação de pontos/trends/regras em excesso**: nenhum limite de contagem por tenant; 10k trends ON_CHANGE cov=0 de um tenant dominariam o `createMany` e o rollup do líder.
  - **Relatórios sem `take`** (§3): tenant com histórico grande + período longo = memória/IO do processo inteiro.
  - **Rate limit HTTP por IP, não por tenant/usuário** — tenants atrás do mesmo NAT compartilham balde; tenant agressivo não tem teto próprio.
- [x] 📋 **Recomendações (fase de correção)**: limites por tenant de nº de trends/regras/pontos (checados no CRUD); teto de pontos/min por gateway na ingestão com descarte observável; `take` máximo nos relatórios; throttle por usuário autenticado além do IP; métricas de ingestão por tenant para detecção.

## 8. Consolidado de severidades

| # | Achado | Severidade |
|---|---|---|
| 1 | Trends gravados em dobro com ≥2 instâncias (ingestão sem guarda de líder) | **Crítica** |
| 2 | Ocorrências de alarme duplicadas com ≥2 instâncias | **Crítica** |
| 3 | `enableShutdownHooks` ausente — shutdown sempre "sujo" | **Alta** |
| 4 | Ingestão→Prisma fire-and-forget sem retry/backpressure (perda com PG degradado; OOM potencial em avalanche) | Média |
| 5 | Relatórios/exports sem `take` (memória sob período longo) | Média |
| 6 | Pool Prisma default sem `connection_limit` (estouro de 112 conexões com múltiplas instâncias) | Média |
| 7 | Saturação precoce do `/dashboard/overview` (~320–360 RPS, 9–11 queries sem cache) | Média |
| 8 | Sem quotas por tenant (noisy neighbor) | Média |
| 9 | Avalanche de reconexão da frota sem backpressure no backend | Média |
| 10 | Estado em memória por instância (progress, lockout, lastSeen) | Média |
| 11 | Índice `tenant_id` ausente em `devices`; `DevicePoint` sem tenantId | Baixa |
| 12 | `OnvifPendingValidation` sem guarda de líder | Baixa |
| 13 | Sem endpoints liveness/readiness padronizados | Baixa |

Nota: os achados #1/#2 não afetam a operação atual (1 instância), mas **bloqueiam qualquer escala horizontal** até a fase de correção.

## 9. Metodologia para repetir em staging

O que o Replit não permite medir e como fazer em staging dedicado:

1. **Saturação real de HTTP**: repetir `http-load.sh` (escada c=10→200) em VM com CPU dedicada e dados realistas (≥10 M trend_records, ≥50 tenants). Critério: p97.5 < 300 ms no dashboard sob pico projetado (nº usuários × 1 req/2 s de polling).
2. **Ingestão em escala de frota**: `mqtt-flood.js` parametrizado para N clientes MQTT paralelos (1 por gateway simulado), 200–500 gateways × 2–10 msg/s. Medir: pts/min publicados vs. `/health/comms` (perda), lag de gravação (count esperado vs. real por janela), CPU/RSS (`pidstat`), conexões (`pg_stat_activity`), e latência HTTP concorrente durante o flood. Reportar sempre a taxa **efetiva** (enviadas ÷ tempo), não a nominal.
3. **Avalanche de reconexão**: derrubar o broker 10 min com a frota publicando (enche store-and-forward), religar e medir o pico de drain (msgs/s via API EMQX), ECONNRESETs e perda fim-a-fim.
4. **Queda real de Postgres/EMQX**: parar os serviços em staging (impossível no Replit: banco gerenciado e broker compartilhado com gateways de campo). Verificar: backend de pé, reconexão automática, e o *gap* de dados resultante (esperado hoje: perda durante PG down — achado #4).
5. **Multi-instância**: repetir os testes de duplicação (mqtt-test.sh fase D e alarm-cross.js) **após** corrigir #1/#2, com 3 instâncias e kill -9 do líder no meio do flood (janela de failover ~5 s do advisory lock: medir gap/duplicação na troca).
6. **Retenção/rollup em volume**: popular 6+ meses de partições, cronometrar drop vs. deleteMany; conferir que o rollup incremental não trava a ingestão (cursor único).

Harness completo em `docs/audit/harness/` (versionado) e `.local/audit/tmp/` (execução); depende só de `DATABASE_URL`, `MQTT_BROKER_URL`, credenciais e um token admin.

---
*Dados sintéticos do teste (device/pontos/trends/regra `audit-load-*` e 45 964 trend_records) foram removidos do banco ao final. Nenhuma alteração de código foi feita.*
