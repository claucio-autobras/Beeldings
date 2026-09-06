---
name: Escala horizontal bloqueada (ingestão sem guarda de líder)
description: Por que o BlueBee não pode rodar >1 instância de backend hoje e cuidados ao medir carga no Replit.
---

**Regra:** não rodar mais de 1 instância do backend até a ingestão MQTT stateful (trends + motor de alarmes) ser guardada por liderança — hoje toda instância consome e grava, duplicando dados e ocorrências.

**Why:** confirmado empiricamente na auditoria fase 2 (2 instâncias → trend_records exatamente 2× e ocorrências ACTIVE duplicadas da mesma regra); o log do líder "assumindo ingestão MQTT" é enganoso — a guarda só existe na disponibilidade.

**How to apply:** qualquer plano de escala horizontal ou correção deve guardar a ingestão stateful por liderança (ou particionar tópicos) e revalidar com 2 instâncias reais antes de aprovar. Relatório e harness reproduzível versionados em `docs/audit/`.

Cuidados ao medir carga no Replit (custaram tentativas):
- Processos em background morrem quando o comando shell termina (mesmo nohup/setsid) — instância secundária e teste devem rodar no MESMO comando.
- O throttle global por IP contamina load tests locais — subir instância com limite alto em outra porta.
- autocannon não expõe p95 (só p50/p75/p90/p97.5/p99); publishers com setInterval perdem ticks — reportar taxa efetiva (enviadas ÷ tempo), nunca a nominal.
- Duplicata exata de telemetria é absorvida pelo deadband ON_CHANGE (idempotência de fato); o EMQX derruba cliente em rajada (~25 msg/s) com ECONNRESET.
