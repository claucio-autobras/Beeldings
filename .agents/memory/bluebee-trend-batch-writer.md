---
name: Gravador de trends em lote
description: TrendRecorder grava em lote assíncrono (janela ~1s) — persistência não é imediata após telemetria.
---

# Gravador de trends em lote

Regra: a gravação de TrendRecord é assíncrona e em lote — registros qualificados entram numa fila em memória e são gravados por janela (~1s) ou por tamanho; retry curto com backoff; retries esgotados ou teto de fila descartam CONTABILIZADO (contadores em `getWriterStats()`, expostos em `/health/comms` como `trendWriter`).

**Why:** o `createMany` por mensagem era fire-and-forget com falha silenciosa; trends alimentam relatórios/rollups e precisavam de garantia de escrita e visibilidade de falha (decisão de produto pré-lançamento). Guarda de líder na ingestão foi adiada por decisão do usuário.

**How to apply:**
- Testes/consumidores que leem `trend_records` logo após injetar telemetria precisam esperar a janela de flush (~1s) — a persistência NÃO é síncrona com o consume().
- Sob teto de fila, descartam-se os MAIS ANTIGOS (recentes valem mais para operação ao vivo).
- Deadband/heartbeat/intervalo são avaliados ANTES do enfileiramento — mudanças no writer não podem alterar quais registros qualificam nem seus timestamps.
