/**
 * BlueBee — ESP32 Bancada (escritório Mooca)
 * ==========================================
 * Firmware de PRODUÇÃO da bancada: lê sensores reais e aciona o módulo relé,
 * substituindo a telemetria simulada do sketch anterior.
 *
 * Telemetria (a cada TELEMETRY_INTERVAL_MS):
 *   Tópico:  bluebee/{TENANT_ID}/gateway/{GATEWAY_ID}/sensors/bancada/esp32
 *   Payload: {"temp": 24.5, "umidade": 63.0, "rele": false, "porta": false, "presenca": false}
 *     - temp / umidade : DHT22 (ou DS18B20, ver USE_DS18B20 — sem umidade nesse caso)
 *     - rele           : estado atual do módulo relé (true = ligado)
 *     - porta          : sensor magnético (reed) — true = porta ABERTA
 *     - presenca       : sensor PIR — true = movimento detectado
 *   Campos de sensores não instalados podem ser desabilitados nos #define.
 *
 * Comando (padrão já usado pelo BlueBee para pontos MQTT comandáveis):
 *   Subscreve: .../sensors/bancada/esp32/cmd
 *   Payload:   {"id": 123, "value": 1}   (template no BlueBee: {"id": {{id}}, "value": {{value}}})
 *   Resposta:  .../sensors/bancada/esp32/cmd/rpc  →  {"id": 123, "value": true}
 *   O gateway casa a resposta pelo campo JSON "id". Após acionar o relé, o
 *   firmware também publica telemetria imediatamente (estado novo aparece na hora).
 *
 * Bibliotecas (Library Manager do Arduino IDE):
 *   - PubSubClient (Nick O'Leary)
 *   - ArduinoJson (Benoit Blanchon, v7)
 *   - DHT sensor library (Adafruit) + Adafruit Unified Sensor   [se DHT22]
 *   - OneWire + DallasTemperature                               [se DS18B20]
 *
 * Placa: "ESP32 Dev Module". Leia o README.md ao lado ANTES de ligar os fios.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ========================== CONFIGURAÇÃO ==========================
// --- Wi-Fi ---
#define WIFI_SSID     "SUA_REDE_WIFI"
#define WIFI_PASS     "SUA_SENHA_WIFI"

// --- MQTT / BlueBee ---
#define MQTT_HOST     "mqtt.bluebee.ia.br"
#define MQTT_PORT     8883
#define MQTT_USER     "USUARIO_SENSORS"      // usuário *-sensors criado no BlueBee
#define MQTT_PASS     "SENHA_SENSORS"
#define TENANT_ID     "SEU_TENANT_ID"
#define GATEWAY_ID    "SEU_GATEWAY_ID"

#define TELEMETRY_INTERVAL_MS 10000UL        // 10 s

// --- Sensores instalados (comente para desabilitar o campo no JSON) ---
#define HAS_TEMP_HUM      // DHT22 (temp + umidade)
// #define USE_DS18B20    // troca o DHT22 por DS18B20 (só temp; "umidade" some do JSON)
#define HAS_DOOR          // sensor magnético de porta (reed)
#define HAS_PIR           // sensor de presença PIR

// --- Pinos (ver README.md) ---
#define PIN_DHT       4    // dado do DHT22 (pull-up 10k para 3.3V)
#define PIN_DS18B20   4    // dado do DS18B20 (pull-up 4.7k para 3.3V) — se USE_DS18B20
#define PIN_DOOR      27   // reed p/ GND, INPUT_PULLUP (fechado = LOW)
#define PIN_PIR       26   // saída do PIR (módulos HC-SR501 saem 3.3V, ok direto)
#define PIN_RELAY     25   // IN do módulo relé
#define RELAY_ACTIVE_LOW true  // maioria dos módulos relé de 1 canal é ativo em LOW
// ==================================================================

#if defined(HAS_TEMP_HUM) && !defined(USE_DS18B20)
  #include <DHT.h>
  DHT dht(PIN_DHT, DHT22);
#endif
#if defined(HAS_TEMP_HUM) && defined(USE_DS18B20)
  #include <OneWire.h>
  #include <DallasTemperature.h>
  OneWire oneWire(PIN_DS18B20);
  DallasTemperature ds18b20(&oneWire);
#endif

const String TOPIC_BASE = String("bluebee/") + TENANT_ID + "/gateway/" + GATEWAY_ID + "/sensors/bancada/esp32";
const String TOPIC_TELEMETRY = TOPIC_BASE;
const String TOPIC_CMD       = TOPIC_BASE + "/cmd";
const String TOPIC_CMD_RPC   = TOPIC_BASE + "/cmd/rpc";

WiFiClientSecure tls;
PubSubClient mqtt(tls);

bool relayOn = false;
unsigned long lastTelemetry = 0;

void setRelay(bool on) {
  relayOn = on;
  digitalWrite(PIN_RELAY, RELAY_ACTIVE_LOW ? (on ? LOW : HIGH) : (on ? HIGH : LOW));
}

void publishTelemetry() {
  JsonDocument doc;

#if defined(HAS_TEMP_HUM) && !defined(USE_DS18B20)
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) doc["temp"] = ((int)(t * 10)) / 10.0;
  if (!isnan(h)) doc["umidade"] = ((int)(h * 10)) / 10.0;
#endif
#if defined(HAS_TEMP_HUM) && defined(USE_DS18B20)
  ds18b20.requestTemperatures();
  float t = ds18b20.getTempCByIndex(0);
  if (t > -100) doc["temp"] = ((int)(t * 10)) / 10.0;
#endif

  doc["rele"] = relayOn;

#ifdef HAS_DOOR
  // INPUT_PULLUP + reed para GND: fechado = LOW. "porta": true = ABERTA.
  doc["porta"] = (digitalRead(PIN_DOOR) == HIGH);
#endif
#ifdef HAS_PIR
  doc["presenca"] = (digitalRead(PIN_PIR) == HIGH);
#endif

  char buf[256];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(TOPIC_TELEMETRY.c_str(), (const uint8_t*)buf, n, false);
  Serial.printf("[telemetria] %s\n", buf);
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  if (TOPIC_CMD != topic) return;

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[cmd] payload inválido: %s\n", err.c_str());
    return;
  }

  bool value = false;
  JsonVariant v = doc["value"];
  if (v.is<bool>()) value = v.as<bool>();
  else value = (v.as<float>() != 0);

  setRelay(value);
  Serial.printf("[cmd] rele -> %s\n", value ? "ON" : "OFF");

  // Resposta RPC (o gateway casa pelo campo "id")
  JsonDocument resp;
  if (!doc["id"].isNull()) resp["id"] = doc["id"];
  resp["value"] = relayOn;
  char buf[128];
  size_t n = serializeJson(resp, buf, sizeof(buf));
  mqtt.publish(TOPIC_CMD_RPC.c_str(), (const uint8_t*)buf, n, false);

  // Estado novo na telemetria imediatamente
  publishTelemetry();
  lastTelemetry = millis();
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("Wi-Fi: conectando em %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nWi-Fi OK, IP %s\n", WiFi.localIP().toString().c_str());
}

void connectMqtt() {
  while (!mqtt.connected()) {
    connectWifi();
    String clientId = String("esp32-bancada-") + String((uint32_t)ESP.getEfuseMac(), HEX);
    Serial.printf("MQTT: conectando em %s:%d... ", MQTT_HOST, MQTT_PORT);
    if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println("OK");
      mqtt.subscribe(TOPIC_CMD.c_str(), 1);
      Serial.printf("Subscrito em %s\n", TOPIC_CMD.c_str());
    } else {
      Serial.printf("falhou (rc=%d), tentando em 3s\n", mqtt.state());
      delay(3000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nBlueBee ESP32 Bancada — sensores reais + rele");

  pinMode(PIN_RELAY, OUTPUT);
  setRelay(false);  // relé sempre inicia DESLIGADO
#ifdef HAS_DOOR
  pinMode(PIN_DOOR, INPUT_PULLUP);
#endif
#ifdef HAS_PIR
  pinMode(PIN_PIR, INPUT);
#endif
#if defined(HAS_TEMP_HUM) && !defined(USE_DS18B20)
  dht.begin();
#endif
#if defined(HAS_TEMP_HUM) && defined(USE_DS18B20)
  ds18b20.begin();
#endif

  // TLS sem validação de certificado por enquanto (broker com cert público);
  // trocar por setCACert(...) quando fixarmos a cadeia do broker.
  tls.setInsecure();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setBufferSize(512);

  connectMqtt();
  publishTelemetry();
  lastTelemetry = millis();
}

#ifdef HAS_DOOR
bool lastDoorOpen = false;
bool doorInit = false;
#endif
#ifdef HAS_PIR
bool lastPir = false;
#endif

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  unsigned long now = millis();
  bool publishNow = (now - lastTelemetry >= TELEMETRY_INTERVAL_MS);

  // Eventos digitais publicam na hora (porta abriu/fechou, presença mudou)
#ifdef HAS_DOOR
  bool doorOpen = (digitalRead(PIN_DOOR) == HIGH);
  if (!doorInit) { lastDoorOpen = doorOpen; doorInit = true; }
  if (doorOpen != lastDoorOpen) { lastDoorOpen = doorOpen; publishNow = true; }
#endif
#ifdef HAS_PIR
  bool pir = (digitalRead(PIN_PIR) == HIGH);
  if (pir != lastPir) { lastPir = pir; publishNow = true; }
#endif

  if (publishNow) {
    publishTelemetry();
    lastTelemetry = now;
  }
}
