// Simulador de controladora de acesso Control iD (SCA) para testar sem
// hardware: rode `node scripts/dev-controlid-snmp-sim.cjs` (porta 1161),
// aponte a controladora para 127.0.0.1:1161 e rode o gateway local
// (apps/gateway) com as credenciais MQTT do gateway de teste.
//
// Reproduz a árvore real da Control iD (enterprise 49617): CPU como OCTET
// STRING "23.436" (%) e temperatura como Gauge32 em mili-°C — os OIDs
// proprietários que o perfil `control-id` do gateway resolve quando o binding
// do ponto NÃO tem OID fixo. Memória fica no fallback UCD e packet_loss no
// IF-MIB (base do perfil genérico). NÃO expõe HOST-RESOURCES hrProcessorLoad:
// é exatamente o cenário do bug original (OID genérico engessado nunca lê).
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

// MIB-II system — sysDescr/sysObjectID identificam o perfil control-id.
scalar('sysDescr', '1.3.6.1.2.1.1.1', snmp.ObjectType.OctetString,
  'Control iD iDFlex V2 fw 5.13.9');
scalar('sysObjectID', '1.3.6.1.2.1.1.2', snmp.ObjectType.OID, '1.3.6.1.4.1.49617.1.1');
scalar('sysUpTime', '1.3.6.1.2.1.1.3', snmp.ObjectType.TimeTicks, 8640000); // 24h em centésimos
scalar('sysName', '1.3.6.1.2.1.1.5', snmp.ObjectType.OctetString, 'CTRL-PORTARIA-01');

// Enterprise Control iD (1.3.6.1.4.1.49617.1.1.*)
scalar('cidCpu', '1.3.6.1.4.1.49617.1.1.4', snmp.ObjectType.OctetString, '23.436'); // % como string
scalar('cidTemp', '1.3.6.1.4.1.49617.1.1.5', snmp.ObjectType.Gauge, 91991);          // mili-°C

// UCD memAvailReal (fallback universal de memória)
scalar('memAvailReal', '1.3.6.1.4.1.2021.4.6', snmp.ObjectType.Integer, 45000); // kB

// MIB-II interfaces (packet_loss = ifInDiscards.1 do perfil base)
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
    { number: 14, name: 'ifInErrors', type: snmp.ObjectType.Counter, maxAccess: snmp.MaxAccess['read-only'] },
  ],
  tableIndex: [{ columnName: 'ifIndex' }],
});
mib.addTableRow('ifEntry', [1, 'eth0', 2, 1]);

console.log(`Control iD SNMP simulator on 127.0.0.1:${PORT} (community: any)`);
