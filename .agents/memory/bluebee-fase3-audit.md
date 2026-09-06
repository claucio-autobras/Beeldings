---
name: Auditoria fase 3 — dados/UX/observabilidade
description: Achados duráveis da fase 3 (retenção ausente, backup inexistente, contrato de migração em prod, ACK só de NORMALIZED_UNACK na UI, modais sem Escape/focus trap).
---

Regras/fatos duráveis:
- **Retenção inexistente** em `audit_logs`, `alarm_events`, `telemetry` — crescimento ilimitado + PII eterna (IP bruto e e-mail snapshot em audit_logs). Qualquer plano de correção deve fixar prazo e/ou anonimizar. Já COM retenção: trends (partições), status_events (365d, sweep diário do líder), automation_runs (90d) — não reauditar do zero.
- **Backup/restore**: nenhum script/runbook no repo; RPO/RTO nunca testados — restore drill só é possível em produção.
- **Migração em produção é via Publish sync do Replit, NUNCA `migrate deploy`** (causa P3009/crash loop — documentado em `scripts/start-production.sh`). Consequência: mudanças de schema devem ser aditivas (expand-and-contract); rollback = republicar build anterior, nunca reverter schema.
- Colunas temporais são `timestamp(3)` SEM time zone; UTC só por convenção do Prisma (banco em GMT) — SQL manual/BI fora do Prisma pode reinterpretar.
- **UI só permite ACK de `NORMALIZED_UNACK`**, mas o backend suporta `ACTIVE → ACTIVE_ACK`. Decisão de produto pendente; não é bug do backend.
- Modais não têm primitiva compartilhada de dialog: sem Escape, sem focus trap (verificado no navegador). Corrigir na primitiva, não tela a tela.
- Testar rede lenta com o tester Playwright: CDP `Network.emulateNetworkConditions` funciona; comando com gateway offline expira com erro pt-BR claro em 20 s (bom baseline de UX).
