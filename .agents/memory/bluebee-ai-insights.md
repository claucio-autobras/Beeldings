---
name: Insights de IA por tenant
description: Contrato durável do módulo de insights periódicos (fronteiras de período, degradação da IA, evento de entrega)
---

- Config por tenant: **sem linha no banco = habilitado + semanal** — a geração funciona out-of-the-box; job agendado pula período sem dados, geração manual não pula (e permite duplicatas de propósito).
- Períodos fecham em America/Sao_Paulo com **`to` EXCLUSIVO** (`[from, to)`): evento/transição exatamente no fechamento pertence só ao período seguinte. A disponibilidade dos relatórios é fim-INCLUSIVO, então o agregador converte com `to - 1ms` ao reusá-la.
- Seleção de alarmes é por SOBREPOSIÇÃO: além da atividade no período, inclui ocorrência aberta antes de `from` e ainda ativa (senão um alarme ativo o período inteiro some dos totais/críticos).
- Insight = `facts` determinístico (fonte única de verdade, agregado com paginação completa — nunca teto silencioso) + narrativa da IA em JSON estrito; falha da IA ⇒ salva só-factual com `aiFailed=true`, nunca 5xx.
- **Evento p/ entrega futura**: cada insight salvo publica no canal `insight_generated` do ClusterService (payload com tema, resumo curto, período e destinatários da categoria `insights` já resolvidos). Consumidores novos (e-mail/WhatsApp/webhook) ASSINAM esse canal — não reimplementar resolução de destinatários.
- Idempotência agendada mora no BANCO: índice único parcial (tenant, frequência, início do período, só trigger='scheduled') em SQL puro — Prisma não expressa índice parcial; violação é tratada como "outra instância venceu", não erro.
- **Why:** números do insight vão ao cliente final; fronteira dupla ou teto silencioso gera relatório errado com cara de certo.
- **How to apply:** qualquer agregação/consumo novo do módulo mantém `[from, to)`, degrada IA para só-factual e assina o canal em vez de acoplar no serviço.
