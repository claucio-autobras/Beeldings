# Runbook — backup, restauração e re-provisionamento do EMQX

O EMQX roda em **nó único** e guarda três coisas em estado interno (Mnesia,
diretório de dados do broker):

1. **Usuários MQTT** (autenticação `password_based:built_in_database`) — o
   usuário do backend (`MQTT_USERNAME`), um usuário por gateway (`{gatewayId}`),
   o usuário de sensores (`{gatewayId}-sensors`) e o usuário dedicado de cada
   dispositivo em modo tópico raiz (`dev-{deviceId}`).
2. **ACLs** (autorização `built_in_database`) — as regras por usuário acima.
3. **Retained messages** — `status`, `health` e `config` de cada gateway.

Se esse estado se perder (reinstalação, troca de disco, upgrade mal-sucedido),
**todos os clientes passam a ser recusados na conexão** e o sistema fica mudo.
A fonte da verdade das credenciais é o **banco do BlueBee** (`gateway.mqttPass`,
`gateway.sensorMqttPass`, `config.deviceMqttPass` dos devices raiz) — por isso a
recuperação completa leva minutos, sem tocar em cada cadastro.

## 1. Backup do estado do EMQX

Preferido — export nativo via API (gera um arquivo único com auth/ACL/config):

```bash
# dispara o export (EMQX 5.x)
curl -s -u "$EMQX_API_KEY:$EMQX_API_SECRET" -X POST "$EMQX_API_URL/data/export"
# lista os arquivos gerados e baixe o mais recente
curl -s -u "$EMQX_API_KEY:$EMQX_API_SECRET" "$EMQX_API_URL/data/files"
```

Alternativa — backup do diretório de dados com o broker **parado**:

```bash
systemctl stop emqx            # ou: docker stop emqx
tar czf emqx-data-$(date +%F).tar.gz /var/lib/emqx   # ou o volume do container
systemctl start emqx
```

Agende o backup (cron diário) e guarde fora do host do broker.

> Retained messages não precisam de backup: o gateway republica `status`
> (LWT/heartbeat), `health` e o backend republica o `config` de cada gateway no
> boot da instância líder.

## 2. Restauração

Com backup:

```bash
# export nativo: suba o arquivo e importe
curl -s -u "$EMQX_API_KEY:$EMQX_API_SECRET" -X POST "$EMQX_API_URL/data/import" \
  -H 'Content-Type: application/json' -d '{"filename":"<arquivo do export>"}'
# ou, backup de diretório: restaure o tar com o broker parado e suba o broker
```

**Sem backup** (estado perdido de vez), siga o re-provisionamento abaixo.

## 3. Re-provisionamento a partir do banco

Pré-requisito: o **usuário do backend** precisa existir no broker (senão nem o
backend conecta). Ele é criado manualmente uma única vez:

```bash
curl -s -u "$EMQX_API_KEY:$EMQX_API_SECRET" -X POST \
  "$EMQX_API_URL/authentication/password_based:built_in_database/users" \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"<MQTT_USERNAME>","password":"<MQTT_PASSWORD>","is_superuser":true}'
```

Depois, escolha um dos caminhos (ambos idempotentes):

- **Ação administrativa**: área de admin global → Servidores → card
  "Broker MQTT (EMQX)" → **Re-provisionar credenciais** (ou
  `POST /health/broker/reprovision`, ADMIN global). Recria usuário + ACL de
  todos os gateways, usuários de sensores e dispositivos de tópico raiz,
  retornando um relatório com contagens e erros.
- **Verificação automática no boot**: a instância líder do backend confere, ao
  subir, se os usuários dos gateways existem no EMQX. Se algum sumiu, dispara o
  re-provisionamento completo sozinha (veja os logs de `EmqxReprovisionService`).

Casos que exigem ação manual (aparecem no relatório):

- Dispositivo raiz **sem senha persistida** no cadastro: a ACL é reaplicada,
  mas a credencial precisa ser recriada na tela do dispositivo.
- Credenciais que o EMQX rejeitar por outra razão (erro listado por item).

## 4. Verificação pós-recuperação

1. **Backend conectado**: o banner vermelho "Backend recusado por autenticação"
   some da página Servidores; `GET /health/comms` → `mqtt.connected: true` e
   `mqtt.authRefused: false`.
2. **Gateways reconectam**: em ~1 min o card do broker volta a mostrar as
   conexões e os gateways aparecem **online** (LWT/heartbeat) nas telas.
3. **Telemetria volta**: valores ao vivo atualizando nos equipamentos; a fila
   store-and-forward dos gateways drena sozinha (telemetria atrasada **não**
   reanima gateway que caiu de novo — só dados comprovadamente novos).
4. Dispositivos de tópico raiz (ex.: Aeris) voltam a publicar/aceitar comandos.

## Sinais de credencial recusada (como o problema aparece)

- Log do backend: `MQTT: AUTENTICAÇÃO RECUSADA pelo broker …` (o backend recua
  a reconexão para 60 s para não ser banido pelo flapping_detect do broker).
- Página Servidores: banner vermelho no topo do card do broker.
- `GET /health/comms`: `mqtt.authRefused: true` + `lastAuthRefusedAt`.
