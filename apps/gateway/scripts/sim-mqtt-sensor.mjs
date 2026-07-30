/**
 * sim-mqtt-sensor.mjs — Simulador de sensor MQTT-nativo (DEV/TESTE).
 *
 * Publica um payload JSON num tópico a cada 2s, com a temperatura variando,
 * para testar o bridge MQTT do gateway sem hardware real.
 *
 * Uso (dentro de apps/gateway, onde a lib `mqtt` está instalada):
 *   node scripts/sim-mqtt-sensor.mjs
 *
 * Variáveis opcionais (sobrescrevem os defaults):
 *   BROKER  (default mqtt://localhost:1883)
 *   USER    (default backend-bluebee-01)
 *   PASS    (default bluebee2026)
 *   TOPIC   (default no namespace do gateway — ver abaixo)
 *
 * IMPORTANTE: o sensor precisa publicar DENTRO do namespace do gateway
 * (bluebee/{tenant}/gateway/{gateway}/sensors/...), que é o que a ACL do gateway
 * libera. No frontend você informa só o sub-tópico relativo (ex.: "sala/temp").
 */
import mqtt from 'mqtt';

const broker = process.env.BROKER || 'mqtt://localhost:1883';
const username = process.env.USER || 'backend-bluebee-01';
const password = process.env.PASS || 'bluebee2026';
const TENANT = process.env.TENANT || '941f3681-5118-4805-89a4-c8f3b4189e09';
const GATEWAY = process.env.GATEWAY || 'gw-prevent-cascais-teste-bms-2bec2d8e';
const topic = process.env.TOPIC || `bluebee/${TENANT}/gateway/${GATEWAY}/sensors/sala/temp`;

const client = mqtt.connect(broker, {
  clientId: `sim-sensor-${Date.now()}`,
  username,
  password,
  clean: true,
});

client.on('connect', () => {
  console.log(`Conectado a ${broker} — publicando em "${topic}" a cada 2s. Ctrl+C para parar.`);
  setInterval(() => {
    // Temperatura oscilando entre ~21 e ~25 °C
    const temperature = +(23 + 2 * Math.sin(Date.now() / 10000)).toFixed(2);
    const payload = JSON.stringify({ temperature, ts: new Date().toISOString() });
    client.publish(topic, payload, { qos: 0 });
    console.log(`→ ${topic}  ${payload}`);
  }, 2000);
});

client.on('error', (err) => {
  console.error('Erro MQTT:', err.message);
  process.exit(1);
});
