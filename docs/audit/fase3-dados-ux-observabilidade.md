# Auditoria Fase 3 — Integridade de Dados, UX/Acessibilidade, Observabilidade e LGPD

Data: 28/07/2026 · Ambiente: Replit (dev, Postgres gerenciado, EMQX remoto)
Escopo: blocos 6–8 do roteiro + extra de migrações/deploy seguro. **Somente auditoria — nenhuma correção aplicada.**

Legenda: ✅ testado e aprovado · ⚠️ testado, a melhorar · ❌ testado, reprovado · 📋 checklist manual / só verificável em produção

Cópia versionada: `docs/audit/fase3-dados-ux-observabilidade.md` (o diretório `.local` é ignorado pelo git). Evidências dos testes de rede lenta: screenshots do agente de teste (referenciados no texto).

---

## 1. Integridade de dados — timestamps de telemetria

Método: inspeção de código (`trend-recorder.service.ts`, `schema.prisma`) + consulta direta ao banco (`information_schema.columns`, amostras de `trend_records`).

- [x] ✅ **Precisão**: todas as colunas temporais relevantes (`trend_records.timestamp`, `telemetry.recorded_at`, `telemetry.created_at`, `audit_logs.created_at`, `status_events.at`) têm precisão de **milissegundos** (`timestamp(3)`), verificado no banco.
- [x] ✅ **Semântica origem × servidor**: telemetria preserva o timestamp do gateway quando presente e cai para o horário de recepção quando ausente (`trend-recorder.service.ts:77`); `telemetry` separa `recorded_at` (evento) de `created_at` (servidor) — dá para medir atraso de entrega (store-and-forward não adultera a história, já confirmado na fase 2 §5).
- [x] ⚠️ **Colunas são `timestamp WITHOUT time zone`** (não `timestamptz`), verificado via `information_schema`. O Prisma grava sempre em UTC e o banco roda com `TimeZone=GMT`, então na prática tudo é UTC consistente — mas qualquer acesso fora do Prisma (SQL manual, ferramenta de BI, restore em servidor com outro TimeZone) pode reinterpretar os valores. Severidade: **baixa** (convenção sólida, sem enforcement no tipo).
- [x] ✅ **Exibição em fuso**: relatórios e frontend formatam consistentemente em `America/Sao_Paulo` via helper central (auditoria anterior de relatórios; ver memória "Report timezone"), com fim de período inclusivo (`:59.999`).
- [x] 📋 **Clock skew de gateways**: o timestamp de origem confia no relógio do gateway; não há detecção de skew (ex.: descartar/flagar timestamps no futuro ou muito antigos). Um gateway sem NTP grava história deslocada silenciosamente. Só mensurável com frota real. Severidade: **média** (recomendar sanidade ± tolerância na ingestão).

## 2. Integridade de dados — retenção, backup e restore

- [x] ✅ **`trend_records`**: retenção implementada e testável — partições mensais dropadas O(1) quando 100% expiradas; retenção por trend (30/90/365/1825 dias) via DELETE com partition pruning (`trend-retention.service.ts`); rollups horário/diário retidos 2×/4× o raw (mín. 2/5 anos). Leader-guarded e idempotente (fase 2 §3/§4).
- [x] ✅ **`automation_runs`**: retenção de 90 dias aplicada na escrita (`automation-runner.service.ts:232`).
- [x] ✅ **`status_events`**: retenção implementada — purga de eventos com mais de **365 dias**, sweep no máximo 1×/dia, executado só pela instância líder (`availability-recorder.service.ts:258` `purgeOldEvents`, `RETENTION_DAYS = 365`). Ressalvas: (a) o comentário do schema fala em "12 meses", coerente com os 365 dias do código; (b) o DELETE é global (sem tenant scoping — correto para retenção) e O(N) via `deleteMany`, aceitável no volume atual; (c) o sweep roda no caminho de gravação de disponibilidade — se o líder ficar muito tempo sem eventos de disponibilidade, a purga atrasa (efeito prático nulo hoje).
- [x] ❌ **Tabelas sem retenção nenhuma**: `audit_logs`, `alarm_events` e `telemetry` crescem sem limite — nenhum código de purga encontrado (busca por `deleteMany`/`DELETE FROM` nessas tabelas: nada; o único `deleteMany` no módulo de alarmes é o de relação aninhada em `alarm-groups.service.ts:150`, não retenção). Impacto: exaustão de disco/queries degradadas com o tempo + risco LGPD (PII em `audit_logs`, ver §8). Severidade: **alta** (é onde o crescimento é inevitável e silencioso).
- [x] ❌ **Backup/restore: não existe procedimento no repositório** — nenhum script `pg_dump`, nenhum doc de restore, nenhum teste de recuperação (só uma menção a `backups/` para excluí-lo de snapshot). O banco é o Postgres gerenciado do Replit; presume-se snapshot da plataforma, mas **RPO/RTO nunca foram declarados nem testados**. Severidade: **alta**.
- [x] 📋 **Só verificável em produção**: (a) existência/frequência real dos backups da plataforma Replit e restauração ponta-a-ponta (fazer um *restore drill* documentado: restaurar em banco vazio, subir backend apontando para ele, validar login + série de trend); (b) drop de partição em volume real (fase 2 §9.6). Recomendação: versionar um `scripts/backup.sh` (pg_dump -Fc + retenção) e um runbook de restore, mesmo que a plataforma tenha snapshot próprio.

## 3. Migrações e deploy seguro

Método: leitura de `.replit` (deployment), `scripts/build-production.sh`, `scripts/start-production.sh`, `scripts/post-merge.sh`; `prisma migrate status` no dev.

- [x] ✅ **Dev/merge**: `post-merge.sh` roda `npm install` + `prisma migrate deploy` + `prisma generate` e **falha alto** se `DATABASE_URL` ausente — fecha exatamente o buraco histórico de tabelas faltantes/client stale após merge (writes fire-and-forget que falhavam em silêncio). `prisma migrate status` hoje: 30 migrações, schema em dia.
- [x] ✅ **Build de produção**: `build-production.sh` roda `prisma generate` antes do `nest build` — client nunca fica stale no deploy.
- [x] ⚠️ **Migrações em produção dependem do sync de Publish do Replit**, não de `migrate deploy` (removido de propósito do start: conflitava com o diff dev→prod e causava P3009/crash loop — documentado no próprio `start-production.sh`). Consequência: o histórico `_prisma_migrations` de produção não é a fonte de verdade; um rollback de código não tem migração "down" correspondente e o sync só anda para frente. Funciona, mas é implícito. Severidade: **média** (documentar como contrato: nunca rodar `migrate deploy` em prod; toda mudança de schema deve ser aditiva/expand-and-contract).
- [x] ⚠️ **Deploy com clientes online**: VM sempre-ligada com `wait -n` (se um processo cai, o deploy inteiro reinicia — correto), e o seed é idempotente e não sobrescreve senha do admin. Porém a fase 2 §6 já reprovou o **shutdown sujo** (`enableShutdownHooks` ausente): todo deploy derruba conexões WebSocket/HTTP sem drain e sem fechar Prisma/MQTT ordenadamente. Telemetria não se perde (broker + store-and-forward do gateway seguram), mas comandos in-flight morrem sem resposta. Severidade: **alta** (mesmo achado da fase 2, reiterado aqui pela ótica de deploy).
- [x] 📋 **Checklist de deploy/rollback com clientes online** (manual, até automatizar):
  1. Antes: `prisma migrate status` no dev limpo; mudanças de schema **aditivas** (coluna nova nullable/default; nunca drop/rename no mesmo deploy que o código antigo ainda roda).
  2. Publicar fora de horário crítico do CCO; avisar operadores (sessões WebSocket caem no restart).
  3. Depois: validar `GET /health/comms` (MQTT conectado, liderança), login, 1 escrita de comando, chegada de telemetria nova (lastValueAt avançando), e ausência de erros Prisma "column/relation does not exist" no log.
  4. Rollback = republicar o build anterior; **nunca** reverter schema (colunas novas ficam órfãs mas inofensivas se o passo 1 foi respeitado); se uma migração destrutiva escapou, restaurar do backup (ver §2 — hoje sem procedimento testado).

## 4. UI/UX — responsividade e estados por tela

Método: revisão de código do frontend + teste real no navegador (desktop e viewport 390×844) com throttling Slow 3G (agente de teste Playwright).

- [x] ✅ **Loading states**: padrão consistente de skeletons `animate-pulse`/spinners nas telas principais (alarms, dashboard, trends); sob Slow 3G o usuário sempre viu skeleton em vez de tela branca (testado em /alarms, /trends, /dashboard).
- [x] ✅ **Responsividade**: sidebar vira drawer com hambúrguer <768px (`sidebar.tsx`, matchMedia); em 390×844 /dashboard e /alarms ficaram usáveis, sem overflow horizontal, cards empilhando corretamente (screenshots p9iwzq, f5wej1).
- [x] ⚠️ **Tabelas sem scroll horizontal em todas**: `DeviceAreaTable` tem `overflow-x-auto`, mas `GatewaysHealthTable.tsx:90` não tem container de scroll — quebra provável em telas estreitas. Severidade: **baixa**.
- [x] ⚠️ **Estados de erro/vazio desiguais**: alarms tem banner de erro formal (bg-red-50 + ícone); `scada-viewer.page.tsx:120` mostra só texto solto; `cftv.page.tsx` sem empty state explícito (grid vazio sem mensagem quando não há câmeras). Severidade: **baixa/média** (padronizar componente de erro/vazio).
- [x] ⚠️ **Sem sistema global de toast/feedback**: erros aparecem em banners locais ou blocos do modal; sucesso nem sempre tem confirmação visual. (O SCADA tem toast próprio via editor.store — não é global.) Severidade: **baixa**.
- [x] ✅ **Clareza de mensagens**: pt-BR consistente; erros técnicos traduzidos com contexto (`translateDeviceError` inclui IP/porta); timeout de comando vira mensagem clara ("Timeout - gateway nao respondeu em 20s" — falta acento em "não", cosmético).

## 5. Acessibilidade básica

- [x] ✅ **Labels/aria**: botões só-ícone com `aria-label` nos pontos verificados (toggle de senha, ações do Topbar); navegação por Tab percorre os controles e abre o modal de detalhes com Enter.
- [x] ❌ **Modais sem contrato de teclado**: no modal de detalhes de alarme, **Escape não fecha** e **o foco não fica preso** (Tab vaza para a tabela por baixo do modal) — testado no navegador. Sem primitiva compartilhada de dialog (focus trap/Escape/retorno de foco). Severidade: **média** (afeta todos os modais; corrigir na primitiva, não tela a tela).
- [x] ⚠️ **`focus-visible` não estilizado** na maioria dos componentes (depende do default do navegador — em alguns temas o anel é quase invisível sobre fundo escuro). Severidade: **baixa**.
- [x] ⚠️ **Cor como único indicador** em vários badges de status; os principais (AlarmBadge, cards) complementam com texto/ícone, mas não é regra auditada em todas as telas. Contraste dos temas claro/escuro não foi medido instrumentalmente (📋 rodar axe/Lighthouse por tela na fase de correção). Severidade: **baixa**.

## 6. Fluxos críticos do CCO em rede lenta (Slow 3G: 400 ms latência, 400 kbps)

Método: Playwright + CDP `emulateNetworkConditions`, login admin real, gateway offline (condição real do ambiente).

- [x] ✅ **Ver trend**: spinner → shell → estado vazio explícito ("0 registros no período"); UI responsiva o tempo todo, sem tela branca/congelada (screenshots 6ifqsp…l6kgj8).
- [x] ✅ **Enviar comando** (/cco/commands, ponto BACnet gravável, gateway offline): botão vira "Enviando…" desabilitado (proteção de duplo clique), aguarda o timeout de 20 s e mostra erro pt-BR claro; botão reabilita — sem hang, sem falha silenciosa (screenshots bfipus, ccedcj, 5mjqeh).
- [x] ⚠️ **Reconhecer alarme**: **não foi possível reconhecer um alarme ATIVO pela UI** — o frontend só expõe ACK para `NORMALIZED_UNACK` (`AlarmEventsTable.tsx:33` `PENDING_ACK = ['NORMALIZED_UNACK']`), enquanto o backend suporta ACK de ativo (transição `ACTIVE → ACTIVE_ACK` existe em `alarm-events.service.ts:12` e o estado tem até badge "Ativo · reconhecido" na UI). Com 4 alarmes ACTIVE na tela, a única ação era "Detalhes"; checkbox de seleção desabilitado; sino vazio. Prática comum de CCO é reconhecer o alarme *enquanto ativo* para sinalizar "estou ciente/atuando" — hoje o operador só consegue após normalizar. O teste de duplo-submit do ACK ficou pendente por isso (📋 repetir quando houver item `NORMALIZED_UNACK`; a proteção existe por código: `isPending`/`bulkPending` desabilitam o botão, mesmo padrão validado no comando). Severidade: **média** (decisão de produto a confirmar; se intencional, documentar).
- [x] ✅ **Percepção geral sob Slow 3G**: nenhuma tela quebrou, todos os estados intermediários comunicados; app utilizável (lento, mas honesto).

## 7. Observabilidade e operação

- [x] ⚠️ **Logging**: NestJS Logger texto puro no stdout; produção silencia debug/verbose (correto para volume MQTT). **Sem JSON estruturado, sem request-ID/correlação** — correlacionar uma requisição com um erro de banco ou falha MQTT exige casar horários manualmente. Severidade: **média**.
- [x] ✅ **Métricas de domínio**: `/health/comms` (MQTT, liderança, contadores de ingestão — bateram exatamente com o publicado na fase 2), `health/broker` (stats EMQX), `health/storage` (uso de disco por tabela vs. quota), `cluster/status` (instância/líder). Cobertura boa do que é específico do BlueBee.
- [x] ⚠️ **Sem métricas de processo/HTTP** (Prometheus/OTel ausentes): latência por endpoint, taxa de erro 5xx, RSS/CPU, pool do Prisma — nada exportado. Diagnosticar "está lento" em produção é praticamente impossível hoje. Tracing: inexistente. Severidade: **média**.
- [x] ⚠️ **Sem sink de erros** (Sentry/afim) e **sem filtro global de exceção**: 500 vai para o stdout do Replit e some no scroll; erros de background (fire-and-forget da ingestão, automações) viram só `logger.error` — se ninguém olha o log, é perda silenciosa (fase 2 §2 já apontou o caminho da ingestão). Severidade: **média**.
- [x] ✅ **Alertas para o operador**: EMQXMonitor (leader-only, com histerese/cooldown) gera AUTOMATION_NOTICE no sino para broker anormal; LWT+heartbeat marca gateway offline; saúde de câmera via STATUS. O que o *operador* precisa ver chega na UI.
- [x] ⚠️ **Alertas para o *time*** (fora da UI): nenhum — incidente às 3h só é visto se alguém estiver com o CCO aberto. Sem e-mail/webhook/pager. Severidade: **média**.
- [x] ⚠️ **Liveness/readiness**: ausentes (fase 2 §6 — `/health/comms` responde 200 mesmo degradado). Reiterado.
- [x] 📋 **Veredito honesto — "dá para diagnosticar um incidente em produção hoje?"**: *parcialmente*. O **quê** (ações de usuário, avisos de sistema) está bem coberto por `audit_logs` + `alarm_events`; o **porquê/onde** (request lento, erro intermitente, gargalo) não — sem request-ID, sem métricas de latência, sem sink de erro. Mínimo recomendado na correção: logs JSON + request-ID, contador/histograma HTTP por rota, e um canal de alerta externo (e-mail/webhook) para erro crítico e broker down.

## 8. LGPD — dados pessoais e minimização

- [x] ✅ **Senhas**: bcrypt no banco; nunca logadas nem auditadas (interceptor ignora `req.body`; só captura campos específicos não sensíveis); provisioning EMQX não loga senha gerada.
- [x] ✅ **Inventário de PII é pequeno**: nome, e-mail, role (users); nome/e-mail snapshot + IP + user-agent (audit_logs); credenciais de câmera cifradas AES-GCM (decifradas só no config MQTT). Minimização razoável por design.
- [x] ⚠️ **IP bruto em `audit_logs`**, mascarado só na exibição (`maskIp`). Combinado com a **ausência de retenção em `audit_logs`** (§2), PII (e-mail snapshot + IP) persiste para sempre, inclusive de usuários já excluídos (hard delete do usuário não anonimiza a trilha). Trilha de auditoria é interesse legítimo, mas LGPD pede prazo definido: fixar retenção (ex.: 2–5 anos) e/ou anonimizar IP após N meses. Severidade: **média**.
- [x] ⚠️ **Sem fluxo de direitos do titular**: nenhum endpoint/procedimento de exportação ou eliminação/anonimização de dados de um usuário (art. 18). Para B2B com poucos usuários é executável manualmente, mas não há runbook. Severidade: **baixa/média**.
- [x] ⚠️ **Base de conhecimento (PDFs)**: flag `anonymized` é manual, sem varredura de PII no conteúdo ingerido. Severidade: **baixa** (processo, não código).
- [x] 📋 **Só verificável em produção**: logs do VM Replit (o que a plataforma retém e por quanto tempo), e conteúdo real já ingerido na base de conhecimento.

## 9. Compatibilidade entre navegadores — checklist manual 📋

Automatizado só em Chromium (Playwright). Testar manualmente por release, nos dois temas:

| Verificação | Chrome | Edge | Firefox | Safari (macOS/iOS) |
|---|---|---|---|---|
| Login + sessão (cookie `bluebee_session`; atenção SameSite/ITP no Safari) | ☐ | ☐ | ☐ | ☐ |
| WebSocket (telemetria ao vivo + sino) atrás do proxy | ☐ | ☐ | ☐ | ☐ |
| SCADA canvas (render, zoom, drag, fullscreen — portais/fullscreen já têm pegadinha conhecida em headless) | ☐ | ☐ | ☐ | ☐ |
| Gráficos de trend + labels HTML sobrepostos ao SVG | ☐ | ☐ | ☐ | ☐ |
| `datetime-local` dos relatórios (renderização difere por engine) | ☐ | ☐ | ☐ | ☐ |
| Selects nativos no tema escuro (`color-scheme`) | ☐ | ☐ | ☐ | ☐ |
| Download de PDF/CSV | ☐ | ☐ | ☐ | ☐ |
| Mobile: drawer, tabelas, PWA/instalação (ícone é task futura) | ☐ | — | ☐ | ☐ |

## 10. Consolidado de severidades

| # | Achado | Severidade |
|---|---|---|
| 1 | `audit_logs`/`alarm_events`/`telemetry` sem retenção (crescimento ilimitado + PII eterna em audit_logs) — `status_events` e `trend_records` têm retenção OK | **Alta** |
| 2 | Nenhum procedimento de backup/restore versionado ou testado (RPO/RTO indefinidos) | **Alta** |
| 3 | Deploy derruba clientes sem drain (shutdown sujo — reiterado da fase 2) | **Alta** |
| 4 | Modais sem Escape/focus trap (primitiva de dialog ausente) | Média |
| 5 | ACK indisponível para alarme ATIVO na UI (backend suporta ACTIVE_ACK) | Média |
| 6 | Logs sem estrutura/request-ID; sem métricas HTTP/processo; sem sink de erro; sem alerta externo ao time | Média |
| 7 | PII (IP bruto + e-mail snapshot) sem prazo de retenção; sem fluxo de direitos do titular | Média |
| 8 | Migração de prod implícita via Publish sync (contrato não documentado; só-aditivo obrigatório) | Média |
| 9 | Sem detecção de clock skew de gateway na ingestão | Média |
| 10 | Colunas `timestamp` sem time zone (convenção UTC não imposta pelo tipo) | Baixa |
| 11 | Estados de erro/vazio desiguais (SCADA viewer, CFTV); sem toast global; tabela sem scroll-x | Baixa |
| 12 | `focus-visible` não estilizado; contraste não medido instrumentalmente | Baixa |
| 13 | Flag `anonymized` manual na base de conhecimento | Baixa |

---
*Nenhuma alteração de código ou de dados foi feita: o comando de teste expirou por timeout no gateway offline (sem escrita) e nenhum alarme foi reconhecido (a UI não expõe ACK para os ATIVOS existentes).*
