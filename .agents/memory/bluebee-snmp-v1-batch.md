---
name: SNMP v1 batch GET é tudo-ou-nada
description: Por que a telemetria SNMP ficava "sem dados" com STATUS online e como o polling evita isso.
---

# SNMP v1: um OID inválido derruba o GET inteiro

Em SNMP v1, um único OID não suportado num GET em lote faz o agente responder
erro para a REQUISIÇÃO INTEIRA (RequestFailedError) — todos os pontos viram
null mesmo com a câmera viva (STATUS=1, valores "sem dados").

**Regras aplicadas:**
- Backend omite/marca `binding.unsupported === true` no bloco de config SNMP
  (e nos pontos de saúde ONVIF híbrido) — OIDs sabidamente inválidos ficam
  fora do GET, mas continuam publicados como null ("não suportado" na UI).
- Gateway (`readSnmpOids`): se o lote volta agent_error com >1 OID, relê cada
  OID individualmente (split-on-error, como no Modbus), preservando ordem.
  Timeout num GET individual do fallback NÃO vira offline — a vivacidade já
  foi provada pela resposta de erro do lote.
- `parseSnmpNumber` segue como único ponto de parsing.

**Why:** diagnóstico testava OID a OID e funcionava; o polling em lote não —
divergência confundia ("diagnóstico OK, telemetria sem dados").

**How to apply:** qualquer novo caminho de leitura SNMP em lote precisa do
fallback por OID ou excluir OIDs `unsupported` antes do GET. Gateway de campo
roda pacote baixado — correções no gateway exigem re-download do agente.
