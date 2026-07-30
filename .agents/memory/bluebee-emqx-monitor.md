---
name: EMQX broker monitor
description: Broker health/alerting via EMQX REST API — which dropped metrics matter, sentinel tenant, hysteresis.
---

- `messages.dropped` no EMQX é dominado por `messages.dropped.no_subscribers` (benigno: publicar sem assinante é normal em MQTT e cresce continuamente — ~900k em dev). Alertas devem usar apenas o descarte RELEVANTE: `messages.dropped - no_subscribers` + `delivery.dropped` (fila cheia/expirado/oversize).
- **Why:** alertar sobre o total bruto geraria spam permanente de falsos positivos.
- Avisos de sistema para admins globais usam AlarmEvent kind=AUTOMATION_NOTICE com tenantId sentinela `__system__` (sem FK em AlarmEvent.tenantId, seguro); telemetry.gateway emite só em SCOPE_ALL para esse sentinela; feed legacy inclui essas linhas para roles globais.
- Histerese do monitor: 2 coletas anormais → alerta; 10 saudáveis → rearma; cooldown 30min; 3 falhas de coleta → alerta "inacessível". Cooldown inicial = -Infinity (senão bloqueia o 1º alerta em testes com relógio pequeno).
- Config: EMQX_API_URL/KEY/SECRET (mesmas do provisioning); sem URL → configured:false e monitor fica ocioso. Limpeza de retained no deprovisionamento: DELETE /mqtt/retainer/message/{topic} (status/health/config), best-effort, 404 ok.
