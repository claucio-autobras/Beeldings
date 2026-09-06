/**
 * Script de diagnóstico BACnet — executar com gateway e Node-RED PARADOS
 * Uso: node test-bacnet.js
 */
const bacnet = require('node-bacnet');
const dgram  = require('dgram');

const DEVICE_IP  = '10.201.10.11';
const TIMEOUT_MS = 3000;

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: false });
    sock.once('error', () => { sock.close(); resolve(false); });
    sock.bind(port, '0.0.0.0', () => { sock.close(); resolve(true); });
  });
}

function readProp(client, ip, objId, propId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    client.readProperty(ip, objId, propId, (err, value) => {
      clearTimeout(timer);
      if (err) resolve(null);
      else resolve(value);
    });
  });
}

function parseString(raw) {
  return raw?.values?.[0]?.value?.[0]?.value ?? null;
}

function parseEnum(raw) {
  const v = raw?.values?.[0]?.value?.[0]?.value;
  return v != null ? Number(v) : null;
}

const UNIT_MAP = {
  62:'°C', 64:'°F', 55:'%', 53:'Pa', 141:'bar',
  84:'A', 116:'V', 48:'W', 93:'kWh', 83:'m³/h',
  186:'l/s', 47:'Hz', 119:'rpm', 98:'', 5:'V'
};

const TYPE_LABEL = { 0:'AI', 1:'AO', 2:'AV', 3:'BI', 4:'BO', 5:'BV', 13:'MSI', 14:'MSO' };

// Tipos analógicos que têm unidade
const ANALOG = new Set([0, 1, 2]);

async function scanObjectType(client, objectType, maxInstance) {
  const found = [];
  console.log(`  Escaneando ${TYPE_LABEL[objectType] ?? objectType} (0..${maxInstance-1})...`);
  for (let inst = 0; inst < maxInstance; inst++) {
    const nameRaw = await readProp(client, DEVICE_IP, { type: objectType, instance: inst }, 77);
    if (!nameRaw) continue; // objeto não existe ou timeout

    const name = parseString(nameRaw) ?? `${TYPE_LABEL[objectType]}_${inst}`;
    let unit = null;

    if (ANALOG.has(objectType)) {
      const unitsRaw = await readProp(client, DEVICE_IP, { type: objectType, instance: inst }, 117);
      const code = parseEnum(unitsRaw);
      unit = code != null ? (UNIT_MAP[code] ?? `unit${code}`) : null;
    }

    found.push({ objectType, objectInstance: inst, objectName: name, unit });
    console.log(`    ✅ ${TYPE_LABEL[objectType]} ${inst}: "${name}" ${unit ? `[${unit}]` : ''}`);
  }
  return found;
}

async function run() {
  console.log('=== BlueBee BACnet Enumeration Discovery ===');
  console.log(`Alvo: ${DEVICE_IP}\n`);

  const portFree = await checkPortAvailable(47808);
  if (!portFree) {
    console.log('⚠️  AVISO: porta 47808 em uso. Pare o gateway e o Node-RED!\n');
  } else {
    console.log('✅ Porta 47808 livre\n');
  }

  const client = new bacnet({ port: 47808 });

  // Teste rápido de conectividade
  console.log('Verificando conectividade (BI 0)...');
  const biTest = await readProp(client, DEVICE_IP, { type: 3, instance: 0 }, 85);
  if (!biTest) {
    console.log('❌ FALHA: não consegue ler BI 0. Verifique IP e rede.\n');
    client.close(); process.exit(1);
  }
  const biVal = biTest?.values?.[0]?.value?.[0]?.value;
  console.log(`✅ Conectividade OK — BI 0 presentValue = ${biVal}\n`);

  // Enumeração de todos os tipos do MPC46D
  console.log('Iniciando enumeração de objetos...\n');
  const allObjects = [];

  // MPC46D: AI 0-25, AO 0-3, AV 0-15, BI 0-25, BO 0-15, BV 0-7
  for (const [type, max] of [[3,26],[4,16],[0,26],[1,4],[2,16],[5,8]]) {
    const objs = await scanObjectType(client, type, max);
    allObjects.push(...objs);
    console.log('');
  }

  console.log(`\n=== Total: ${allObjects.length} objetos encontrados ===`);
  console.log(JSON.stringify(allObjects, null, 2));

  client.close();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
