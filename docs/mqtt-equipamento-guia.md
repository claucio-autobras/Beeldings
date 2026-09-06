# Guia — Integração de equipamento MQTT-nativo (BlueBee)

> Como ligar um sensor/equipamento MQTT real à plataforma: o que configurar **no
> equipamento**, o que preencher **no frontend**, o **contrato** entre os dois, e o
> que ainda **falta no código** para o fluxo ficar 100% e seguro em produção.
>
> Contexto técnico do design: `docs/devices-multiprotocolo-design.md`.

---

## 1. Como o dado flui (visão geral)

```
[Equipamento MQTT]  --publica-->  [Broker EMQX]  <--assina--  [Gateway: MqttBridge]
                                                                     |
                                              normaliza + republica  v
                                   bluebee/{tenant}/gateway/{gateway}/telemetry
                                                                     |
                                                                     v
                                              [Backend] --Socket.IO--> [Frontend]
```

Pontos-chave:
- O equipamento **não fala com o gateway diretamente** — os dois falam com o **broker (EMQX)**.
- O equipamento publica no **seu tópico** (dentro do namespace do gateway); o gateway
  **assina, extrai o valor (jsonPath) e republica** no tópico canônico.
- Daí pra frente é igual a BACnet/Modbus — trends, alarmes, status e valor ao vivo
  funcionam sem distinção de protocolo.

---

## 2. Parte A — Configuração NO equipamento MQTT

Configure o cliente MQTT do equipamento com:

| Parâmetro | Valor | Observação |
|-----------|-------|------------|
| **Broker (host)** | IP/hostname do EMQX **alcançável pela rede do equipamento** | No setup de teste é `localhost`; em campo, o IP da máquina/servidor do EMQX |
| **Porta** | `1883` (MQTT) ou a porta TLS, se habilitada | Texto puro no ambiente de teste |
| **Client ID** | Único por equipamento (ex.: `sensor-sala-tecnica-01`) | IDs iguais derrubam um ao outro |
| **Usuário / senha** | Credencial MQTT com permissão de **publicar** no tópico | Ver §5 (provisionamento) — é o item que falta automatizar |
| **Tópico de publicação** | `bluebee/{tenantId}/gateway/{gatewayId}/sensors/{sub-tópico}` | Tópico **completo**; o `{sub-tópico}` deve bater com o ponto cadastrado |
| **Payload** | **JSON válido** (aspas nas chaves) | Ex.: `{"temperature": 23.5}` |
| **QoS** | 0 ou 1 | Ambos funcionam |
| **Retain** | Opcional | Retido ajuda o gateway a pegar o último valor ao (re)assinar |
| **Intervalo de publicação** | Livre (on-change ou periódico) | O gateway repassa no instante que chega |
| **TLS** | Só se o broker exigir | Configurar CA/cert quando aplicável |

> ⚠️ **Rede:** o equipamento precisa **alcançar o broker**, não o gateway. Em geral
> estão na mesma LAN. Se o broker for em nuvem, o equipamento precisa de internet.

---

## 3. Parte B — Cadastro NO frontend

Em **Dispositivos → Adicionar Dispositivo → Dispositivo MQTT**:

1. **Cliente / Site / Projeto** — o projeto define **qual gateway** fará o bridge.
   O prefixo do tópico (`bluebee/{tenant}/gateway/{gateway}/sensors/`) é montado a
   partir dessa escolha e exibido na tela.
2. **Nome do equipamento** — nome amigável (ex.: "Sensor de temperatura sala técnica").
3. **Capturar amostra** (recomendado) — digite o **sub-tópico** (ex.: `sala/temp`) e
   clique. O gateway escuta alguns segundos e mostra o payload publicado pelo
   equipamento — assim você confirma que está chegando e descobre o `jsonPath`.
4. **Pontos** — uma linha por variável monitorada:
   - **Tag** — identificador interno (ex.: `TEMP_SALA`).
   - **Nome** — rótulo de exibição.
   - **Sub-tópico** — relativo (ex.: `sala/temp`); a plataforma prefixa o namespace.
   - **jsonPath** — caminho do valor no payload (ex.: `temperature`, `data.temp`).
     Deixe vazio se o payload já for o valor cru.
   - **Tipo** — `number` (analógico) ou `boolean` (liga/desliga).
   - **Unidade** — °C, %, V, bar…
5. **Salvar** — o backend publica a config; o gateway passa a assinar os tópicos e a
   republicar a telemetria. O valor aparece **ao vivo** na tela do device.

> Um equipamento que publica vários campos num payload só
> (`{"temperature":23,"humidity":60}`) vira **vários pontos**, mesmo sub-tópico,
> `jsonPath` diferente por linha.

---

## 4. Parte C — Contrato (a "interface" sensor ↔ plataforma)

Este é o acordo que precisa casar dos dois lados:

- **Tópico:** `bluebee/{tenantId}/gateway/{gatewayId}/sensors/{sub-tópico}`
  - `tenantId` e `gatewayId` vêm do projeto escolhido no cadastro.
  - `{sub-tópico}` = o que você digitou no campo "Sub-tópico" do ponto.
- **Payload:** JSON; o valor de cada ponto é lido pelo `jsonPath` configurado.
  - `jsonPath` usa notação por ponto/índice: `temperature`, `data.temp`, `sensores[0].valor`.
  - `boolean`: aceita `true/false`, `1/0`, `on/off`, `ativo/inativo`.

**Exemplo concreto** (gateway de teste `gw-prevent-cascais-teste-bms-2bec2d8e`,
tenant `941f3681-...`):

- Tópico: `bluebee/941f3681-5118-4805-89a4-c8f3b4189e09/gateway/gw-prevent-cascais-teste-bms-2bec2d8e/sensors/sala/temp`
- Payload: `{"temperature": 23.5}`
- Ponto: tag `TEMP_SALA`, sub-tópico `sala/temp`, jsonPath `temperature`, tipo `number`, unidade `°C`.

---

## 5. Parte D — O que FALTA no código para ficar 100%

O fluxo está validado ponta a ponta (commit `a4b4cd0`), mas para produção real com
equipamento de terceiros faltam estes itens:

### 5.1 Provisionamento da credencial do sensor (prioritário — segurança)
**Hoje:** o backend (`emqx-provisioning.service.ts`) cria automaticamente só o usuário
**do gateway**, com ACL `allow` em `bluebee/{tenant}/gateway/{gateway}/#` e `deny #`.
Não existe criação automática de usuário **para o sensor**.

**Consequência:** com um sensor real, hoje seria preciso **criar manualmente** no EMQX
um usuário com permissão de publish nos `sensors/...`. Usar a credencial do próprio
gateway no sensor **funciona, mas é inseguro** (a credencial do gateway também permite
publicar em telemetry/config/commands — um sensor comprometido poderia injetar dado ou
comando falso).

**A fazer:** estender o `EmqxProvisioningService` para, ao cadastrar um device MQTT
(ou por gateway/cliente), gerar uma credencial de sensor com ACL **publish-only** em
`bluebee/{tenant}/gateway/{gateway}/sensors/#`, e exibir usuário/senha no frontend para
configurar no equipamento. Idealmente com rotação/revogação.

### 5.2 Valor MQTT ao vivo no Dashboard
O detalhe do device já mostra valor ao vivo; o card do **Dashboard**
(`DeviceStatusGrid`) ainda exibe valor estático. Ligar à mesma telemetria por tag.

### 5.3 Itens menores
- **Edição de device MQTT** não permite trocar site/gateway (proposital — faz parte do
  tópico). Se um dia for necessário "mover" um sensor de gateway, exige remapear os
  tópicos dos pontos.
- **TLS/credenciais por ambiente** documentadas no provisionamento (quando o broker de
  produção exigir TLS).

---

## 6. Anexo — Testar sem equipamento (simulador)

Enquanto não há hardware, use o simulador que publica no namespace correto:

```powershell
cd apps/gateway
node scripts/sim-mqtt-sensor.mjs
```
Publica `{"temperature": …}` a cada 2s em
`bluebee/{TENANT}/gateway/{GATEWAY}/sensors/sala/temp` (tenant/gateway via env
`TENANT`/`GATEWAY`/`TOPIC`, com defaults do gateway de teste). Produz **JSON válido**
(via `JSON.stringify`) — diferente do `mosquitto_pub` no PowerShell 5.1, que estraga as
aspas do JSON.

> Estado: BACnet ✅ · Modbus ✅ · MQTT ✅ (fluxo validado; falta o item 5.1 para
> produção segura com equipamento de terceiros).
