---
name: BlueBee Somas de Alarme (alarm groups)
description: Alarm groups are site-scoped aggregations of AlarmRules; aggregate is derived live at read time, never persisted.
---

# Somas de Alarme (alarm groups)

Um `AlarmGroup` agrupa várias `AlarmRule` por **Site** (não por projeto). A junção é
`AlarmGroupMember` com cascade nos dois lados (some quando o grupo OU a regra é excluída).

## Decisões não-óbvias
- **Agregado nunca é persistido.** `{ total, active, severity }` é derivado a cada
  leitura: `active` = regras com `AlarmEvent` aberto (`kind:'ALARM'`, state ACTIVE/ACTIVE_ACK);
  `severity` = maior severidade entre as ativas (HIGH>MEDIUM>LOW). Uma query única por
  `findAll` agrega os ruleIds de todos os grupos (evita N+1).
  **Why:** o estado ativo muda com telemetria; persistir criaria desincronização.
- **`projectId` na resposta é sempre `null`** e o grupo não guarda projeto. O filtro
  `projectId` resolve o projeto → `siteId` e escopa por site (grupos são por-site; um
  site tem vários projetos). SCADA (project-scoped) consome via esse filtro.
  **Why:** o create do frontend só manda `siteId`; não há vínculo device→projeto.
- **Escopo de tenant idêntico ao de alarm-rules:** GLOBAL_ROLES (ADMIN/CCO/SUPERVISOR)
  podem filtrar por tenant; não-globais ficam travados no próprio `user.tenantId`.
  Create valida que o site e todas as regras membro pertencem ao site/tenant do grupo.

**How to apply:** ao mexer no shape de resposta, casar 1:1 com os tipos do frontend em
`apps/frontend/src/modules/scada/services/alarm-groups.service.ts` (AlarmGroup,
AlarmGroupMemberDto com `active`, AlarmGroupAggregate com `severity` nullable).
Lembrar do gotcha de merge: rodar `prisma migrate deploy` + `generate` na main.
