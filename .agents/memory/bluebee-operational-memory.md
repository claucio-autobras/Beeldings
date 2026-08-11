---
name: Memória operacional anonimizada da IA
description: Casos globais cross-tenant de alarmes resolvidos (pgvector) que alimentam chat/sugestão/primeira ação — regras LGPD e padrões do pipeline.
---

# Memória operacional anonimizada (operational_cases)

- Tabela GLOBAL sem tenantId/siteId/deviceId/nomes — whitelist estrita na montagem do caso (`buildOperationalCase`). `sourceEventId` é só chave de upsert do sync, nunca exposto na busca/UI.
- **Why:** LGPD — a IA aprende com o problema (tipo de equipamento, alarme, resolução), nunca com quem/onde. Resposta jamais menciona local/cliente, nem por inferência.
- **How to apply:** qualquer campo novo no caso precisa passar pela mesma pergunta: "identifica origem?" Se sim, fica fora ou é saneado. Testes de privacidade em `operational-memory.spec.ts` validam a whitelist e o saneamento.

## Saneamento do texto livre (ackNote)
- Duas camadas: redação de nomes conhecidos da plataforma (tenants/sites/devices/gateways/projetos/usuários, carregados no sync, mais longos primeiro) + regexes genéricos de PII pt-BR (e-mail, telefone, CEP, CPF/CNPJ, endereços, "Condomínio X", "Sr. Fulano", "técnico Fulano").
- Regexes de keyword+NomeProprio NÃO podem usar flag `i` global (o nome seguinte precisa exigir maiúscula) — usar `[Cc]ondom[ií]nio` etc., senão "Condomínio"/"Sr." no início de frase escapam.
- Texto não saneável com segurança (sobra <10 chars úteis, >8 redações, ou >50% redigido) → caso fica FORA do índice (nunca persistir texto arriscado).

## Anti-alucinação (mesmo padrão do analista Infraspeak)
- Bloco "CASOS SEMELHANTES" + regras entram no prompt SÓ quando a busca retornou casos; sem casos o prompt fica idêntico ao anterior.
- Pós-processamento `sanitizeCaseCitations` neutraliza `[Caso N]` fora dos candidatos recuperados; a UI mostra sempre os candidatos da busca, nunca o texto do modelo.
- Na primeira ação (JSON), aplicar a sanitização em steps[].text e note.

## Busca/ranking
- Cosine pgvector, limiar 0.35, boost +0.15 mesmo monitoredDeviceType (fallback: mesmo protocol quando o alvo é BMS) e +0.1 mesmo alarmType, máx. 4 casos.
- Sugestão por equipamento: o early-return "sem playbooks" agora só ocorre quando NÃO há playbook E NÃO há caso semelhante.
- **Chat usa modo ESTRITO** (`strict:true` no `CaseSearchTarget`): domínio (CFTV/NETWORK/ACCESS/BMS) vem do equipamento do tenant citado por nome ou de `inferQuestionDomain` (keyword por palavra inteira; ambíguo → null). Com domínio: exclui outro domínio salvo similaridade ≥0.6; sem domínio: exige ≥0.5. Primeira ação e sugestão por equipamento TAMBÉM usam strict (domínio derivado do monitoredDeviceType/protocol do device). Consistência painel×resposta = filtrar no backend (painel some com lista vazia).

## Diagnóstico ao vivo no chat (live-status.util.ts)
- Intenção de estado detectada por keywords; entidades (site/device) casadas por nome normalizado (sem acento, mais longo primeiro, mín. 3 chars). Bloco factual com durações CALCULADAS no backend (nunca pela IA) + lista de sites do tenant p/ a IA negar entidade inexistente.
- LIVE_STATUS_RULES precisa dizer explicitamente que prevalece sobre a regra RAG "você não tem acesso a tempo real", senão a IA recusa usar o bloco.
- Tudo em try/catch → falha degrada p/ chat normal; controller só liga liveData com tenant OU papel global (cliente sem tenant nunca ganha escopo global).
