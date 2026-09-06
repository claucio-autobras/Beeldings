// Fase 2 — publisher MQTT sintético (device audit-load-dev, 40 pontos).
// Uso: node mqtt-flood.js <msgsPorSegundo> <duracaoSegundos> [dupTest]
const mqtt = require('mqtt');

const RATE = Number(process.argv[2] || 10);
const DUR = Number(process.argv[3] || 30);
const DUP = process.argv[4] === 'dup';

const TENANT = 'b9823a90-1d77-4a8a-b8c6-67189e161504';
const GW = 'gw-teste-2-teste-8899a148';
const TOPIC = `bluebee/${TENANT}/gateway/${GW}/telemetry`;

const client = mqtt.connect(process.env.MQTT_BROKER_URL, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  clientId: `audit-load-${Date.now()}`,
});

let sent = 0, errors = 0;
client.on('connect', () => {
  console.log('connected; publishing', RATE, 'msg/s for', DUR, 's', DUP ? '(dup test)' : '');
  const start = Date.now();
  const iv = setInterval(() => {
    if (Date.now() - start >= DUR * 1000) {
      clearInterval(iv);
      const wrap = () => { console.log(JSON.stringify({ sent, errors, elapsedMs: Date.now() - start })); client.end(); };
      setTimeout(wrap, 1500);
      return;
    }
    for (let i = 0; i < RATE; i++) {
      const payload = JSON.stringify({
        deviceId: 'audit-load-dev',
        timestamp: new Date().toISOString(),
        points: Array.from({ length: 40 }, (_, k) => ({ tag: `lt_${k}`, value: Math.random() * 100 })),
      });
      client.publish(TOPIC, payload, { qos: 0 }, (e) => { if (e) errors++; });
      sent++;
      if (DUP) { client.publish(TOPIC, payload, { qos: 0 }); } // mesma mensagem 2x (idempotência)
    }
  }, 1000);
});
client.on('error', (e) => { console.error('mqtt error', e.message); process.exit(1); });
