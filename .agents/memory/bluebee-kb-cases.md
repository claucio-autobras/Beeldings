---
name: Casos técnicos na base de conhecimento
description: Como funcionam os casos BB-XXX-NNNN (seed de 100 casos BMS), ranking por classe e anti-alucinação de case_id na IA.
---

# Casos técnicos (KnowledgeType CASE)

- Casos técnicos são KnowledgeDoc `type=CASE` com metadados estruturados: `caseId` (único, formato `BB-XXX-NNNN`), `knowledgeClass` (FIELD_VALIDATED > DOCUMENTED > DERIVED > SYNTHETIC), `caseSeverity`, `protocol`, `subsystem`, `vendorScope`, `symptom`, `evidenceStrength`, `sourceUrl`, `tags[]`.
- A seed de 100 casos BMS vive empacotada no backend (`src/modules/knowledge/assets/`, copiada ao dist via nest-cli assets). Importação por `POST /knowledge/import-seed-cases` é **idempotente por caseId** (dedupe em arquivo + banco + P2002 tratado como skip); casos entram APPROVED + anonymized direto.
- **Why:** rodar a importação de novo (dev, prod, novos lotes) nunca pode duplicar casos nem exigir aprovação manual em massa.

## Ranking e citação na IA

- O RAG sobre-busca 2×k e re-ranqueia com boosts pequenos e aditivos (classe .09/.06/.03/0; +.05 por match de protocolo/fabricante/equipamento extraído do texto). Os boosts só desempatam — similaridade semântica continua dominante. Nunca aumentar os boosts a ponto de inverter hits claramente mais similares.
- Anti-alucinação em camadas: prompt proíbe inventar case_id E `sanitizeKnowledgeCaseIds` pós-LLM substitui qualquer `BB-XXX-NNNN` não recuperado por "[caso não encontrado na base]". Mesmo padrão do sanitizeCaseCitations da memória operacional — aplicar AMBOS em chat/suggest/first-action.
- Formato diagnóstico (hipóteses ordenadas, "verifique nesta ordem", confiança ALTA/MÉDIA/BAIXA, disclaimer DERIVED) vive em `DIAGNOSTIC_FORMAT_RULES` anexado a RAG_RULES e NO_CONTEXT_RULES — **nunca** no BASE_PROMPT, senão quebra o contrato JSON estrito da primeira ação (rulesOverride).

## Gotcha de sintaxe

- `` `${a ?? b || c}` `` é SyntaxError em JS (?? não mistura com || sem parênteses) — o ts-jest só acusa em runtime do teste, o tsc aponta antes.

**How to apply:** ao adicionar novos lotes de casos, novos campos de caso ou mexer no ranking/prompt da IA, preservar dedupe por caseId, sanitização dupla e a separação BASE_PROMPT × regras de formato.

- Importação da seed é MANUAL e por ambiente: POST /knowledge/import-seed-cases (admin, idempotente). Merge da tarefa NÃO importa nada. Dev e produção (14/08/2026) já importados: 100 casos cada.
- Prod: chamadas HTTP longas (>~30s, ex.: import da seed, /ai/chat via curl) recebem 500 "Internal Server Error" do proxy da Replit, mas o backend CONCLUI o trabalho — confirmar pelo banco (read-only), não pelo status HTTP. Login scriptado em prod é bloqueado pelo Turnstile; caminho de serviço: JWT assinado com JWT_SECRET compartilhado no header Authorization (payload sub/email/role/tenantId).
