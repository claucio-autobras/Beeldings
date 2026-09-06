---
name: Trend rollups & partições
description: Regras duráveis dos rollups horário/diário, particionamento mensal de trend_records e trends padrão.
---

- Rollups guardam SUM (não AVG); média derivada na leitura (sum/count). **Why:** merge incremental ON CONFLICT só é exato somando; média não é mergeável. **How to apply:** qualquer consumidor novo dos rollups calcula avg = sum/count, nunca persiste avg.
- Job de rollup é incremental por cursor global (trendRollupState id=1) e roda só no líder. NUNCA rodar runIncremental concorrente (teste/integr.) contra o mesmo banco com o backend vivo — duas passadas no mesmo cursor duplicam somas. Testes de consistência devem ser read-only (comparar rollup vs brutos com id <= cursor, re-tentando se o cursor avançar).
- trend_records é particionada por mês (trend_records_yYYYYmMM); retenção dropa partições inteiras mais antigas que a MAIOR retenção; partições futuras (mês+2) garantidas pelo job. Migrações/queries novas não podem assumir tabela plana (PK inclui timestamp).
- Trends padrão (DefaultTrendsService): só cria onde não existe NENHUMA trend; gate por tenant.autoTrendEnabled; analógico INTERVAL 300s, digital ON_CHANGE. Nunca alterar trend existente.
- Timeline do equipamento: janela >3 dias lê dos rollups horários, senão agrega por minuto dos brutos — manter esse corte ao mexer em períodos.
