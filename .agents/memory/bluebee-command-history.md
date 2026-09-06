---
name: Histórico de comandos = trilha de auditoria
description: De onde vem a lista/taxa de sucesso de comandos no dashboard e o cuidado com HTTP 200 + success:false
---

O histórico de comandos NÃO tem tabela própria: `GET /commands` (dashboard,
card "Automações & Comandos") deriva tudo de `audit_logs` com `action='COMMAND'`
— escritas manuais (`POST /devices/bacnet/write`, via AuditInterceptor) e de
automação (AutomationRunner grava direto no AuditService).

**Regras:**
- O endpoint de escrita responde HTTP 200 mesmo em falha lógica
  (`{success:false}` por timeout/recusa do gateway). O AuditInterceptor precisa
  converter isso em `result=FAILURE` — senão a taxa de sucesso vira 100% falso.
- Rótulo amigável do ponto vem do campo opcional `pointLabel` no body do write
  (só auditoria; nunca vai ao gateway). Sem ele, cai no fallback
  "Objeto tipo:instância @ ip".
- Visão global sem filtro exclui tenants inativos (mesma semântica dos feeds
  de alarme); usuário de tenant fica travado no próprio.
- `siteId` é aceito mas ignorado: audit_logs não guarda site.

**Why:** evitar tabela nova duplicando dados já persistidos e manter taxa de
sucesso honesta.
**How to apply:** qualquer novo caminho de comando (Modbus write, etc.) deve
gravar COMMAND na trilha com resultado real e `pointLabel`, ou some do card.
