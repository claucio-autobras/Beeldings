---
name: Primeira ação sugerida (IA)
description: Lições duráveis do painel de primeira ação para ativo crítico em falha
---

- Regra: qualquer `rulesOverride` de prompt no serviço de IA deve valer em TODOS os ramos do `complete` — inclusive quando a busca na base retorna zero hits.
- **Why:** o ramo sem hits caía nas regras genéricas, perdendo o contrato JSON e a proibição de ações destrutivas exatamente no caso mais comum (sem manual aplicável). Review de conclusão rejeitou por isso.
- **How to apply:** ao adicionar novos "modos" de prompt (sugestão contextual, resumos, etc.), teste o ramo sem contexto de RAG e afirme que as regras específicas aparecem no system prompt.
- Falha do provedor de IA nunca deve derrubar um endpoint cujo valor principal é contexto factual: degrade com flag de erro + contexto, e deixe o 429 para o guard.
