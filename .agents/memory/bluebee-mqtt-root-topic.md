---
name: MQTT root-topic devices
description: Princípios do modo "tópico raiz próprio" (sem prefixo) e presença via heartbeat em devices MQTT
---
# Dispositivos MQTT com tópico raiz próprio

- **Por quê:** firmwares de mercado (ex.: Aeris) perdem o "Pre pend" após reconexões e publicam só na mudança de valor — o modo raiz elimina a dependência de prefixo e o heartbeat elimina o falso "sem comunicação".
- **Root topic é imutável após criar** — trocar de modo = excluir/recadastrar; unicidade global considera overlap de prefixo nos dois sentidos.
- **Regra de namespace deve ser IDÊNTICA em backend, frontend e gateway:** só `bluebee` exato ou `bluebee/…` é proibido; quase-prefixos (`bluebeex`) são válidos. Divergência cria device que cadastra OK mas nunca flui no gateway (falha silenciosa). Regressão coberta por spec de escopo no gateway.
- **ACL do usuário do gateway precisa ser reconstruída sempre que o conjunto de roots muda** — inclusive na captura de amostra pré-criação (root candidato + existentes), senão o gateway não consegue assinar o namespace do equipamento.
- **EMQX nega subscribe em silêncio:** SUBACK com granted qos 128 — mqtt.js NÃO gera erro no callback. O bridge do gateway detecta (err ou qos>2), guarda em `deniedTopics` e retenta a cada 30s; sem isso, uma ACL defasada bloqueava roots para sempre.
- **Boot sync reaplica ACLs de raiz:** o sync de boot (junto ao de sensores) reconstrói a ACL de roots do usuário do gateway E a ACL do usuário dedicado de cada device raiz — cobre EMQX re-provisionado ou falha pontual na criação.
- SCADA: ponto MQTT/SNMP/ONVIF com seed persistido (lastValue) conta como "com dado" no status do widget (sem badge vermelho); telemetria ao vivo sempre vence o seed.
- Provisionamento da credencial dedicada do device é best-effort pós-create (nunca quebra o cadastro); ACL nega tudo fora do raiz (deny `#` por último).
- Presença: heartbeat republicado pelo gateway num canal canônico por gateway vence a recência de telemetria no status do device (mas perde para sinal explícito de offline do gateway). Vale também no modo prefixo.
- UI: com heartbeat, o status ao vivo do backend (poll) é a fonte de verdade e suprime o aviso "sem comunicação" mesmo com telemetria parada.
