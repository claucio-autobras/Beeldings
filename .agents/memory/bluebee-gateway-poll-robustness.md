---
name: Gateway polling robustness
description: Guard de ciclo + jitter de partida + métricas de ciclo nos pollings do gateway (BACnet/Modbus/SNMP/ONVIF)
---

# Robustez do polling do gateway

- **Guard de ciclo**: todos os pollings ativos (BACnet, Modbus, SNMP, ONVIF) têm flag `busy`/`polling` por device; quando o intervalo dispara com ciclo anterior em andamento, o novo ciclo é PULADO e contabilizado via `pollingMetrics.recordSkipped()`. Nunca deixar leituras sobrepostas voltarem — device lento (ex.: BACnet sem RPM) acumularia requests.
- **Jitter de partida**: o primeiro ciclo de cada device é atrasado por `computeStartJitterMs(key, intervalMs)` (FNV-1a determinístico, mod intervalo) — espalha as publicações e evita rajadas sincronizadas no broker a cada republish de config. O offset é determinístico de propósito: reaplicar a mesma config mantém o mesmo espalhamento.
  - **Cuidado**: os serviços agora guardam `startTimeout` além do `interval`; `stopPoll` precisa limpar OS DOIS, senão um device removido da config ainda dispara o primeiro ciclo.
- **Métricas de ciclo**: `DevicePollingMetric` ganhou `skippedCycles`, `intervalOverruns` (duração > intervalo) e `intervalMs`. Passar `intervalMs` em todo `record()` novo, senão estouros não contam. O payload de health passa pelo backend por spread (sem mudança funcional lá) até a tela de gateways.
- **Isolamento de ciclo**: todo disparo `void pollDevice(...)` (e equivalentes COV/maintenance) tem `catch` interno que loga e libera o guard — exceção de driver nunca vira unhandled rejection. `main.ts` tem handlers globais de `unhandledRejection`/`uncaughtException` que LOGAM e mantêm o processo vivo (última defesa; não remover).
- **Chamadas ONVIF penduráveis**: `getDeviceInformation` e `checkStream` têm timeout explícito (callback da lib pode nunca disparar) — estouro = falha do ciclo, `detachCam` e reconexão no próximo ciclo. Qualquer nova chamada callback-based da lib onvif precisa do mesmo padrão settled+timer.
- **Modbus TCP zumbi**: timeout/erro de socket num ciclo marca `connectionSuspect` e o client é fechado+substituído ao final do ciclo (próximo reconecta limpo). Exceções Modbus de DADOS (illegal address) NÃO invalidam — o split-on-error continua.
- **Store-and-forward crash-safe**: o reenvio usa `peekAll()` + `remove(msg)` por confirmação de publicação (lotes de 100), nunca esvaziar a fila antes de publicar; `drain()` destrutivo foi removido de propósito — não reintroduzir.
- **Why:** cenário de lançamento com 10 clientes × 10–30 devices em rede instável; a degradação precisa ser controlada e observável, nunca silenciosa; queda de processo ou câmera presa em busy exigia reinício manual em campo.
- **How to apply:** qualquer novo serviço de polling no gateway deve replicar guard + jitter + record/recordSkipped com `intervalMs` + catch de isolamento no ciclo.
