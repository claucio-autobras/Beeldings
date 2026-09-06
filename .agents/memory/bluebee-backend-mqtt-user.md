---
name: Backend MQTT credential no EMQX
description: Renomear MQTT_USERNAME do backend exige provisionar o usuário no EMQX; recuperação e log de recusa de auth.
---

# Credencial MQTT do backend

- O username do backend (Secret `MQTT_USERNAME`) é um usuário do
  `password_based:built_in_database` do EMQX com `is_superuser: true` (sem ACL —
  superuser ignora autorização). **Renomear o username exige criar o usuário
  novo via API do EMQX antes** — senão o broker recusa com CONNACK 4/5 e o
  backend fica sem telemetria/status/saúde de gateways.
- **Recuperação sem redeploy:** mqtt.js retenta a cada 5s para sempre; criado o
  usuário no broker, o backend de produção reconecta sozinho no próximo retry.
- Recusa de autenticação agora gera log ERROR explícito e recorrente no
  MqttService (reason codes 4/5 MQTT 3.1.1 e 134/135 MQTT 5). Verificado:
  senha errada → `err.code = 4`.
- API do EMQX acessível do shell via Secrets `EMQX_API_URL`/`EMQX_API_KEY`/
  `EMQX_API_SECRET` (Basic key:secret). Clientes conectados:
  `GET /clients?like_username=...`.
- Usuário antigo `backend-bluebee-01` mantido de propósito (ainda havia cliente
  conectado com ele em ago/2026) — descomissionar só depois de confirmar que
  nada mais o usa.
