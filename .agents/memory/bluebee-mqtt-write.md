---
name: Escrita MQTT (Shelly RPC)
description: Regras duráveis do fluxo de escrita em pontos MQTT-nativos via gateway
---
- Tópicos de comando/resposta de sensores MQTT vivem SOB `bluebee/{tenant}/gateway/{gw}/sensors/` — validar namespace no backend E no gateway (defesa em profundidade); a ACL do usuário `-sensors` só permite subscribe em sub-espaços `*/rpc` e `*/command/#`.
- Payload de comando é template com `{{value}}` (obrigatório) e `{{id}}` (opcional, id RPC gerado no backend p/ casar a resposta Shelly pelo campo JSON `id`). Sem responseTopic o resultado é `success:true, confirmed:false` ("enviado").
- Sessão de escrita no gateway registrada ANTES de subscribe/publish (mesma corrida QoS2 do BACnet); backend 20s, gateway 10s de confirmação RPC.
- Timeout de confirmação RPC ≠ falha dura: o gateway reporta `success:true, confirmed:false` ("enviado, sem confirmação") — falha real é só erro de publish ou resposta RPC com `error`. Eco do NOVO estado no sourceTopic (readback via bridge, valor casando com o comandado) confirma a escrita na hora mesmo sem resposta RPC. O frontend trata `confirmed:false` como aviso brando (warning), nunca toast de erro.
- Lookup de telemetria SCADA por tag exige deviceId+tag (`byDevice`); o fallback global `byTag` foi removido do useScreenTelemetry — dois devices com a mesma tag vazavam valor um no outro (função pura resolveTelemetryEntry, com testes).
- Template contendo APENAS `{{value}}` = modo "valor puro": publica o valor cru sem envelope JSON e boolean vira `1`/`0` (não true/false). É o formato do canal oficial de comando Aeris `{serial}/set/split/0/force1|sp1` — que dispensa a assinatura proprietária `sh` do canal legado `config/`. Confirmação Aeris por eco de valor (matchByValue): force1 → `update/sensor/POWER1`, sp1 → `config/split/0/sp_val1`.
- **EMQX API**: o PUT de rules/users exige `username` também no body (só na URL dá 400 required_field root.username).
- Telemetria confirmada pós-escrita (paridade com BACnet): o backend manda `params.confirm` (deviceId/tag/valor numérico/unit) e o gateway publica o valor no tópico canônico de telemetria SÓ quando a resposta RPC validar (`confirmed:true`). Anti-duplicidade: se o bridge já republicou o novo estado do mesmo device+tag durante a sessão de escrita, pula a publicação. Comandos sem `confirm` (backend antigo) seguem funcionando.
