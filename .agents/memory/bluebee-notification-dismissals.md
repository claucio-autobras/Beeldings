---
name: Dispensa persistente de notificações do sino
description: Como as notificações limpas do sino ficam persistidas por usuário e por que a chave inclui timestamp de atividade
---
Dispensas do sino (alarmes de telemetria + dispositivos offline) vivem em `users.preferences.dismissedNotifications` (JSONB, chave → epoch ms da dispensa). Avisos de automação continuam persistidos via `POST /alarms/notices/read` (viram NORMALIZED_ACK) — dois mecanismos distintos, não unificar.

**Regra:** a chave de dispensa DEVE incluir o timestamp da última atividade — `alarm:{id}:{lastReactivatedAt ?? occurredAt}` e `offline:{deviceId}:{lastCommunication}` — porque a reativação REUSA a mesma ocorrência (mesmo id). Chave só por id silenciaria reativações futuras.

**Higiene:** sanitizador do backend expira entradas >30d e limita a 500 (mais recentes), rodando em toda leitura/escrita das preferências; o frontend espelha. O legacy `/alarms` precisou expor `lastReactivatedAt` para a chave.

**Cuidado:** dispensar NÃO faz ACK — o alarme continua ativo na tela de alarmes; só some do sino.
