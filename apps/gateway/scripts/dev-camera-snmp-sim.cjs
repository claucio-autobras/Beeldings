/**
 * Simulador SNMP de câmera Hikvision para testes locais.
 *
 * OIDs implementados — alinhados com os perfis do gateway:
 *
 *  BASE CAMERA PROFILE (base-camera):
 *   1.3.6.1.2.1.1.3.0          sysUpTime (TimeTicks crescente)
 *   1.3.6.1.2.1.25.3.3.1.2.1   hrProcessorLoad (cpu MIB-II genérico)
 *   1.3.6.1.4.1.2021.4.6.0     memAvailReal (UCD-SNMP, memória disponível kB)
 *
 *  HIKVISION VENDOR PROFILE (sobrepõe base):
 *   1.3.6.1.2.1.1.1.0          sysDescr → "Hikvision DS-2CD2T47G2-L ..."
 *   1.3.6.1.2.1.1.2.0          sysObjectId → 1.3.6.1.4.1.39165.1.1
 *   1.3.6.1.4.1.39165.1.7.0    hikCpu
 *   1.3.6.1.4.1.39165.1.11.0   hikMemory (%)
 *   1.3.6.1.4.1.39165.1.10.0   hikRamTotal (MB)
 *   1.3.6.1.4.1.39165.1.9.0    hikStorage (%)
 *
 *  Nota: 1.3.6.1.2.1.2.2.1.13.1 (packet_loss / ifInDiscards) é uma coluna de
 *  tabela — registada como escalar no caminho completo; o gateway fará GET
 *  directo sobre o OID total e receberá Counter=0 (sem descarte).
 *
 * Uso:  node scripts/dev-camera-snmp-sim.cjs [porta] [community]
 * Ex:   node scripts/dev-camera-snmp-sim.cjs 1161 public
 *
 * Alterar valores via stdin JSON: {"cpu":55,"memory":70}
 */

'use strict';

const snmp  = require('net-snmp');

const PORT      = Number(process.argv[2] ?? 1161);
const COMMUNITY = process.argv[3] ?? 'public';

const state = { cpu: 37, memory: 61, storage: 28, ram_total: 256 };
const startMs = Date.now();

// ─── Agente ───────────────────────────────────────────────────────────────────

const agent = snmp.createAgent({
  port:           PORT,
  address:        '0.0.0.0',
  transport:      'udp4',
  disableAuthorization: true,
  accessControlModelType: snmp.AccessControlModelType.None,
}, (err) => { if (err) console.error('[SNMP-sim] req error:', err.message); });

const mib = agent.mib;
const RO  = snmp.MaxAccess['read-only'];

const reg = (name, oid, type, val) => {
  agent.registerProvider({ name, type: snmp.MibProviderType.Scalar, oid, scalarType: type, maxAccess: RO });
  mib.setScalarValue(name, val);
};

// ── MIB-II system ─────────────────────────────────────────────────────────────
reg('sysDescr',   '1.3.6.1.2.1.1.1', snmp.ObjectType.OctetString,
  Buffer.from('Hikvision DS-2CD2T47G2-L Firmware 5.7.0 Build 221202'));
reg('sysObjectId','1.3.6.1.2.1.1.2', snmp.ObjectType.OID,
  '1.3.6.1.4.1.39165.1.1');
reg('sysUpTime',  '1.3.6.1.2.1.1.3', snmp.ObjectType.TimeTicks,
  Math.floor((Date.now() - startMs) / 10));

// ── MIB-II IF-MIB — ifInDiscards iface 1 (packet_loss proxy) ─────────────────
// Registado como escalar no caminho completo (col.13 instância .1).
reg('ifInDiscards1', '1.3.6.1.2.1.2.2.1.13.1', snmp.ObjectType.Counter, 0);

// ── HOST-RESOURCES hrProcessorLoad — índice .1 ───────────────────────────────
reg('hrProcessorLoad1', '1.3.6.1.2.1.25.3.3.1.2.1', snmp.ObjectType.Integer, state.cpu);

// ── UCD-SNMP memAvailReal (base-camera memory antes do override Hikvision) ───
reg('memAvailReal', '1.3.6.1.4.1.2021.4.6', snmp.ObjectType.Integer, 128000);

// ── Hikvision proprietários ───────────────────────────────────────────────────
reg('hikCpu',      '1.3.6.1.4.1.39165.1.7',  snmp.ObjectType.Integer, state.cpu);
reg('hikMemory',   '1.3.6.1.4.1.39165.1.11', snmp.ObjectType.Integer, state.memory);
reg('hikStorage',  '1.3.6.1.4.1.39165.1.9',  snmp.ObjectType.Integer, state.storage);
reg('hikRamTotal', '1.3.6.1.4.1.39165.1.10', snmp.ObjectType.Integer, state.ram_total);

// ─── Actualização dinâmica via stdin ─────────────────────────────────────────

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  try {
    const patch = JSON.parse(chunk.trim());
    Object.assign(state, patch);
    if (patch.cpu !== undefined) {
      mib.setScalarValue('hikCpu', state.cpu);
      mib.setScalarValue('hrProcessorLoad1', state.cpu);
    }
    if (patch.memory  !== undefined) mib.setScalarValue('hikMemory', state.memory);
    if (patch.storage !== undefined) mib.setScalarValue('hikStorage', state.storage);
    // Avança uptime
    mib.setScalarValue('sysUpTime', Math.floor((Date.now() - startMs) / 10));
    console.log('[SNMP-sim] state updated:', state);
  } catch {/* ignore non-JSON lines */}
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', () => { agent.listener.close(); process.exit(0); });
process.on('SIGINT',  () => { agent.listener.close(); process.exit(0); });

console.log(`[SNMP-sim] Hikvision DS-2CD2T47G2-L em 0.0.0.0:${PORT}  community="${COMMUNITY}"`);
console.log('[SNMP-sim] OIDs: sysDescr, sysObjectId, sysUpTime, ifInDiscards.1, hrProcessorLoad.1, hikCpu, hikMemory, hikStorage, hikRamTotal');
console.log('[SNMP-sim] state inicial:', state);
