---
name: BlueBee dashboard alarm cards
description: Fonte de dados dos alarmes do Dashboard + convenção de altura fixa e overflow dos 3 cards
---

**Fonte de dados dos alarmes do Dashboard (autoritativa):** contagens/KPIs/gráfico
"Alarmes por Status" vêm de `/alarm-events/stats` (mesma fonte da tela de Alarmes),
NÃO do feed legado `/alarms`. `stats.byStatus` é a distribuição mutuamente exclusiva
(alarme=ACTIVE, normal=NORMALIZED_UNACK, reconhecido=ACTIVE_ACK+NORMALIZED_ACK; soma=total).
`pendingAck`=NORMALIZED_UNACK apenas (alarme ATIVO NÃO é reconhecível — ver bloco final).

**Feeds legados `/alarms` (linhas, não contagens):** `status=open` = ACTIVE+ACTIVE_ACK
(listas "Alarmes Ativos" — só ALARME aparece). `status=pending-ack` = NORMALIZED_UNACK apenas.

**AlarmPriorityCard usa DOIS feeds separados** (props `activeAlarms` + `pendingAckAlarms`):
a severidade Alta/Média/Baixa vem de `activeAlarms` (feed `status=open`, filtrado a ALARME);
a lista "a reconhecer" vem de `pendingAckAlarms` (feed `pending-ack` = NORMALIZED_UNACK).
NUNCA derive a severidade do feed pending-ack: alarme ativo NÃO é reconhecível, logo esse
feed não tem linhas ALARME e a severidade zeraria (bug real após estreitar pending-ack).
`AlarmsByStatusChart` recebe `alarms={activeAlarms}` só para o "Mais antigo" (aberto) do rodapé.

**Why:** o card "a reconhecer" e o KPI "Aguard. ACK" liam do feed `open`, que OMITE
NORMALIZED_UNACK → sempre mostravam 0/"Nenhum a reconhecer" mesmo com alarmes esperando ACK.
O `/alarms` legado não filtra por site → escopo por site é feito no cliente (deviceSiteMap);
`/alarm-events/stats` aceita `siteId`.

**How to apply:** para números use stats; para linhas dos cards use o feed certo. Query
keys dos feeds dashboard compartilham prefixos (`dashboard-alarms`, `dashboard-alarm-status-counts`)
já invalidados no ACK — mantenha o prefixo ao adicionar feeds para atualizar após reconhecer.

---

Os 3 cards da linha de alarmes do Dashboard (Prioridade dos alarmes · Alarmes ao
longo do tempo · Alarmes Ativos) compartilham uma altura fixa via a constante
`ALARM_CARD_H` (em `modules/dashboard/components/alarmCard.ts`), não `h-full`.

**Regra:** mantenha os 3 sempre com a MESMA altura. O excesso de conteúdo nunca
estica o card — trate por:
- limite de itens (ex.: máx. 2 na Prioridade e no detalhe do pico do gráfico),
- modal (visão geral de todos os picos no gráfico),
- rolagem interna (`flex-1 min-h-0 overflow-y-auto` no card de ativos).

O card "Alarmes Ativos Recentes" usa `ALARM_CARD_2ROW_H` (mesmo arquivo): altura fixa
em lg+ (2×ALARM_CARD_H+gap) e, abaixo de lg, `max-h` com rolagem interna para não
empurrar o dashboard no celular — cabeçalho e rodapé ("Ver todos →") ficam fora do scroll.

**Why:** os cards cresciam conforme a densidade de dados e ficavam desalinhados;
o alinhamento consistente é requisito explícito da visão cliente.

**How to apply:** ao mexer nesses cards, aplique `ALARM_CARD_H` no root e garanta
que qualquer nova seção respeite o teto de altura (limite/modal/scroll). O foco é a
visão CLIENTE; a visão Admin (`groupBySite`) só deve manter o alinhamento.

**"Aguardando ACK" = NORMALIZED_UNACK apenas, em TODA parte** (card `stats.pendingAck`,
chip da lista, KPI dashboard, feed legado `status=pending-ack`). **Alarme ATIVO NÃO é
reconhecível:** só normaliza→depois reconhece. `nextStateOnAck` só transiciona
NORMALIZED_UNACK→NORMALIZED_ACK (ACTIVE fica ACTIVE → `acknowledge()` lança 400
"não está em estado reconhecível"). No front, `PENDING_ACK` em `AlarmEventsTable`
= `['NORMALIZED_UNACK']` controla botão "Reconhecer" + checkbox de ACK em massa; ativos
não têm nenhum dos dois. **Why:** decisão de produto — operador só reconhece depois que
o alarme volta ao normal; a tentativa anterior (incluir ACTIVE no "Aguardando ACK",
`ACTIVE→ACTIVE_ACK` no ACK) foi explicitamente revertida pelo usuário. `ACTIVE_ACK` vira
estado só-legado (nunca mais criado, mas ainda tratado por `nextStateOnCondition`).

Deep-links do Dashboard → tela de Alarmes usam query params suportados em
`modules/alarms/pages/alarms.page.tsx`: `severity`, `highlight`, `state`
(`NORMALIZED_UNACK`/`NORMALIZED_ACK`/`open`/`all`) e janela `from`/`to` (ISO; recorta os
eventos e, quando presente, o estado inicial vira `all` porque o pico é histórico). O KPI
"Aguard. ACK" e o "ver mais" do card Prioridade linkam `state=NORMALIZED_UNACK`.

**Escopo por cliente/site NÃO é query param.** A tela de Alarmes lê o cliente/site
do FILTRO GLOBAL (localStorage via `setGlobalTenant`/`setGlobalSite`), não de query
param — o Topbar reflete a seleção. Para deep-link escopado por cliente (ex.: clicar
num cliente dentro de um pico na visão Admin `groupBySite`), chame
`setGlobalTenant(tenantId)` + `setGlobalSite(null)` ANTES de `router.push('/alarms?from=...&to=...')`.
O identificador vem de `AlarmEventItem.tenantId` (o evento tem `tenantName`/`siteName`
mas NÃO tem `siteId`), então só a visão Admin (grupo por tenant) consegue montar o link.
