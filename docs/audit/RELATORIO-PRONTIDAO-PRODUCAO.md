# BlueBee IoT — Relatório Consolidado de Prontidão para Produção

Data: 28/07/2026 · Auditoria fases 1–4 · Ambiente auditado: Replit (dev/prod VM), Postgres gerenciado, EMQX remoto (`mqtt.bluebee.ia.br`)
**Somente auditoria — nenhuma correção foi aplicada.** A fase de correção é separada e depende de aprovação.

## Índice dos documentos das fases

| Fase | Escopo | Documento |
|---|---|---|
| 1 | Multi-tenant e segurança (blocos 1–3) | ⚠️ Documento detalhado **não preservado** — vivia só em `.local/audit/` (ignorado pelo git) e foi perdido em um reset do ambiente. Os achados duráveis foram reconstruídos abaixo (§2, prefixo F1) a partir da memória do projeto e das referências cruzadas das fases 2–3. Recomenda-se re-executar os testes práticos de IDOR antes do go-live para regenerar as evidências. |
| 2 | Carga, performance e resiliência (blocos 4–5) | [`docs/audit/fase2-carga-resiliencia.md`](../../docs/audit/fase2-carga-resiliencia.md) (+ harness reproduzível em `docs/audit/harness/`) |
| 3 | Dados, UX/acessibilidade, observabilidade e LGPD (blocos 6–8) | [`docs/audit/fase3-dados-ux-observabilidade.md`](../../docs/audit/fase3-dados-ux-observabilidade.md) |
| 4 | Este relatório consolidado | `.local/audit/RELATORIO-PRONTIDAO-PRODUCAO.md` (cópia versionada em `docs/audit/RELATORIO-PRONTIDAO-PRODUCAO.md`) |

---

## 1. Resumo executivo

### Nota geral de prontidão: **6,5 / 10**

O BlueBee está **apto a continuar operando com o tenant atual** e tem fundações sólidas: isolamento multi-tenant por JWT com salas Socket.IO por tenant, sessão em cookie HttpOnly, deletes críticos com reconfirmação de senha, particionamento + retenção de `trend_records`, ingestão MQTT sem perda até ~920 pontos/s medidos, e trilha de auditoria abrangente. **Não está pronto para abrir a porta a muitos clientes** sem corrigir os bloqueadores abaixo: qualquer tentativa de escalar horizontalmente hoje **corrompe dados** (duplicação de trends e alarmes), não existe backup/restore testado, três tabelas centrais crescem sem limite, e não há quotas por tenant nem observabilidade suficiente para diagnosticar incidentes.

### Os 5 riscos mais críticos

1. **Escala horizontal corrompe dados (CRÍTICO)** — com ≥2 instâncias do backend, a ingestão MQTT grava trends **exatamente em dobro** e o motor de alarmes cria **ocorrências duplicadas** da mesma regra (confirmado empiricamente na fase 2 §4). Hoje o sistema só pode rodar com 1 instância — o que também é o teto de crescimento.
2. **Sem backup/restore testado (ALTO)** — nenhum script, runbook ou drill de restauração; RPO/RTO indefinidos. Um incidente de dados hoje é potencialmente irrecuperável do ponto de vista operacional (fase 3 §2).
3. **Crescimento ilimitado + PII eterna (ALTO)** — `audit_logs`, `alarm_events` e `telemetry` não têm nenhuma retenção; `audit_logs` guarda IP bruto e e-mail para sempre, inclusive de usuários excluídos (risco LGPD) (fase 3 §2/§8).
4. **Sem quotas por tenant / noisy neighbor (MÉDIO, agrava com N clientes)** — um único tenant pode consumir CPU/banco de todos via flood MQTT, criação ilimitada de trends/regras, ou relatórios sem `take` sobre períodos longos (fase 2 §7). O rate limit HTTP é por IP, não por tenant.
5. **Operação às cegas (MÉDIO)** — deploy derruba clientes sem drain (`enableShutdownHooks` ausente), sem logs estruturados/request-ID, sem métricas HTTP/processo, sem sink de erros e sem alerta externo ao time — incidente às 3h só é visto se alguém estiver com o CCO aberto (fases 2 §6 e 3 §7).

---

## 2. Tabela consolidada de achados

Severidades: **CRÍTICO** / **ALTO** / **MÉDIO** / **BAIXO**. Esforço: P (≤½ dia), M (1–3 dias), G (≥1 semana).

### Fase 1 — Multi-tenant e segurança (achados reconstruídos)

| ID | Categoria | Sev. | Descrição | Evidência | Impacto com muitos clientes | Correção recomendada | Esforço |
|---|---|---|---|---|---|---|---|
| F1-01 | Segurança | ALTO | Bloqueio de tentativas de senha (login e confirm-password: 5 erros/5 min) é **em memória por processo** — zera em restart e é contornável alternando instâncias | Guard de lockout in-memory (confirm-password e login); reiterado na fase 2 §4 "estado em memória por instância" | Brute force viável em janela de deploy/restart; inconsistente em multi-instância | Persistir lockout no Postgres (tabela ou coluna em users) com TTL | P–M |
| F1-02 | Segurança | ALTO | Sem fluxo de recuperação de senha; usuários legados migrados do Supabase **não têm passwordHash local** (não conseguem logar nem confirmar deletes críticos) | `confirm-password` retorna 400 explícito p/ usuário sem hash; migração do Supabase documentada | Onboarding/offboarding de usuários de clientes trava em suporte manual | Reset por e-mail + senha temporária pelo admin (já proposto como tarefa) | M |
| F1-03 | Segurança | MÉDIO | Rate limit HTTP por **IP** (XFF), não por usuário/tenant — clientes atrás do mesmo NAT compartilham o balde de 600/min; tenant agressivo não tem teto próprio | `global-throttler.guard.ts` (tracker XFF); fase 2 §1/§7 | Um cliente pode gerar 429 para outro no mesmo IP corporativo; sem contenção por tenant | Throttle adicional por usuário autenticado/tenant | M |
| F1-04 | Segurança | MÉDIO | Interceptor de auditoria usa **allowlist explícita** de rotas — rota mutante nova NÃO é auditada automaticamente (falha silenciosa de cobertura) | `audit.interceptor.ts` (allowlist) | Lacunas de trilha de auditoria crescem com o produto | Teste automatizado que compara rotas mutantes × allowlist; ou default-on com opt-out | P–M |
| F1-05 | Multi-tenant | — (aprovado) | Isolamento: tenantId sempre derivado do JWT; salas Socket.IO por tenant com desconexão via canal de cluster; tenants inativos bloqueados em login+JWT+socket; feeds globais excluem inativos | jwt.strategy (403 TENANT_INACTIVE); gateway Socket.IO (rooms `tenant:{id}`) | — | Manter testes de regressão (tarefas já propostas) | — |
| F1-06 | Segurança | — (aprovado) | Sessão só em cookie HttpOnly/Secure/SameSite; Helmet + CORS centralizado env-driven; deletes críticos exigem reconfirmação de senha (token 5 min); senhas nunca logadas/auditadas | `session-cookie.ts`; `cors.util.ts`; `SensitiveActionGuard` | — | — | — |
| F1-07 | MQTT/EMQX | — (aprovado c/ ressalva) | Credencial MQTT por gateway + ACL por tópico no EMQX (gateway não publica em tópico de outro tenant); flood exige gateway comprometido | Provisionamento EMQX (ACL via API, username no body) | Ressalva: robustez da ingestão contra payload malicioso deve ser re-testada junto com o re-teste de IDOR | Re-executar bateria prática da fase 1 (evidências perdidas) | M |

> **Nota:** os testes práticos da fase 1 (IDOR com 2 tenants sintéticos, escalonamento de privilégio por role, payload MQTT malicioso, npm audit) foram executados, mas as evidências detalhadas se perderam com o documento. Os itens estruturais acima são verificáveis no código; a **re-execução da bateria prática entrou no plano (§4) como pré-requisito de go-live**.

### Fase 2 — Carga, performance e resiliência

| ID | Categoria | Sev. | Descrição | Evidência | Impacto com muitos clientes | Correção recomendada | Esforço |
|---|---|---|---|---|---|---|---|
| F2-01 | Resiliência | **CRÍTICO** | Trends gravados **em dobro** com ≥2 instâncias — ingestão MQTT sem guarda de líder | Teste: 140 msgs → 11 200 registros (2× exato); `bacnet-mqtt.subscriber.ts:248` | Bloqueia escala horizontal; dados adulterados (médias/rollups) | Guardar ingestão stateful por liderança ou particionar tópicos; revalidar com 2 instâncias reais | M |
| F2-02 | Resiliência | **CRÍTICO** | Ocorrências de alarme **duplicadas** com ≥2 instâncias (serialização por regra é local à instância) | Teste: 2 ACTIVE + 2 NORMALIZED_UNACK simultâneos p/ mesma regra | Notificações em dobro, trilha adulterada | Mesma guarda de líder do F2-01 (motor de alarmes) | M |
| F2-03 | Resiliência | ALTO | `enableShutdownHooks` ausente — SIGTERM mata o processo sem fechar Prisma/MQTT/cluster; todo deploy é queda suja | `main.ts`; teste SIGTERM sem log de shutdown | Deploys frequentes com N clientes = comandos in-flight mortos, WebSockets derrubados sem drain | 1 linha + drain básico | P |
| F2-04 | Performance | MÉDIO | Ingestão→Prisma fire-and-forget, sem fila/backpressure/retry — PG degradado = perda silenciosa; avalanche = risco de OOM | `trend-recorder.service.ts:109` | Reconexão de N gateways (até 10k msgs cada) em rajada amplifica | Fila interna com limite + retry com backoff e descarte observável | M |
| F2-05 | Performance | MÉDIO | Relatórios/exports sem `take` — período longo em tenant grande carrega milhões de linhas em memória | `reports.service.ts:318/448/692`, `availability.service.ts:145`, `trends.service.ts:331` | 1 relatório grande degrada o processo p/ todos os tenants | `take` máximo + paginação/streaming | M |
| F2-06 | Performance | MÉDIO | Pool Prisma default sem `connection_limit` (+1 conexão dedicada do ClusterService por instância); `max_connections`=112 | Fase 2 §3; uso sob carga ~17 | 4+ instâncias em máquinas com muitos cores estouram o limite do Postgres | `connection_limit` explícito na URL, dimensionado por instância | P |
| F2-07 | Performance | MÉDIO | `/dashboard/overview` satura em ~320–360 RPS (9–11 queries/request, sem cache) | autocannon: RPS flat c=25→100, p50 74→273 ms; `dashboard.controller.ts:139` | Polling de muitos usuários × tenants encosta cedo no teto | Cache curto (2–5 s) por tenant | P–M |
| F2-08 | Performance | MÉDIO | Sem quotas por tenant (flood MQTT, nº ilimitado de trends/regras/pontos, relatórios pesados) | Fase 2 §7 (vetores confirmados) | Noisy neighbor: 1 tenant consome recursos de todos | Limites por tenant no CRUD + teto de pts/min por gateway + métricas por tenant | M–G |
| F2-09 | Resiliência | MÉDIO | Avalanche de reconexão: cada gateway drena até 10k msgs em loop apertado; broker aplica flood-kick (ECONNRESET observado) | `gateway-mqtt.service.ts:301`; teste fase 2 §2 | Queda do broker com frota grande = tempestade de rajadas + gateways legítimos derrubados | Drenagem com pacing no gateway + backpressure no backend | M |
| F2-10 | Resiliência | MÉDIO | Estado em memória por instância: progress maps (scan/OTA/PDF), `pendingWrites`, lockout, `lastSeen` | Fase 2 §4 | Multi-instância: progresso invisível, lockout contornável | Mover p/ Postgres ou fixar afinidade; já parcialmente mitigado (progress polled com done em toda instância p/ SNMP) | M |
| F2-11 | Performance | BAIXO | `Device` sem índice em `tenant_id`; `DevicePoint` sem tenantId (filtro via join) | `schema.prisma:161-182` | Listagens lentas com 100× tenants | Migração aditiva de índice/coluna | P |
| F2-12 | Resiliência | BAIXO | `OnvifPendingValidation` roda em toda instância (probes redundantes) | Fase 2 §4 | Desperdício, não corrupção | Guarda de líder | P |
| F2-13 | Observabilidade | BAIXO | Sem liveness/readiness separados (`/health/comms` responde 200 mesmo degradado) | Fase 2 §6 | Orquestrador/monitor externo não detecta degradação | Endpoints Terminus-style | P |

### Fase 3 — Dados, UX, observabilidade e LGPD

| ID | Categoria | Sev. | Descrição | Evidência | Impacto com muitos clientes | Correção recomendada | Esforço |
|---|---|---|---|---|---|---|---|
| F3-01 | Dados | ALTO | `audit_logs`, `alarm_events`, `telemetry` **sem nenhuma retenção** (crescimento ilimitado); `trend_records`/`status_events`/`automation_runs` têm retenção OK | Fase 3 §2 (busca por purga: nada) | Exaustão de disco e queries degradadas — inevitável e silencioso com N clientes | Retenção leader-guarded (ex.: telemetry 90d, alarm_events 2a, audit_logs 2–5a c/ anonimização) | M |
| F3-02 | Dados | ALTO | Nenhum procedimento de backup/restore versionado ou testado; RPO/RTO indefinidos | Fase 3 §2 (nenhum script/runbook no repo) | Perda de dados de clientes potencialmente irrecuperável | `scripts/backup.sh` (pg_dump -Fc + retenção) + runbook + restore drill documentado | M |
| F3-03 | Resiliência | ALTO | Deploy derruba clientes sem drain (mesmo achado F2-03, pela ótica de deploy) | Fase 3 §3 | Idem F2-03 | Idem F2-03 | P |
| F3-04 | UX/A11y | MÉDIO | Modais sem Escape/focus trap (sem primitiva compartilhada de dialog) | Testado no navegador (modal de alarme) | Acessibilidade e produtividade do CCO | Corrigir na primitiva, não tela a tela | M |
| F3-05 | UX | MÉDIO | UI não permite ACK de alarme **ATIVO** (só `NORMALIZED_UNACK`), embora o backend suporte `ACTIVE→ACTIVE_ACK` | `AlarmEventsTable.tsx:33`; `alarm-events.service.ts:12` | Prática comum de CCO ("estou ciente") indisponível | Decisão de produto: liberar ACK de ativo ou documentar como intencional | P |
| F3-06 | Observabilidade | MÉDIO | Logs sem estrutura/request-ID; sem métricas HTTP/processo (Prometheus/OTel); sem sink de erros; sem alerta externo ao time | Fase 3 §7 | Diagnosticar "está lento"/incidente noturno é praticamente impossível | Logs JSON + request-ID; histograma HTTP por rota; canal e-mail/webhook p/ erro crítico e broker down | M–G |
| F3-07 | LGPD | MÉDIO | PII eterna em `audit_logs` (IP bruto + e-mail snapshot, inclusive de usuários excluídos); sem fluxo de direitos do titular (art. 18) | Fase 3 §8 | Passivo LGPD cresce com cada cliente | Retenção/anonimização (junto com F3-01) + runbook de exportação/eliminação | M |
| F3-08 | Dados | MÉDIO | Migração de prod é implícita via Publish sync do Replit (nunca `migrate deploy`); contrato "só aditivo" não documentado formalmente | `scripts/start-production.sh` (comentado) | Migração destrutiva acidental = crash loop/perda em prod | Documentar contrato expand-and-contract + checklist de deploy (fase 3 §3 já propõe) | P |
| F3-09 | Dados | MÉDIO | Sem detecção de clock skew de gateway — timestamp de origem confia no relógio remoto | `trend-recorder.service.ts:77` | Gateway sem NTP grava história deslocada silenciosamente | Sanidade ± tolerância na ingestão, flag/descarte observável | P–M |
| F3-10 | Dados | BAIXO | Colunas `timestamp` sem time zone (UTC só por convenção Prisma/banco GMT) | `information_schema` verificado | BI/SQL manual pode reinterpretar | Documentar; migrar p/ timestamptz no longo prazo | P/G |
| F3-11 | UX | BAIXO | Estados de erro/vazio desiguais (SCADA viewer, CFTV); sem toast global; `GatewaysHealthTable` sem scroll-x | `scada-viewer.page.tsx:120`; `GatewaysHealthTable.tsx:90` | Percepção de qualidade | Componente padrão de erro/vazio + toast global | M |
| F3-12 | UX/A11y | BAIXO | `focus-visible` não estilizado; contraste não medido instrumentalmente | Fase 3 §5 | Acessibilidade | axe/Lighthouse por tela na correção | P–M |
| F3-13 | LGPD | BAIXO | Flag `anonymized` manual na base de conhecimento (sem varredura de PII) | Fase 3 §8 | Processo, não código | Procedimento de revisão no upload | P |

---

## 3. Resultados dos testes de carga (consolidado da fase 2)

Ambiente: CPU compartilhada do Replit, banco pequeno — números são **piso conservador de comportamento**, não capacidade absoluta. Percentis reais do autocannon (p50/p90/p97.5/p99 — ele não expõe p95).

### HTTP (instância dedicada, throttle desativado)

| Endpoint | Conexões | p50 | p97.5 | p99 | RPS | Erros |
|---|---|---|---|---|---|---|
| `GET /dashboard/overview` | 10 | 27 ms | 44 ms | 53 ms | 346 | 0 |
| `GET /alarm-events?pageSize=50` | 10 | 21 ms | 33 ms | 37 ms | 446 | 0 |
| `GET /trends/:id/data` | 10 | 12 ms | 21 ms | 26 ms | 774 | 0 |
| `GET /trends/history` (5 ids) | 10 | 15 ms | 41 ms | 78 ms | 536 | 0 |
| `GET /dashboard/overview` | 100 | 273 ms | 319 ms | 340 ms | 362 | 0 |

- **Ponto de saturação**: o dashboard satura em **~320–360 RPS** já a partir de c=10; acima disso o throughput fica flat e só a latência cresce (CPU-bound, 9–11 queries/request sem cache).
- **Login**: throttle 10/min corta flood antes do bcrypt (73 547× 429 com p50 de 0 ms) — sem vetor de exaustão de CPU. Login legítimo: 99–122 ms.

### Ingestão MQTT

- **Zero perda até ~920 pontos/s efetivos sustentados** (29 000 pontos publicados = 29 000 gravados; pico 32 372 pts/min em `/health/comms`); o ponto de saturação da ingestão não foi alcançado — o broker aplicou flood-kick (~25 msg/s por cliente) antes.
- Idempotência: telemetria duplicada é absorvida pelo deadband ON_CHANGE (1× exato).
- Uso de recursos sob carga: ~17 conexões Postgres (de 112); CPU do processo foi o gargalo do HTTP, não o banco.

### Estimativa de quebra com N tenants

Com 1 instância e o perfil atual (polling de dashboard ~1 req/2 s por usuário ativo):
- **~600–700 usuários simultâneos ativos** esgotam os ~330 RPS do dashboard (o primeiro teto; cache de 2–5 s multiplica esse teto por ~10×).
- **Ingestão**: 920 pts/s ≈ **200–450 gateways** publicando 2–5 msg/s — acima disso é território não medido (sem fila/backpressure, F2-04, o risco não é latência e sim perda/OOM).
- **Conexões de banco**: irrelevante com 1 instância; com 4+ instâncias sem `connection_limit`, estoura o `max_connections`=112 (F2-06) — e multi-instância está **bloqueada** por F2-01/F2-02 de qualquer forma.
- Conclusão prática: **o teto de crescimento hoje é a instância única**. Os bloqueadores de multi-instância precisam ser corrigidos antes de qualquer projeção acima dos números acima. Metodologia completa para repetir em staging com frota simulada: fase 2 §9.

---

## 4. Plano de correção priorizado

### Bloqueadores — corrigir ANTES de aceitar novos clientes

1. **Backup/restore** (F3-02): script versionado + runbook + restore drill documentado. *Sem isso, cada cliente novo aumenta um passivo irrecuperável.*
2. **Retenção de `audit_logs`/`alarm_events`/`telemetry`** (F3-01, F3-07): purga leader-guarded com prazos definidos + anonimização de IP. 
3. **Graceful shutdown** (F2-03/F3-03): `enableShutdownHooks()` + drain básico.
4. **Re-executar a bateria prática da fase 1** (F1-07/nota): IDOR com 2 tenants sintéticos, escalonamento de privilégio, payload MQTT malicioso, npm audit — e desta vez versionar as evidências em `docs/audit/`.
5. **Lockout de senha persistente** (F1-01) e **recuperação de senha** (F1-02): pré-requisito para onboarding de usuários de clientes reais.
6. **`take` máximo em relatórios/exports** (F2-05): proteção mínima contra o vetor mais fácil de derrubar o processo.

### Curto prazo (primeiras semanas com clientes novos)

7. **Guarda de líder na ingestão e no motor de alarmes** (F2-01/F2-02) + revalidação com 2 instâncias — destrava a escala horizontal antes que ela seja necessária.
8. **Cache curto no dashboard** (F2-07) e **`connection_limit` explícito** (F2-06).
9. **Backpressure/retry na ingestão** (F2-04) + pacing no drain do store-and-forward (F2-09).
10. **Observabilidade mínima** (F3-06, F2-13): logs JSON + request-ID, métricas HTTP, liveness/readiness, alerta externo (e-mail/webhook) p/ erro crítico e broker down.
11. **Quotas por tenant — fase 1** (F2-08, F1-03): limites de contagem no CRUD (trends/regras/pontos) + throttle por usuário autenticado.
12. **Contrato de migração de prod documentado** (F3-08) + checklist de deploy da fase 3 §3.
13. **Decisão de produto sobre ACK de alarme ativo** (F3-05) e **primitiva de dialog com Escape/focus trap** (F3-04).

### Longo prazo (melhorias estruturais)

14. **Quotas por tenant — fase 2**: teto de pts/min por gateway na ingestão com descarte observável + métricas de ingestão por tenant.
15. **Índices tenant-first faltantes** (F2-11) e migração gradual para `timestamptz` (F3-10).
16. **Estado por instância → Postgres** (F2-10) para multi-instância plena; failover testado com kill do líder (fase 2 §9.5).
17. **Detecção de clock skew** (F3-09); **fluxo de direitos do titular LGPD** (F3-07); padronização de estados de erro/vazio + toast global (F3-11); auditoria automatizada de allowlist do audit trail (F1-04).
18. **Campanha de carga em staging** conforme metodologia da fase 2 §9 (frota simulada de 200–500 gateways, queda real de PG/EMQX, 3 instâncias com failover).

---

## 5. Recomendações de arquitetura para escalar com segurança

- **Pool de conexões**: `connection_limit` explícito na `DATABASE_URL` por instância (ex.: 10–15), reservando margem para a conexão dedicada do ClusterService e ferramentas; considerar PgBouncer (transaction pooling) quando passar de ~4 instâncias. `max_connections`=112 é o orçamento total.
- **Escala horizontal**: só após F2-01/F2-02. Modelo recomendado: ingestão MQTT e motores stateful **exclusivos do líder** (advisory lock já existe e funciona) e HTTP em todas as instâncias; evolução futura: particionar tópicos MQTT por hash de tenant entre instâncias.
- **Read replicas**: ainda não necessárias (gargalo atual é CPU do processo, não o banco). Ficam relevantes quando relatórios/exports pesados conviverem com ingestão alta — direcionar relatórios para réplica de leitura.
- **Rate limiting/quotas**: manter o throttle por IP (XFF), adicionar camada por usuário autenticado e limites por tenant (contagem de recursos no CRUD + pts/min por gateway com descarte observável + `take` máximo em relatórios).
- **Particionamento**: `trend_records` já é particionado mensalmente com retenção O(1) — estender o padrão a `telemetry` e `alarm_events` quando a retenção (F3-01) for implementada, para que a purga seja drop de partição e não DELETE.
- **Cache**: começar simples — cache in-memory por tenant de 2–5 s no `/dashboard/overview` (multiplicaria o teto de ~330 RPS por ~10×). Redis só se/quando houver multi-instância com necessidade de cache compartilhado (hoje a coordenação é 100% Postgres, um serviço a menos para cair — manter assim enquanto possível).
- **Hardening de EMQX**: manter credencial + ACL por gateway (já aprovado na fase 1); adicionar: limites de taxa por cliente configurados conscientemente (o flood-kick atual é implícito), monitoramento já existente (EMQXMonitor) complementado por alerta externo ao time, revisão periódica de credenciais órfãs no offboarding de tenants, e TLS obrigatório nos listeners expostos.
- **Deploy**: shutdown gracioso + drain; mudanças de schema sempre aditivas (expand-and-contract) com o checklist da fase 3 §3; rollback = republicar build anterior, nunca reverter schema.

---

## 6. Checklist go/no-go para liberar entrada de clientes

**Bloqueadores (todos obrigatórios):**
- [ ] Backup automatizado versionado + restore drill executado e documentado (RPO/RTO declarados)
- [ ] Retenção ativa em `audit_logs`, `alarm_events` e `telemetry` (com anonimização de IP definida)
- [ ] `enableShutdownHooks` + drain: deploy sem queda suja verificado
- [ ] Bateria prática de segurança re-executada e versionada: IDOR entre 2 tenants sintéticos (zero vazamento), escalonamento de privilégio por role (zero bypass), payload MQTT malicioso (ingestão íntegra), npm audit sem CVE crítica aberta
- [ ] Lockout de senha persistente (sobrevive a restart) e fluxo de recuperação de senha funcionando
- [ ] `take` máximo aplicado em todos os relatórios/exports
- [ ] Contrato de migração de produção documentado (só-aditivo; checklist de deploy/rollback)

**Fortemente recomendados antes do primeiro lote de clientes:**
- [ ] Alerta externo ao time (e-mail/webhook) para erro crítico e broker down
- [ ] Logs JSON + request-ID e métricas HTTP mínimas em produção
- [ ] Cache no dashboard + `connection_limit` explícito
- [ ] Limites por tenant no CRUD (trends/regras/pontos) e throttle por usuário
- [ ] Guarda de líder na ingestão/alarmes corrigida e revalidada com 2 instâncias (destrava crescimento)
- [ ] Checklist manual de navegadores (fase 3 §9) executado nos dois temas
- [ ] Decisão registrada sobre ACK de alarme ativo (liberar ou documentar como intencional)

**Regra de decisão:** GO quando todos os bloqueadores estiverem marcados; os recomendados podem ser concluídos em paralelo ao primeiro lote, desde que exista dono e prazo para cada um.

---

*Fase 4 — consolidação apenas: nenhum teste foi refeito e nenhuma correção foi aplicada. Fontes: `docs/audit/fase2-carga-resiliencia.md`, `docs/audit/fase3-dados-ux-observabilidade.md`, memória do projeto e código atual (fase 1).*
