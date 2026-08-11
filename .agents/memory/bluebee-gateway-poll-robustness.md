---
name: Gateway polling robustness
description: Guard de ciclo + jitter de partida + métricas de ciclo nos pollings do gateway (BACnet/Modbus/SNMP/ONVIF)
---

# Robustez do polling do gateway

- **Guard de ciclo**: todos os pollings ativos (BACnet, Modbus, SNMP, ONVIF) têm flag `busy`/`polling` por device; quando o intervalo dispara com ciclo anterior em andamento, o novo ciclo é PULADO e contabilizado via `pollingMetrics.recordSkipped()`. Nunca deixar leituras sobrepostas voltarem — device lento (ex.: BACnet sem RPM) acumularia requests.
- **Jitter de partida**: o primeiro ciclo de cada device é atrasado por `computeStartJitterMs(key, intervalMs)` (FNV-1a determinístico, mod intervalo) — espalha as publicações e evita rajadas sincronizadas no broker a cada republish de config. O offset é determinístico de propósito: reaplicar a mesma config mantém o mesmo espalhamento.
  - **Cuidado**: os serviços agora guardam `startTimeout` além do `interval`; `stopPoll` precisa limpar OS DOIS, senão um device removido da config ainda dispara o primeiro ciclo.
- **Métricas de ciclo**: `DevicePollingMetric` ganhou `skippedCycles`, `intervalOverruns` (duração > intervalo) e `intervalMs`. Passar `intervalMs` em todo `record()` novo, senão estouros não contam. O payload de health passa pelo backend por spread (sem mudança funcional lá) até a tela de gateways.
- **Why:** cenário de lançamento com 10 clientes × 10–30 devices; a degradação precisa ser controlada e observável, nunca silenciosa.
- **How to apply:** qualquer novo serviço de polling no gateway deve replicar o trio guard + jitter + record/recordSkipped com `intervalMs`.
