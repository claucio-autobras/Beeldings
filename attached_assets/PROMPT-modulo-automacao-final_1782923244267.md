# PROMPT — Módulo de Automação (VERSÃO FINAL)

> Este documento descreve a versão **final e definitiva** do módulo de Automação do BlueBee IoT — **funcionamento e layout** — de forma que possa ser reproduzido **idêntico**. Substitui o MVP inicial (`PROMPT-modulo-automacao.md`).
> **LEIA TUDO ANTES DE COMEÇAR.** Reproduza os arquivos, o comportamento e o design exatamente como especificado.

---

## 1. O que é

A tela **"Automações"** (`/automation`) é o **motor de comando** do sistema: o usuário cria regras no modelo **QUANDO / SE / ENTÃO** que **comandam os pontos das controladoras** (BACnet/Modbus/MQTT), inspirado em apps de casa inteligente (Google Home/Alexa), mas voltado a BMS.

> ⚠️ A tela "Automações" **não é** configuração de alarme. Se o `/automation` atual apenas duplicar a criação de alarmes do módulo de dispositivos, **substitua** por este motor de comando (a rota `/automation` já importa `@/modules/automation/pages/automation.page`).

Público-alvo: **operador leigo**. A criação precisa ser guiada, em linguagem natural, sem jargão técnico.

---

## 2. Restrições obrigatórias (NÃO violar)

1. **Multi-tenant sempre.** Toda query filtra por `tenantId`. Nenhuma automação de um cliente pode ler/comandar pontos de outro. Perfis globais (ADMIN/CCO) operam sobre qualquer cliente via `tenantId` explícito; os demais ficam travados no próprio.
2. **Escopo de arquivos: apenas o módulo `automation`** (backend `apps/backend/src/modules/automation`, frontend `apps/frontend/src/modules/automation`) + os pontos de integração mínimos listados (registro no `app.module`, export do `BacnetWriteService`, `apiPut` no api-client). **Não** modifique o gateway, alarmes, devices (além do export), etc.
3. **A ação de escrita reusa o caminho existente.** `WRITE_POINT` chama o `BacnetWriteService` (mesmo de `POST /devices/bacnet/write`) e grava na trilha de auditoria via `AuditService.record()` (`action='COMMAND'`, `entity='device_command'`). **Escrita reversa só é implementada para BACnet.**
4. **O agendador roda só no LÍDER** (`ClusterService.onLeadership()`/`isLeader()`), padrão do projeto — **NÃO** use BullMQ nem `@nestjs/schedule` (não existem no backend).
5. **TypeScript estrito, sem `any`.** Imports backend com extensão `.js` (NodeNext). `tsc --noEmit` limpo no backend **e** no frontend.
6. **Mobile-first e SEM scroll horizontal.** Toda tela projetada primeiro para celular (o sistema é consumido em celular/tablet). Campos com altura de toque ≥44px e fonte 16px no mobile (evita zoom do iOS).
7. **Sem `window.confirm()`/`alert()`** — usar modais próprios.
8. Trabalhe numa branch; migração aplicada com `npx prisma migrate deploy` (o `migrate dev` trava neste projeto por causa do pgvector).

---

## 3. Modelo de dados (Prisma — migração aditiva)

Adicione ao `apps/backend/prisma/schema.prisma` (nada é alterado nas tabelas existentes):

```prisma
enum AutomationMode { ONESHOT CONTINUOUS }
enum AutomationTriggerType { SCHEDULE }
enum AutomationActionType { WRITE_POINT NOTIFY }
enum AutomationBranch { ALWAYS ON_TRUE ON_FALSE }
enum AutomationExecutesOn { CLOUD EDGE }

model Automation {
  id            String                @id @default(uuid())
  tenantId      String                @map("tenant_id")
  siteId        String?               @map("site_id")
  name          String
  enabled       Boolean               @default(true)
  mode          AutomationMode        @default(ONESHOT)
  triggerType   AutomationTriggerType @default(SCHEDULE) @map("trigger_type")
  triggerConfig Json                  @map("trigger_config")
  condition     Json?
  evalSeconds   Int                   @default(30) @map("eval_seconds")
  executesOn    AutomationExecutesOn  @default(CLOUD) @map("executes_on")
  priority      Int                   @default(8)
  createdBy     String?               @map("created_by")
  lastRunAt     DateTime?             @map("last_run_at")
  lastRunResult String?               @map("last_run_result") // SUCCESS | PARTIAL | FAILURE
  createdAt     DateTime              @default(now()) @map("created_at")
  updatedAt     DateTime              @updatedAt @map("updated_at")
  actions       AutomationAction[]
  @@index([tenantId])
  @@index([enabled, mode])
  @@map("automations")
}

model AutomationAction {
  id            String               @id @default(uuid())
  automationId  String               @map("automation_id")
  automation    Automation           @relation(fields: [automationId], references: [id], onDelete: Cascade)
  order         Int
  branch        AutomationBranch     @default(ALWAYS)
  type          AutomationActionType
  targetPointId String?              @map("target_point_id") // coluna simples, SEM FK (runner carrega por id)
  value         Json?                // number (analógico) | boolean (digital)
  delaySeconds  Int                  @default(0) @map("delay_seconds")
  config        Json?                // NOTIFY: { message }
  createdAt     DateTime             @default(now()) @map("created_at")
  @@index([automationId])
  @@index([targetPointId])
  @@map("automation_actions")
}
```

> **CRÍTICO:** `triggerType` PRECISA de `@map("trigger_type")` (a coluna é snake_case). Todos os campos multi-palavra usam `@map`.

Formatos dos campos JSON:
- **`triggerConfig`** (SCHEDULE): `{ entries: [{ time:"HH:mm", endTime?:"HH:mm", days:[0..6] }], timezone:"America/Sao_Paulo" }`. `days`: 0=domingo…6=sábado. `endTime` opcional = horário de "desligar".
- **`condition`**: `{ pointId:string, operator:"EQ"|"NEQ"|"GT"|"LT"|"GTE"|"LTE", value:number|boolean }`. Obrigatória em `CONTINUOUS`.
- **`AutomationAction.value`**: `number` (analógico) ou `boolean` (digital). **`config`** (NOTIFY): `{ message:string }`.

---

## 4. Comportamento (regras de negócio)

### Dois modos
- **`ONESHOT` (Em horários):** o agendador dispara as ações no `time` de cada entrada, nos `days`, no timezone. Todas as ações têm `branch=ALWAYS`.
  - **Horário de término (`endTime`):** no `endTime`, o runner roda em **modo reverso** — **inverte apenas as escritas DIGITAIS** (o que foi ligado é desligado). Analógico e NOTIFY são ignorados no término. Ex.: liga às 18:00, desliga às 06:00, numa automação só.
- **`CONTINUOUS` (Quando um ponto mudar / ENQUANTO):** a cada `evalSeconds` o runner lê o último valor do ponto da condição e **mantém a saída**: ações `ON_TRUE` quando a condição é verdadeira, `ON_FALSE` quando falsa. Idempotência: só escreve quando o valor-alvo **muda** (não reescreve o mesmo valor a cada ciclo). Se não houver valor conhecido do ponto (telemetria ausente/velha), **não age** naquele ciclo (skip gracioso — nunca comanda sobre dado velho).

### Seleção de pontos — todos os protocolos
- O seletor lista pontos de **BACnet + Modbus + MQTT**.
- **Condição (leitura):** todos os pontos, todos os protocolos.
- **Ação (escrita):** apenas pontos **graváveis** — BACnet (AO/AV/BO/BV/MSO) e Modbus (coil/holding). MQTT é leitura (não aparece em ações).
- **Execução da escrita é BACnet-only:** o runner verifica `device.protocol` e, se não for `bacnet`, lança erro claro e auditado (`escrita via <protocol> ainda não suportada`) — nunca despacha um comando BACnet a um device de outro protocolo. (Modbus/MQTT write é follow-up no gateway.)

### Escopo por site
- `Automation.siteId` opcional. `GET /automation?tenantId=&siteId=` retorna as do site **+ as do cliente inteiro** (`siteId` nulo, que valem para todos os sites) via `where.OR`.
- A UI respeita o filtro global de site (o "Todos os Sites" do topo, `useSiteFilter`) e o drawer tem seletor de site.

### Prioridade e execução
- `priority` BACnet default **8** (comando manual do operador, prioridade mais alta, sempre vence a automação). `executesOn=CLOUD` fixo (campo reservado para `EDGE` na V2).
- **Governança:** criar/editar exige ADMIN/CCO (pré-autoriza comandos). Toda execução é auditada com `metadata.automationId`. O ator da auditoria é sintético (`Automação: <nome>`).

---

## 5. BACKEND — `apps/backend/src/modules/automation` (DDD)

### `domain/automation.types.ts`
Tipos e helpers: `ScheduleEntry` (`time`, `endTime?`, `days`), `ScheduleTriggerConfig`, `ConditionOperator`, `AutomationCondition`, `NotifyConfig`, `AutomationActionInput`, `CreateAutomationInput`, `UpdateAutomationInput`. Helpers `objectTypeToNum(t)` (mapa AI:0,AO:1,AV:2,BI:3,BO:4,BV:5,MSI:13,MSO:14,MSV:19) e `toWriteNumber(v)` (boolean→1/0).

### `application/point-value-cache.service.ts`
`OnModuleInit`. Injeta `MqttService` (global). Assina `bluebee/+/gateway/+/telemetry` e mantém `Map` do último valor por `deviceId:objectType:objectInstance` (a telemetria NÃO é persistida — flui em memória). `get(deviceId, objectType, instance)` retorna o valor se recente (idade < 120s), senão `undefined`. Auto-contido (não toca no `MqttModule`/subscriber).

### `application/automation.service.ts`
CRUD multi-tenant. Injeta `PrismaService`.
- `list(scopeTenantId?, siteId?)`: `where.tenantId` se escopado; se `siteId`, `where.OR = [{siteId},{siteId:null}]`. Inclui `actions` ordenadas.
- `getById`, `create(input, {tenantId, createdBy})`, `update(id, input, scope)` (substitui ações numa transação), `setEnabled`, `remove`.
- **Validação:** nome obrigatório; priority 1–16; ONESHOT exige ≥1 entrada com `time` `HH:mm` válido, `endTime` `HH:mm` se presente, e dias válidos; CONTINUOUS exige `condition`; cada `WRITE_POINT` exige `targetPointId`+`value` (number|boolean); NOTIFY exige `message`. `assertPointsOwnership`: todo ponto referenciado (condição + ações) pertence ao tenant (senão 400/403).

### `application/automation-runner.service.ts`
Executa UMA automação. Injeta `PrismaService`, `BacnetWriteService` (de `DevicesModule`), `AuditService` (global), `PointValueCacheService`. Guarda contra execução concorrente (`Set` de ids) e `Map` de último valor aplicado (idempotência CONTINUOUS).
- `run(id, reason, reverse=false)`.
- `execute`: se `reverse`, roda só `WRITE_POINT` invertendo digitais; senão avalia `condition` (skip gracioso se valor indisponível), seleciona ações por ramo (`ALWAYS`/`ON_TRUE` se verdadeiro/`ON_FALSE` se falso), executa em ordem respeitando `delaySeconds`.
- `executeWrite(auto, action, reason, reverse)`: carrega `DevicePoint`+`Device` (ip, port, gatewayId, tenantId, **protocol**); barra se sem gateway ou `protocol !== 'bacnet'`; digital = objectType ∈ {4,5,14}; se `reverse` só digital e escreve o oposto; chama `bacnetWrite.writeBacnet({...priority})`; audita (`action='COMMAND'`, metadata com `automationId`, `automationName`, valor); em CONTINUOUS só escreve se mudou. `executeNotify`: MVP loga (WhatsApp/SendGrid é V2).
- Atualiza `lastRunAt`/`lastRunResult` (`SUCCESS`/`PARTIAL`/`FAILURE`); em CONTINUOUS só grava quando algo aconteceu.

### `application/automation-scheduler.service.ts`
`OnModuleInit`/`OnModuleDestroy`. Injeta `ClusterService`, `PrismaService`, `AutomationRunnerService`. Registra `cluster.onLeadership` → inicia/para os ticks **só no líder**.
- **Tick ONESHOT** (30s): para cada entrada `enabled` `mode='ONESHOT'`, no timezone calcula `HH:mm`+dia; no `time` chama `run(id, …, false)` (dedup `id:idx:start`); no `endTime` chama `run(id, …, true)` (dedup `id:idx:end`). Dedup por minuto (limpa o set quando o minuto UTC muda).
- **Tick CONTINUOUS** (10s): para cada `enabled` `mode='CONTINUOUS'` cujo `evalSeconds` venceu, chama `run(id, 'enquanto')`.
- `localTime(now, tz)` via `Intl.DateTimeFormat` (hourCycle h23, weekday) → `{hhmm, dow}`; fallback horário local se tz inválido.

### `presentation/automation.controller.ts`
`@Controller('automation')` + `@UseGuards(JwtAuthGuard)`.

| Método | Rota | Guard | Função |
|---|---|---|---|
| `GET` | `/automation?tenantId=&siteId=` | ADMIN/CCO/SUPERVISOR | lista (escopo por tenant + site) |
| `GET` | `/automation/:id` | ADMIN/CCO/SUPERVISOR | detalhe |
| `POST` | `/automation` | **ADMIN/CCO** | cria (resolve tenantId no servidor) |
| `PUT` | `/automation/:id` | **ADMIN/CCO** | atualiza |
| `PATCH` | `/automation/:id/enabled` | **ADMIN/CCO** | liga/desliga |
| `DELETE` | `/automation/:id` | **ADMIN/CCO** | remove |

Mutadores usam `RolesGuard` + `@Roles(ADMIN, CCO)`. `scope(user, q)`: globais veem tudo/filtram; demais travados no próprio tenant. Create resolve tenant server-side.

### `presentation/automation.module.ts`
`imports: [PrismaModule, DevicesModule]`; controller + os 4 services. `AuditService`/`ClusterService`/`MqttService` são globais.

### Integração
- Registrar `AutomationModule` no **array `imports`** do `app.module.ts` (não só o `import`!).
- `DevicesModule` passa a **exportar** `BacnetWriteService`.

---

## 6. FRONTEND — `apps/frontend/src/modules/automation`

> Next.js com breaking changes: consulte `node_modules/next/dist/docs/` se precisar de APIs do Next. Stack: componentes client + React Query + Tailwind (tokens `text-foreground`, `text-muted-foreground`, `border-border`, `bg-white`, `bg-muted`) + `lucide-react`. Cor de destaque: **cyan** (`cyan-600/700`). Cantos `rounded-lg`/`rounded-xl`.

### `types/automation.types.ts`
Espelha o backend: `AutomationMode`, `AutomationTriggerType`, `AutomationActionType`, `AutomationBranch`, `AutomationExecutesOn`, `ConditionOperator`, `ScheduleEntry` (com `endTime?`), `ScheduleTriggerConfig`, `AutomationCondition`, `NotifyConfig`, `AutomationAction`, `Automation`, `AutomationActionInput`, `CreateAutomationInput`, `UpdateAutomationInput`.

### `services/automation.service.ts`
`listAutomations(tenantId?, siteId?)`, `getAutomation`, `createAutomation`, `updateAutomation`, `setAutomationEnabled`, `deleteAutomation` via `apiGet/apiPost/apiPut/apiPatch/apiDelete`. **Adicionar `apiPut` ao `@/lib/api-client`** (espelhando `apiPatch`).

### `hooks/useAutomations.ts`
React Query: `useAutomations(tenantId?, siteId?)` (queryKey `['automations', tenantId, siteId]`), mutations `useCreateAutomation`/`useUpdateAutomation`/`useToggleAutomation`/`useDeleteAutomation` invalidando `['automations']`.

### `pages/automation.page.tsx` (a LISTA)
- Cabeçalho: ícone `Zap` em quadrado `bg-cyan-50`, título "Automações", subtítulo "Regras QUANDO/SE/ENTÃO que comandam os pontos das controladoras", e botão **"Nova automação"** (`bg-cyan-700`, ícone `Plus`) à direita — só ADMIN/CCO.
- `useCurrentUser`, `useTenantFilter`, `useSiteFilter`, `useSites(tenant)`, `useAutomations(tenant, site)`, `useToggle/DeleteAutomation`. `canView` = ADMIN/CCO/SUPERVISOR; `canEdit` = ADMIN/CCO. Se global sem cliente selecionado, desabilita "Nova" e mostra dica "Selecione um cliente no topo".
- Estados: erro (faixa vermelha com dica de migração), loading (skeletons `animate-pulse`), vazio (ícone `Zap` + "Nenhuma automação criada ainda").
- **Cada automação = uma linha** (`rounded-lg border bg-white px-4 py-3`, `flex justify-between`): à esquerda ícone (`Repeat` p/ contínuo / `Calendar` p/ agenda) + nome (truncate) + subtítulo `{site} · {resumo}` (resumo = "Contínuo · reavalia a cada Xs" ou "Agenda · HH:mm"); à direita badge do último resultado (oculto no mobile), **toggle** (pílula `h-6 w-11`, verde=ativo), botões **editar** (`Pencil`) e **excluir** (`Trash2`), cada um `h-9 w-9`.
- **Modal de exclusão** (NÃO `confirm()`): overlay `fixed inset-0 bg-black/50`, card centralizado `max-w-sm rounded-xl`, ícone `AlertTriangle` em círculo vermelho, texto "A automação "nome" será removida…", erro em vermelho se falhar, botões **Cancelar** (borda) e **Excluir** (`bg-red-600`, spinner ao apagar), `h-11 flex-1`. Fecha ao clicar fora ou Cancelar (bloqueado enquanto apaga).

### `components/AutomationDrawer.tsx` (a CRIAÇÃO — painel guiado)

**Formato:** painel lateral que desliza da direita (`fixed inset-0 z-50 flex justify-end`), scrim `bg-black/50 backdrop-blur-[1px]`, painel `w-full sm:max-w-md h-full` (tela cheia no mobile), `overflow-hidden` + conteúdo `overflow-y-auto overflow-x-hidden` (SEM scroll horizontal — todos os campos com `min-w-0`, empilhados). Header fixo ("Nova automação"/"Editar automação" + ✕). Footer fixo (erro em vermelho acima; **Cancelar** + **Salvar automação** com spinner, `h-11`).

Props: `open, automation, tenantId, defaultSiteId, onClose`. Usa `useDevices(tenant)`, `useSites(tenant)`, `useCreate/UpdateAutomation`.

**Fluxo guiado, em linguagem natural, sem jargão QUANDO/SE/ENTÃO:**

1. **Nome** (placeholder "Dê um nome (ex.: Luz do corredor)") + **Site** (`<select>` "Todos os locais do cliente" + sites) — só aparece se houver sites.

2. **Passo 1 — "Quando isso deve acontecer?"** (cabeçalho com bolinha numerada `1` cyan). **Dois cartões de escolha** (um selecionado, com borda/anel cyan e ícone em quadrado cyan):
   - 🕐 **Em horários** — "Nos dias e horas que você escolher" (ícone `Clock`).
   - 📈 **Quando um ponto mudar** — "Reage ao valor de um sensor (ex.: temperatura, falha)" (ícone `Activity`).
   Abaixo, caixa `rounded-xl bg-muted/20`:
   - **Em horários** → editor de agenda: por entrada, **"Ligar às" [time]**, link **"+ desligar em um horário"** que revela **"Desligar às" [time]** (com ✕ para remover); linha de **dias da semana** (7 botões `flex-1`, cyan quando ativo); link "+ outro horário".
   - **Quando um ponto mudar** → "Monitorar o ponto" (`<select>` com todos os pontos, rótulo `Device · Nome (Tipo)`); se digital, botões **"quando ligado" / "quando desligado"**; se analógico, `<select>` de operador **em português** ("for maior que", "for menor que", "for maior ou igual a", "for menor ou igual a", "for igual a", "for diferente de") + número + unidade.

3. **Passo 2 — "O que deve fazer?"** (bolinha `2`). Se não houver ponto gravável, aviso âmbar.
   - **Em horários:** uma lista de ações.
   - **Quando um ponto mudar:** DOIS blocos claros (sem dropdown de ramo): **"Enquanto isso for verdade"** (bolinha verde) e **"Quando voltar ao normal (opcional)"** (bolinha cinza).
   - Cada ação é um card com header ("Comandar ponto" `Power` / "Avisar operador" `Bell`) + ✕ remover; `WRITE_POINT`: `<select>` do ponto gravável + valor (**Ligar/Desligar** se digital; "ajustar para" + número + unidade se analógico); `NOTIFY`: input de mensagem. Botões "comandar ponto" e "avisar" para adicionar.

4. **Resumo em frase (ao vivo)** — caixa `rounded-xl border-cyan-200 bg-cyan-50`, rótulo "EM RESUMO", frase que **atualiza sozinha** descrevendo tudo em português. Ex.:
   - *"De segunda a sexta das 18:00 às 06:00, ligar Luz do corredor (e desliga no término)."*
   - *"Enquanto Temperatura da sala for maior que 25 °C, ligar Ventilador. Quando voltar ao normal, desligar Ventilador."*
   Helpers: `daysText` ("todos os dias"/"de segunda a sexta"/"aos fins de semana"/lista), frase de condição e de ação.

5. **"Opções avançadas"** (colapsável, `Settings2` + `ChevronDown`, fechado por padrão): "Executa na nuvem", "Prioridade" (1–16), e (só contínuo) "Verificar a cada X s".

**Regras da UI:** ao trocar de modo, normaliza o `branch` das ações (ONESHOT→ALWAYS; CONTINUOUS→ON_TRUE, mantendo ON_FALSE). Ao salvar: valida (nome, dias, ponto da condição, ponto/valor das ações, mensagem); monta `triggerConfig` limpando `endTime` vazio; `condition` só em CONTINUOUS; chama create/update e fecha no sucesso (erro em vermelho no footer). Todos os inputs: `h-11`, `text-base sm:text-sm`, `rounded-lg`.

### Rota
`app/(private)/automation/page.tsx` renderiza `AutomationPage`. **Não** editar arquivos de rota do Next além disso.

---

## 7. Fluxo de uso (validação manual)

1. Login ADMIN/CCO → selecionar cliente (e opcionalmente site) no topo.
2. **Automações → Nova automação** → drawer guiado.
3. **Em horários:** "Ligar às 18:00", "+ desligar em um horário" → 06:00, dias Seg–Sex; Passo 2 → "comandar ponto" → escolher saída digital → Ligar. Ver o **resumo** montar a frase. Salvar.
4. **Quando um ponto mudar:** escolher sensor → "for maior que 25"; "Enquanto for verdade" → ligar ventilador; "Quando voltar ao normal" → desligar. Salvar.
5. Testar sem hardware: usar a **Bancada de Pontos Virtuais** do SCADA para injetar valores e ver a automação reagir; cada escrita aparece na **auditoria** (`COMMAND`) com `automationId`.
6. Toggle liga/desliga na lista; lixeira abre o **modal** (não o popup do navegador).

---

## 8. Critérios de aceite

- Migração cria `automations` + `automation_actions` (+ enums); `triggerType` mapeado para `trigger_type`.
- `AutomationModule` registrado no array `imports` do `app.module`; `DevicesModule` exporta `BacnetWriteService`; `apiPut` no api-client.
- `GET /automation` protegido (401 sem token); CRUD 201/200; validação de nome/horário → 400; ponto de outro tenant → 403; escopo por site correto (site + client-wide).
- Agendador só no líder; ONESHOT dispara início e término (reverso de digitais); CONTINUOUS reavalia com skip gracioso e idempotência.
- Seletor lista BACnet+Modbus+MQTT; escrita não-BACnet barrada com erro auditado.
- UI **mobile-first, sem scroll horizontal**; criação guiada em linguagem natural com resumo ao vivo; exclusão via modal.
- `tsc --noEmit` limpo no backend e no frontend.

---

## 9. Fora de escopo (V2)

- **Escrita Modbus/MQTT** (precisa de drivers de escrita no **gateway**).
- **Gatilho por ponto instantâneo/orientado a evento** (via motor de alarmes) — hoje lógica por ponto é o modo `CONTINUOUS` (polling).
- **Execução no EDGE** (campo `executesOn` reservado) para intertravamentos críticos.
- **Notificações externas** (WhatsApp/SendGrid) e **ordem de serviço Infraspeak**.
- **Valor de término para analógicos** (hoje o término reverte só digitais).
