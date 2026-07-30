---
name: SNMP diagnose progress across instances
description: Why in-memory progress maps fed by MQTT must get an initial 0/N from the gateway and a done marker on every instance.
---

# Progress maps + polling em cluster (diagnóstico SNMP e afins)

Regra: qualquer estado de progresso mantido em `Map` em memória e consultado por
polling HTTP só funciona em cluster se for alimentado por MQTT em TODAS as
instâncias — o POST pode cair numa instância e o GET de progresso em outra.

**Why:** o registro inicial do progresso feito no `diagnose()` só existe na
instância de origem; se o gateway só publica progresso após o 1º lote, outras
instâncias respondem `unknown` e a UI fica presa em "Iniciando…".

**How to apply:**
- O gateway publica um progresso inicial (0/N) IMEDIATAMENTE ao aceitar o
  comando, antes de qualquer trabalho.
- No backend, o handler de RESULTADO marca `done=true` no mapa de progresso em
  toda instância (antes do check de pendência) — senão instâncias sem pendência
  ficam com progresso "vivo" e sem TTL de limpeza.
- Progresso atrasado (entregue após o resultado) não pode reverter `done`.
- A resolução da pendência já é cross-instance de graça: cada instância assina
  o MQTT; só a que tem o `command_id` pendente resolve.
- UI: spinner nunca coexiste com resultado (`isPending && !result`), e "sem
  progresso após ~6s" vira mensagem de "ainda aguardando o gateway".
