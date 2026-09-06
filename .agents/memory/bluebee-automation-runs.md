---
name: Histórico de execuções de automações
description: Semântica do AutomationRun — cascade, snapshot de nome, CONTINUOUS, fire-and-forget
---

- `AutomationRun` tem FK Cascade: apagar a regra apaga o histórico dela (decisão intencional; nome da regra fica em `automationName` snapshot p/ sobreviver a renomeações, não a deletes).
- `recordRun` é fire-and-forget com try/catch — falha de gravação NUNCA quebra a execução, mas também some silenciosamente (ver lição de merge-DB-sync: tabela ausente no main = histórico vazio sem erro visível).
- Automação CONTINUOUS ("enquanto") só grava run quando efetivamente agiu (entrou/saiu da condição); ticks sem ação não geram linha — não interpretar ausência de runs como "não rodou".
- Retenção fixa de 90 dias podada na escrita (RUN_HISTORY_RETENTION_DAYS).
- Falha total/parcial de run gera AUTOMATION_NOTICE no sino via publishNotice (severity MEDIUM; NOTIFY usa LOW). `alarm_events.source_id` guarda o id da automação → deep-link `/automation?tab=history&automationId=<id>`; avisos novos devem sempre preencher sourceId.
- **Why:** histórico é diagnóstico, não trilha de auditoria (essa é audit_logs); volume controlado e semântica simples.
- **How to apply:** qualquer consumidor novo do histórico deve assumir cascade delete e ausência de runs de ticks CONTINUOUS ociosos.
