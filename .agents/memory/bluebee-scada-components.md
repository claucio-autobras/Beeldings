---
name: SCADA global components
description: "Meus Componentes" do editor SCADA são biblioteca global por tenant, não mais settings da tela
---

Componentes salvos no editor SCADA vivem na tabela `scada_components` (tenant-scoped), CRUD em `/scada/components`. Não fazem mais parte de `screen.settings` nem do save da tela — persistem imediatamente (otimista com rollback+toast em erro).

**Why:** antes ficavam em `settings.components` de cada tela e só apareciam na tela de origem; requisito é biblioteca por tenant.

**How to apply:**
- `settings.components` é LEGADO só de leitura: loadScreen mescla ao estado (dedupe por id); saves da tela NUNCA regravam nem apagam o campo — o backend preserva o valor do banco até a migração removê-lo.
- Migração one-off idempotente e SEM PERDA: `apps/backend/scripts/migrate-scada-components.mjs` (e `ScadaService.migrateLegacyComponents`). Dedupe SÓ por id no mesmo tenant ou conteúdo canônico (nome+dim+widgets JSON) — nunca por nome/contagem; strip do legado só quando toda a tela migrou. Rodar em prod após o Publish sync.
- Globais (ADMIN/CCO/SUPERVISOR) salvam no tenant DA TELA (payload tenantId), não no próprio; listagem usa `?tenantId=` da tela aberta.
- Inserção continua clonando com ids novos (`w-<nanoid>`); excluir da biblioteca não toca instâncias já inseridas.
