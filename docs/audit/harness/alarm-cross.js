// Fase 2 — flood de cruzamentos de limiar no ponto lt_0 (regra GT 50).
// Uso: node alarm-cross.js <msgsPorSegundo> <duracaoSegundos>
const mqtt = require('mqtt');
const RATE = Number(process.argv[2] || 5);
const DUR = Number(process.argv[3] || 10);
const TENANT = 'b9823a90-1d77-4a8a-b8c6-67189e161504';
const TOPIC = `bluebee/${TENANT}/gateway/gw-teste-2-teste-8899a148/telemetry`;
const client = mqtt.connect(process.env.MQTT_BROKER_URL, {
  username: process.env.MQTT_USERNAME, password: process.env.MQTT_PASSWORD,
  clientId: `audit-alarm-${Date.now()}`,
});
let sent = 0, hi = false;
client.on('connect', () => {
  const start = Date.now();
  const iv = setInterval(() => {
    if (Date.now() - start >= DUR * 1000) {
      clearInterval(iv);
      setTimeout(() => { console.log(JSON.stringify({ sent })); client.end(); }, 1500);
      return;
    }
    for (let i = 0; i < RATE; i++) {
      hi = !hi; // alterna acima/abaixo do limite a cada mensagem
      client.publish(TOPIC, JSON.stringify({
        deviceId: 'audit-load-dev',
        timestamp: new Date().toISOString(),
        points: [{ tag: 'lt_0', value: hi ? 90 : 10 }],
      }), { qos: 0 });
      sent++;
    }
  }, 1000);
});
client.on('error', (e) => { console.error('mqtt error', e.message); process.exit(1); });
