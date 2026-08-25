# EMQX — proteção, observabilidade e caminho para cluster

> **Recuperação de desastre**: backup/restore do estado do broker e
> re-provisionamento em massa das credenciais estão no [RUNBOOK](./RUNBOOK.md).

## Limites configurados (`emqx_extra.conf`)

Todos os limites são **folgados** (≈100x a operação normal): o objetivo não é
policiar gateways saudáveis, e sim impedir que UM gateway com defeito degrade o
broker para os demais tenants.

| Proteção | Valor | Racional |
| --- | --- | --- |
| `mqtt.max_packet_size` | 1 MB | O maior payload legítimo é o `config` retido de um gateway grande (centenas de pontos), bem abaixo de 1 MB. Bloqueia payloads acidentais gigantes. |
| `listeners.tcp.default.messages_rate` | 200 msg/s por cliente | Gateway normal publica ~1 msg/s de telemetria agregada + status/health. Um loop de publish é limitado sem afetar os demais. |
| `listeners.tcp.default.bytes_rate` | 512 KB/s por cliente | Complementa o limite de mensagens para payloads grandes em sequência. |
| `flapping_detect` | 15 (des)conexões / 1 min → ban 5 min | Cliente em loop de reconexão (credencial errada, watchdog) é banido temporariamente, poupando o custo de handshake/auth. |

Quando um cliente excede o rate limit, o EMQX **pausa a leitura do socket**
(back-pressure), não derruba a conexão — o gateway com defeito fica lento, os
demais seguem normais.

## Observabilidade no BlueBee

- O backend (instância líder) coleta métricas da API REST do EMQX
  (`/monitor_current` e `/metrics`) a cada 30 s e avalia sinais anormais
  (mensagens descartadas, descartes por fila cheia, broker inacessível).
- Painel: área de admin global → Servidores → card "Broker MQTT (EMQX)"
  (endpoint `GET /health/broker`, restrito a admins globais).
- Alertas: sinal anormal em 2 coletas seguidas gera aviso no sino dos admins
  globais (histerese + cooldown de 30 min para não gerar spam).
- Ao excluir gateway/site, o de-provisionamento também remove as retained
  messages (`status`, `health`, `config`) via API do retainer.

Variáveis de ambiente usadas: `EMQX_API_URL`, `EMQX_API_KEY`, `EMQX_API_SECRET`
(as mesmas do provisionamento de usuários/ACL).

## Caminho para cluster EMQX (futuro)

Hoje o broker é um nó único. Quando a carga justificar:

1. **2+ nós EMQX** com discovery estático (`cluster.discovery_strategy = static`
   e a lista de nós) ou DNS. EMQX replica rotas/sessões entre nós nativamente.
2. **Load balancer TCP** (HAProxy/NLB) na frente dos listeners 1883/8883 —
   gateways continuam apontando para um único host.
3. **Retainer e banco de auth** já são `built_in_database` (Mnesia), replicados
   pelo próprio cluster — o provisionamento via REST API continua igual
   (qualquer nó atende).
4. **Backend**: nenhum código muda — a URL da API pode apontar para o LB. A
   coleta de métricas passa a usar `/metrics?aggregate=true` (já é o caso) para
   somar os nós.
5. Passo posterior (tarefa separada): shared subscriptions para distribuir o
   processamento de telemetria entre instâncias do backend.
