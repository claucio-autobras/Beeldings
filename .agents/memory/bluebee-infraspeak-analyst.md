---
name: Analista IA de chamados Infraspeak
description: Base local pgvector de chamados + análise com salvaguardas anti-alucinação fora do modelo
---

- Chamados da Infraspeak são espelhados em `infraspeak_tickets` (upsert por failure_id, embedding refeito só quando o `composedText` muda) por um sync leader-only em setInterval; falha de API nunca lança — vira `result.error` e o próximo ciclo tenta de novo.
- **Salvaguardas anti-alucinação ficam FORA do modelo** (função pura `parseAnalysisResponse`): IDs citados que não estão na lista de candidatos são descartados; e a recomendação só vale se a **evidência CITADA** incluir ≥1 chamado com resolução confirmada — não basta existir um resolvido no pool. Sem isso → caminho "histórico insuficiente" com a frase fixa + só pontos de investigação.
  - **Why:** review pegou exatamente esse gap — o modelo pode citar só não-resolvidos mesmo com resolvidos disponíveis; regras no prompt não bastam.
  - **How to apply:** qualquer nova feature de IA que cite evidência deve validar as citações pós-LLM contra o conjunto realmente fornecido.
- `hasResolution` = solved OU completedDate; sandbox Infraspeak não tem chamados resolvidos — para testar o caminho de recomendação, marcar temporariamente um ticket no banco e reverter.
- Endpoints que disparam consumo de API externa/embeddings (sync manual) precisam de RolesGuard + AiRateLimitGuard, não só JwtAuthGuard (vetor de custo).
