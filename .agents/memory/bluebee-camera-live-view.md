---
name: Camera live view pipeline
description: Sessão efêmera de frames JPEG ao vivo de câmeras ONVIF (gateway → MQTT → socket /telemetry)
---

Sessão sob demanda: POST /cftv/cameras/:id/live-view → backend manda `onvif.live_start` (creds decifradas nos params, como no probe); gateway captura ~1 fps (GetSnapshotUri + digest/basic; fallback frame RTSP via ffmpeg se instalado) e publica em `bluebee/{t}/gateway/{g}/live-view/{sessionId}`.

Regras duras:
- Canal 100% efêmero: gateway usa `publishVolatile` (QoS0, sem retain, sem store-and-forward — `publishEphemeral` do health É retained, não confunda); backend NUNCA persiste frames.
- Repasse: toda instância assina `bluebee/+/gateway/+/live-view/+` e emite `camera:frame` direto no socket com tenant do TÓPICO (nunca via cluster bus).
- Keep-alive duplo: backend expira em 10s sem renovação (sweeper) e o gateway tem watchdog próprio de 12s — qualquer lado sozinho já evita vazamento de captura.
- 1 sessão por operador (start substitui) no backend; 1 sessão por câmera no gateway.
- Erro de captura vira evento `type:'error'` no mesmo tópico (nunca silêncio); UNSUPPORTED/AUTH encerra a sessão (retry não ajuda).

**Why:** frames não são telemetria — persistir criaria lixo em trends/alarmes e retenção; watchdog dos dois lados porque o registro de sessão do backend é por instância (keepalive em outra instância = 404, frontend reinicia).

**How to apply:** ao evoluir (multi-câmera, qualidade), manter payload `{sessionId, deviceId, type, ts, seq?, image?, errorCode?}` e o limite MAX_FRAME_BYTES do gateway.

Disponibilidade por credencial, não protocolo: câmera SNMP também pode ter `onvifUsername/onvifPasswordEnc` (porta em `config.onvifPort`, pois `device.port` é a do SNMP) e/ou `rtspUrl`. Backend valida presença de creds/RTSP (não protocol); API expõe `liveViewAvailable` que gateia o botão no CFTV e no CameraWidget. Sem usuário ONVIF o gateway roda modo RTSP-only (nunca tenta connectOnvif). Mudança no gateway = bump de versão + manifest --update.

UI: estados terminais (UNSUPPORTED/erro/sinal perdido) NUNCA reiniciam a sessão sozinhos — auto-restart pós-falha de keepalive só quando a sessão estava saudável (live/connecting), senão o 404 da sessão encerrada vira loop de restart. Retomada é sempre ação explícita do operador.
