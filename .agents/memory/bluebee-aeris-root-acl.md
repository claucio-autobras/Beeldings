---
name: Aeris root-topic ACL & confirmação
description: Por que comandos MQTT em modo raiz "somem" e como confirmar de verdade
---

Equipamentos MQTT em modo "tópico raiz próprio" (ex.: Aeris) assinam filtros
CURINGA (`{root}/set/#`), não os tópicos exatos de comando. A ACL do usuário
dedicado `dev-{id}` precisa permitir subscribe em `{root}/#` — permitir só os
commandTopics exatos faz o EMQX negar o SUBACK em silêncio (qos 128): o
equipamento fica conectado porém SURDO (subscriptions_cnt=0, send_msg=0) e o
comando "some" mesmo com publish aceito.

**Como diagnosticar:** EMQX API `GET /clients/{id}` → `subscriptions_cnt`/`send_msg`,
e `GET /clients/{id}/subscriptions` (kick com DELETE força reassinar).

**Confirmação honesta:** binding com `matchByValue: true` DEVE ter responseTopic;
resolveMqttWriteTarget aplica fallback = sourceTopic do ponto (eco de valor).
Sem isso o gateway reporta sucesso "enviado" sem o equipamento responder e a UI
mantém o valor otimista falso.
