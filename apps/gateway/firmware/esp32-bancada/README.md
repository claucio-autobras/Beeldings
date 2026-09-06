# ESP32 Bancada — sensores reais + relé (escritório Mooca)

Firmware da bancada de monitoramento do escritório. Substitui o sketch de
telemetria simulada: lê sensores físicos e aciona o módulo relé por comando
MQTT do BlueBee.

## Arquivo

- `esp32-bancada.ino` — abrir no Arduino IDE, placa **ESP32 Dev Module**.

## Bibliotecas (Library Manager)

| Biblioteca | Para quê |
|---|---|
| PubSubClient (Nick O'Leary) | MQTT |
| ArduinoJson (v7) | JSON de telemetria/comando |
| DHT sensor library (Adafruit) + Adafruit Unified Sensor | DHT22 |
| OneWire + DallasTemperature | DS18B20 (se usado no lugar do DHT22) |

## Configuração antes de gravar

No topo do `.ino`, preencher:

- `WIFI_SSID` / `WIFI_PASS`
- `MQTT_USER` / `MQTT_PASS` — usuário `*-sensors` do BlueBee (o mesmo já usado na fase simulada)
- `TENANT_ID` / `GATEWAY_ID` — os mesmos do tópico já cadastrado
- Comentar os `#define HAS_...` dos sensores que ainda não chegaram — o campo
  simplesmente não aparece no JSON (o BlueBee mostra o ponto "sem dados", não zero falso).

## Ligação elétrica (guia rápido)

**Regra de ouro: o ESP32 é 3.3V.** Nunca ligar sinal de 5V direto em um GPIO.
Alimente a placa pelo USB ou por fonte 5V no pino `VIN`; os sensores abaixo
funcionam em 3.3V.

| Sensor | Pino ESP32 | Ligação |
|---|---|---|
| DHT22 (temp/umidade) | GPIO 4 | VCC→3.3V, GND→GND, DATA→GPIO4 com resistor pull-up 10 kΩ entre DATA e 3.3V |
| DS18B20 (alternativa) | GPIO 4 | VCC→3.3V, GND→GND, DATA→GPIO4 com pull-up 4.7 kΩ entre DATA e 3.3V |
| Porta (reed magnético) | GPIO 27 | um fio no GPIO27, outro no GND (o firmware usa `INPUT_PULLUP`; porta fechada = ímã junto = contato fechado) |
| Presença (PIR HC-SR501) | GPIO 26 | VCC→5V (VIN), GND→GND, OUT→GPIO26 (a saída do HC-SR501 é 3.3V, pode ir direto) |
| Módulo relé (1 canal) | GPIO 25 | VCC→5V (VIN), GND→GND, IN→GPIO25. A maioria é **ativa em LOW** (`RELAY_ACTIVE_LOW true` no sketch) |

**O que NÃO fazer:**

- **NÃO** ligar 110/220V nos contatos do relé por conta própria — a parte de
  potência (lâmpada/circuito do escritório) é do eletricista. O firmware só
  aciona a bobina do módulo.
- **NÃO** alimentar a bobina do relé pelo pino 3.3V do ESP32 (corrente demais);
  usar o 5V do `VIN`/USB.
- **NÃO** ligar saída de sensor 5V (alguns módulos antigos) direto no GPIO —
  usar divisor de tensão (ex.: 10k/20k) se o módulo não for 3.3V na saída.
- Se o relé "bater" sozinho no boot: é normal um pulso curto nos GPIOs durante
  o reset; o GPIO 25 foi escolhido por não ser strapping pin, e o firmware
  força o relé DESLIGADO no `setup()`.

## MQTT (contrato com o BlueBee)

- Broker: `mqtt.bluebee.ia.br:8883` (TLS; por enquanto `setInsecure()` — trocar
  por `setCACert(...)` quando fixarmos a cadeia do certificado).
- Telemetria: `bluebee/{tenant}/gateway/{gateway}/sensors/bancada/esp32`
  a cada 10 s **e imediatamente** quando porta/presença mudam ou o relé é acionado:

  ```json
  {"temp": 24.5, "umidade": 63.0, "rele": false, "porta": false, "presenca": false}
  ```

- Comando (relé): subscreve `.../sensors/bancada/esp32/cmd`, espera
  `{"id": 123, "value": 1}` e responde em `.../sensors/bancada/esp32/cmd/rpc`
  com `{"id": 123, "value": true}` (o gateway casa a resposta pelo `id`).

## Checklist no BlueBee (quando o hardware estiver ligado)

1. **Pontos novos** no dispositivo "ESP32 Bancada" (mesmo tópico `bancada/esp32`):
   - `porta` — digital, jsonPath `porta` (true = aberta)
   - `presenca` — digital, jsonPath `presenca`
   (`temp`, `umidade`, `rele` já existem da fase simulada.)
2. **Ponto RELE comandável**: recriar/editar o ponto `rele` marcando escrita, com
   sub-tópico de comando `bancada/esp32/cmd`, template
   `{"id": {{id}}, "value": {{value}}}` e tópico de resposta `bancada/esp32/cmd/rpc`.
3. **Trends**: habilitar trend em `temp`, `umidade` e `porta`.
4. **Alarmes sugeridos**:
   - Temperatura alta: `temp > 30` (severidade alta)
   - Porta aberta fora de horário: `porta = true` com janela de horário (ex.: 22h–6h)
   - Sensor mudo: sem comunicação do dispositivo (alarme de comunicação padrão)
5. **Teste ponta a ponta do relé**: como a tela de detalhe do ponto MQTT não tem
   botão de teste de escrita, criar um widget de comando (switch) numa tela SCADA
   vinculado ao ponto `rele` e acionar por lá — o estado deve confirmar e a
   telemetria refletir na hora. (Depende da produção estar atualizada com o
   suporte SCADA a pontos MQTT.)
