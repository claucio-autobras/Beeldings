// Simulador de câmera Intelbras (firmware derivado do Dahua) para validar a
// telemetria multi-fabricante sem hardware: rode
// `node scripts/dev-camera-intelbras-sim.cjs` (porta 1162) e aponte uma câmera
// SNMP para 127.0.0.1:1162. Reproduz os bugs conhecidos: CPU e memória
// respondem 0 fixo (sentinela → "dado não confiável"); temperatura responde
// valor real. Árvore enterprise 1.3.6.1.4.1.1004849 (compartilhada Dahua).
const snmp = require('net-snmp');

const PORT = Number(process.env.SIM_PORT || 1162);

const agent = snmp.createAgent(
  { port: PORT, address: '127.0.0.1', disableAuthorization: true },
  (err) => {
    if (err) console.error('agent error', err.message);
  },
);
const mib = agent.getMib();

function scalar(name, oid, type, value) {
  mib.registerProvider({
    name,
    type: snmp.MibProviderType.Scalar,
    oid,
    scalarType: type,
    maxAccess: snmp.MaxAccess['read-only'],
  });
  mib.setScalarValue(name, value);
}

// MIB-II system — sysDescr identifica a marca (Camada de identificação).
scalar('sysDescr', '1.3.6.1.2.1.1.1', snmp.ObjectType.OctetString,
  'Intelbras VIP 3230 B SL V4.2.1 build 2023-05');
scalar('sysObjectID', '1.3.6.1.2.1.1.2', snmp.ObjectType.OID, '1.3.6.1.4.1.1004849.1.1');
scalar('sysUpTime', '1.3.6.1.2.1.1.3', snmp.ObjectType.TimeTicks, 8640000); // 1 dia
scalar('sysName', '1.3.6.1.2.1.1.5', snmp.ObjectType.OctetString, 'CAM-INTELBRAS-01');

// Árvore Dahua/Intelbras — bugs conhecidos: CPU/memória respondem 0 fixo.
// Os OIDs reais são células de tabela (…3.N.1.1) — modela como tabela:
// entry …2.1.3.N.1, coluna 1, índice 1 → instância …2.1.3.N.1.1.
function dahuaCell(name, entryOid, value) {
  mib.registerProvider({
    name,
    type: snmp.MibProviderType.Table,
    oid: entryOid,
    maxAccess: snmp.MaxAccess['not-accessible'],
    tableColumns: [
      { number: 1, name: `${name}Value`, type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
      { number: 99, name: `${name}Index`, type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
    ],
    tableIndex: [{ columnName: `${name}Index` }],
  });
  mib.addTableRow(name, [value, 1]);
}
// …2.1.3.1.1.1 (cpu) / …2.1.3.2.1.1 (memória) / …2.1.3.3.1.1 (temperatura)
dahuaCell('dahuaCpu', '1.3.6.1.4.1.1004849.2.1.3.1', 0);
dahuaCell('dahuaMem', '1.3.6.1.4.1.1004849.2.1.3.2', 0);
dahuaCell('dahuaTemp', '1.3.6.1.4.1.1004849.2.1.3.3', 47);

// MIB-II interfaces (fallback Camada 1 de packet_loss).
scalar('ifNumber', '1.3.6.1.2.1.2.1', snmp.ObjectType.Integer, 1);
mib.registerProvider({
  name: 'ifEntry',
  type: snmp.MibProviderType.Table,
  oid: '1.3.6.1.2.1.2.2.1',
  maxAccess: snmp.MaxAccess['not-accessible'],
  tableColumns: [
    { number: 1, name: 'ifIndex', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
    { number: 13, name: 'ifInDiscards', type: snmp.ObjectType.Counter, maxAccess: snmp.MaxAccess['read-only'] },
    { number: 14, name: 'ifInErrors', type: snmp.ObjectType.Counter, maxAccess: snmp.MaxAccess['read-only'] },
  ],
  tableIndex: [{ columnName: 'ifIndex' }],
});
mib.addTableRow('ifEntry', [1, 2, 1]);

console.log(`Intelbras camera SNMP simulator on 127.0.0.1:${PORT} (community: any)`);
