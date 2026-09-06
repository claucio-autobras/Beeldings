---
name: Gateway local + câmera SNMP simulada
description: Como verificar features que dependem de hardware de campo (SNMP/CFTV) sem hardware, rodando o gateway real localmente contra um agente net-snmp.
---

# Verificar features de gateway sem hardware de campo

Regra: quando os gateways de campo estão offline, dá para exercitar o caminho
REAL ponta a ponta rodando o gateway (apps/gateway, `node dist/main.js`) como
workflow local com as credenciais MQTT do gateway de teste (tabela `gateways`:
mqtt_user/mqtt_pass; env `MQTT_BROKER_URL=$MQTT_GATEWAY_BROKER_URL`,
`TENANT_ID`, `GATEWAY_ID`, `MQTT_USERNAME`, `MQTT_PASSWORD`) + um dispositivo
simulado local. Para câmeras SNMP existe `scripts/dev-camera-snmp-sim.cjs`
(agente net-snmp em 127.0.0.1:1161; hrProcessorLoad via provider de TABELA —
scalar registra instância .0, OIDs de coluna tipo ...2.1 exigem
`MibProviderType.Table` + addTableRow). Para câmeras ONVIF existe
`scripts/dev-camera-onvif-sim.cjs` (SOAP subset compatível com a lib `onvif`:
GetSystemDateAndTime sem auth, GetServices responde fault p/ cair no
GetCapabilities, pull-point events com long-poll; controles GET
/sim/motion|tamper|health?value=). Gotchas do sim: a lib `onvif` só valida
Username do WS-Security (qualquer senha passa no sim); em Node, `req.on('close')`
dispara no FIM da mensagem — para detectar cliente abortando long-poll use
`res.socket.once('close')`. Não reutilize credenciais de um gateway real ONLINE
(dual-consumer MQTT → probes respondem UNREACHABLE); crie gateway de teste
dedicado (linha no banco + user/ACL EMQX via API) e deprovisione no fim
(DELETE /gateways/:id NÃO limpa o EMQX — apagar user, ACL e tópicos retidos
config/status via API do EMQX).

**Why:** o diagnóstico SNMP faz fast-fail se o status LWT do gateway é
offline, e o Playwright não substitui o caminho MQTT/gateway real; o simulado
cobre tudo menos o firmware da câmera.

**How to apply:**
- Aponte o device no banco para 127.0.0.1:1161 e depois RESTAURE ip/porta.
- A config dos devices chega ao gateway por tópico RETIDO: editar o banco
  direto não republica — reinicie o backend (republica no boot) ou use a API.
- Remova os workflows temporários e reinicie o backend no fim para o retained
  config voltar ao estado real.
