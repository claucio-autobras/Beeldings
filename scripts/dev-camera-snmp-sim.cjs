// Simulador de câmera SNMP (estilo Hikvision) para testar o CFTV sem hardware:
// rode `node scripts/dev-camera-snmp-sim.cjs` (porta 1161), aponte a câmera
// para 127.0.0.1:1161 e rode o gateway local (apps/gateway) com as credenciais
// MQTT do gateway. Expõe MIB-II system/interfaces, memória Hikvision,
// hrProcessorLoad (gera "Sugestão disponível" p/ CPU) e nenhum OID de
// temperatura ("não suportada").
const snmp = require('net-snmp');

const PORT = Number(process.env.SIM_PORT || 1161);

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

// MIB-II system
scalar('sysDescr', '1.3.6.1.2.1.1.1', snmp.ObjectType.OctetString,
  'HIKVISION DS-2CD2143G2-I V5.7.3 build 220916');
scalar('sysObjectID', '1.3.6.1.2.1.1.2', snmp.ObjectType.OID, '1.3.6.1.4.1.39165.1.1');
scalar('sysUpTime', '1.3.6.1.2.1.1.3', snmp.ObjectType.TimeTicks, 27374200); // ~3d 4h em centésimos
scalar('sysContact', '1.3.6.1.2.1.1.4', snmp.ObjectType.OctetString, 'cftv@bluebee');
scalar('sysName', '1.3.6.1.2.1.1.5', snmp.ObjectType.OctetString, 'CAM-PORTARIA-01');
scalar('sysLocation', '1.3.6.1.2.1.1.6', snmp.ObjectType.OctetString, 'Portaria');

// Enterprise Hikvision (1.3.6.1.4.1.39165.1.*) — reproduz o walk real da
// câmera: valores como OCTET STRING com sufixo de unidade ("45 PERCENT",
// "256 MB"), que o gateway deve normalizar para número.
scalar('hikCpu', '1.3.6.1.4.1.39165.1.7', snmp.ObjectType.OctetString, '45 PERCENT');
scalar('hikDiskSize', '1.3.6.1.4.1.39165.1.8', snmp.ObjectType.OctetString, '0.0 GB');
scalar('hikDiskUsage', '1.3.6.1.4.1.39165.1.9', snmp.ObjectType.OctetString, '0 PERCENT');
scalar('hikMemTotal', '1.3.6.1.4.1.39165.1.10', snmp.ObjectType.OctetString, '256 MB');
scalar('hikMemUsage', '1.3.6.1.4.1.39165.1.11', snmp.ObjectType.OctetString, '87 PERCENT');
// hrProcessorLoad.1 também disponível (HOST-RESOURCES-MIB, tabela índice 1):
mib.registerProvider({
  name: 'hrProcessorEntry',
  type: snmp.MibProviderType.Table,
  oid: '1.3.6.1.2.1.25.3.3.1',
  maxAccess: snmp.MaxAccess['not-accessible'],
  tableColumns: [
    { number: 1, name: 'hrProcessorFrwID', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
    { number: 2, name: 'hrProcessorLoad', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
  ],
  tableIndex: [{ columnName: 'hrProcessorFrwID' }],
});
mib.addTableRow('hrProcessorEntry', [1, 44]);

// MIB-II interfaces (ifNumber + ifTable com if1) → packet_loss "Funcionando"
scalar('ifNumber', '1.3.6.1.2.1.2.1', snmp.ObjectType.Integer, 1);
mib.registerProvider({
  name: 'ifEntry',
  type: snmp.MibProviderType.Table,
  oid: '1.3.6.1.2.1.2.2.1',
  maxAccess: snmp.MaxAccess['not-accessible'],
  tableColumns: [
    { number: 1, name: 'ifIndex', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
    { number: 2, name: 'ifDescr', type: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-only'] },
    { number: 13, name: 'ifInDiscards', type: snmp.ObjectType.Counter, maxAccess: snmp.MaxAccess['read-only'] },
  ],
  tableIndex: [{ columnName: 'ifIndex' }],
});
mib.addTableRow('ifEntry', [1, 'eth0', 3]);

console.log(`Camera SNMP simulator on 127.0.0.1:${PORT} (community: any)`);
