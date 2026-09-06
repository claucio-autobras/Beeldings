---
name: CFTV via SNMP
description: Como a área CFTV trata câmeras como Devices protocol='snmp' e o que consumidores BMS devem excluir
---
Câmeras CFTV são Devices com protocol='snmp' (4 pontos padrão: STATUS digital, UPTIME s scale 0.01, MEMORIA_LIVRE kB, PACOTES_PERDIDOS).

**Regras:**
- Queries de equipamentos BMS devem EXCLUIR protocol='snmp' (mesmo padrão do EXCLUDE_VIRTUAL_DEVICES); /cftv usa filtro ONLY_CFTV.
- Saúde da câmera vem do valor do ponto STATUS (gateway publica STATUS=0 quando offline) — recência de telemetria NÃO indica câmera online.
- Telemetria reusa o pipeline BACnet: chave deviceTelemetryKey(id,'snmp',índice do ponto).
- Motor de alarmes é protocol-agnóstico: regra aceita qualquer pointId; STATUS é digital (STATE_CHANGE), demais analógicos.
- Widget SCADA 'camera' tem case explícito no WidgetRenderer ANTES do default de equipamentos; popup de telemetria só quando !staticRender && !isEditor.
- Sidebar: item SCA usa flag comingSoon (renderiza span desabilitado, não Link).

**Why:** câmeras não são equipamentos BMS; contá-las em dashboards/listas de equipamentos distorce números, como aconteceria com devices virtuais.

**Update (ago/2026):** saúde da câmera na UI agora é derivada por `cameraHealthInfo()` (telemetry-format.ts): STATUS≥1 só é Online se dado recente (<5min) OU gateway online (LWT); gateway offline + dado velho → offline reason 'gateway_offline'; sem explicação → unknown. Nunca reintroduzir derivação só por lastValue congelado. gatewayOnline vem no payload REST do CFTV (snapshot; tempo real é follow-up).
