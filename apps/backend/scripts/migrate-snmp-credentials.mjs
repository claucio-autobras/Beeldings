// One-off: migra credenciais SNMP legadas embutidas em Device.config
// (snmpVersion/community) para a tabela snmp_credential (fase 2 da descoberta).
// Idempotente: devices que já têm registro em snmp_credential são pulados —
// a tabela é a fonte da verdade e nunca é sobrescrita por config legado.
// Retrocompat: o Device.config NÃO é alterado — as duas fontes coexistem
// enquanto houver código lendo do config (resolveSnmpRuntimeCredentials dá
// precedência à tabela).
// Rodar com: node scripts/migrate-snmp-credentials.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Todos os devices SNMP (câmeras CFTV, controladoras SCA, switches, NVRs…).
const devices = await prisma.device.findMany({
  where: { protocol: 'snmp' },
  select: { id: true, tenantId: true, name: true, config: true },
});

const existing = await prisma.snmpCredential.findMany({ select: { deviceId: true } });
const done = new Set(existing.map((c) => c.deviceId));

let migrated = 0;
let skipped = 0;
let failures = 0;

for (const device of devices) {
  if (done.has(device.id)) {
    skipped += 1;
    continue;
  }
  const cfg = device.config ?? {};
  const version = cfg.snmpVersion === '1' ? '1' : '2c'; // legado nunca tem v3
  const community =
    typeof cfg.community === 'string' && cfg.community.trim()
      ? cfg.community.trim()
      : 'public';
  try {
    await prisma.snmpCredential.create({
      data: {
        tenantId: device.tenantId,
        deviceId: device.id,
        version,
        community,
      },
    });
    migrated += 1;
  } catch (err) {
    failures += 1;
    console.error(
      `Falha ao migrar credencial do device "${device.name}" (${device.id}):`,
      err?.message ?? err,
    );
  }
}

console.log(
  `snmp_credential: ${migrated} migrada(s), ${skipped} já existente(s), ${failures} falha(s) de ${devices.length} device(s) SNMP.`,
);
await prisma.$disconnect();
if (failures > 0) process.exitCode = 1;
