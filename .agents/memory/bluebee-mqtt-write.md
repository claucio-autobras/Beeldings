---
name: Escrita MQTT (Shelly RPC)
description: Regras duráveis do fluxo de escrita em pontos MQTT-nativos via gateway
---
- Tópicos de comando/resposta de sensores MQTT vivem SOB `bluebee/{tenant}/gateway/{gw}/sensors/` — validar namespace no backend E no gateway (defesa em profundidade); a ACL do usuário `-sensors` só permite subscribe em sub-espaços `*/rpc` e `*/command/#`.
- Payload de comando é template com `{{value}}` (obrigatório) e `{{id}}` (opcional, id RPC gerado no backend p/ casar a resposta Shelly pelo campo JSON `id`). Sem responseTopic o resultado é `success:true, confirmed:false` ("enviado").
- Sessão de escrita no gateway registrada ANTES de subscribe/publish (mesma corrida QoS2 do BACnet); backend 20s, gateway 10s de confirmação RPC.
- **EMQX API**: o PUT de rules/users exige `username` também no body (só na URL dá 400 required_field root.username).
- Telemetria confirmada pós-escrita (paridade com BACnet): o backend manda `params.confirm` (deviceId/tag/valor numérico/unit) e o gateway publica o valor no tópico canônico de telemetria SÓ quando a resposta RPC validar (`confirmed:true`). Anti-duplicidade: se o bridge já republicou o novo estado do mesmo device+tag durante a sessão de escrita, pula a publicação. Comandos sem `confirm` (backend antigo) seguem funcionando.
