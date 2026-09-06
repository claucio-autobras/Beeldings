---
name: Proxy de produção corta requests >30s
description: Endpoints longos (IA, imports) precisam de padrão assíncrono + polling; chat da IA usa polling durável no banco.
---

**Regra:** em produção (www.beeldings.com.br) o proxy da plataforma devolve 500 para qualquer request HTTP que passe de ~30s, mesmo com o backend concluindo. Nenhum endpoint pode assumir request longo.

**Why:** observado no POST /ai/chat (RAG leva 30–45s) e no import de seed da base de conhecimento — a resposta ficava salva mas o cliente recebia 500.

**How to apply:**
- Endpoint longo → responder na hora com `{pending, id}` e processar em segundo plano; cliente busca por polling.
- Chat da IA: a âncora do polling é a mensagem do usuário persistida (`GET /ai/chat/result?conversationId&after=`); o resultado (reply + sources/similarCases + flag de erro) é persistido em `ai_messages.data` (JSONB) → durável, funciona em cluster e após restart. Falha de geração vira turno do assistente com `data.error=true` — polling nunca fica pendente para sempre.
- Jobs admin idempotentes (ex.: seed import) podem usar mapa em memória (padrão PDF-OCR/SNMP); status `unknown` no cliente = "segue em segundo plano" + refresh, nunca erro.
- Diagnóstico SNMP guiado (câmeras CFTV, controladoras SCA): POST só dispara e devolve `{started, diagnoseId}`; execução completa (teste OIDs + walk + enrichment) roda em background e grava em tabela própria (`snmp_diagnose_job`), não em memória — o payload final (walk/candidatos/propostas) pode passar de dezenas de KB, grande demais para pg_notify (~8KB) ou para confiar só em memória de uma instância; endpoint de progresso já existente (via MQTT) foi estendido para também devolver esse resultado durável assim que pronto.
