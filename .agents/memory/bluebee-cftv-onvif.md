---
name: CFTV via ONVIF
description: Câmeras ONVIF como Devices protocol='onvif' — credenciais cifradas, probe-first no cadastro, eventos como pontos digitais.
---

- Câmeras ONVIF são Devices `protocol='onvif'`, excluídos das queries BMS junto com snmp/virtual via `EXCLUDE_NON_BMS_DEVICES` (device-filters); `CFTV_PROTOCOLS` = snmp+onvif para listagem mista.
- **Credenciais nunca vazam**: senha cifrada AES-256-GCM (`enc:v1:iv:tag:cipher`, chave = sha256(CAMERA_CREDENTIALS_KEY||JWT_SECRET)) em Device.config; API retorna só `hasOnvifPassword`; decifrada SOMENTE no payload MQTT de config ao gateway. Edição com senha vazia = mantém a atual.
- **Probe-first**: cadastro/edição ONVIF dispara probe via MQTT (gateway conecta com onvif lib) antes de persistir — valida credenciais e auto-preenche manufacturer/model/firmware/serial em `deviceInfo`. Erros PT-BR por código (AUTH/UNREACHABLE/NOT_ONVIF).
- Eventos ONVIF (motion/tamper/video_loss) viram pontos digitais 0/1 na telemetria canônica → alarmes protocol-agnósticos funcionam sem mudança no motor. STATUS deriva de GetDeviceInformation; STREAM de GetStreamUri; UPTIME sem fonte ONVIF padrão → null.
- Scan SNMP: hosts `aliveNoSnmp` ganham botão "Adicionar via ONVIF" (IP prefill, protocolo onvif, porta 80).
- **Scan ONVIF robusto**: gateway NÃO usa `Discovery.probe` da lib (1 pacote, 1 interface) — sockets dgram próprios: 1 por interface IPv4 (setMulticastInterface) + reenvio do probe 3x (0/2/4s na janela de 8s) + probes unicast UDP 3702 opcionais para IPs informados (`params.targets`, expandidos no backend a partir de IP/CIDR/intervalo, máx 1024). Respostas parseadas por regex de XAddrs/Scopes (tolerante a prefixos de namespace), dedupe por IP. **Why:** multicast se perde/sai pela interface errada/é filtrado por switch — caso real Intelbras; unicast probe funciona mesmo com multicast bloqueado.
- **Why:** senha em texto puro no banco/API seria vazamento; probe-first evita cadastrar câmera com credencial errada silenciosamente.
