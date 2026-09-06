/**
 * Teste E2E da nova hierarquia: Cliente -> Site -> Projeto -> Gateway -> Device -> Ponto
 *
 * Reproduz fielmente as operações dos services (SitesService / ProjectsService /
 * DevicesController) contra o banco real, validando:
 *  - criação de site direto no tenant
 *  - criação de projeto com gateway provisionado automaticamente (um por projeto)
 *  - cadastro de controladora vinculada ao gateway do projeto + pontos
 *  - geração do gateway-config.env
 *  - isolamento multi-tenant nas listagens
 *  - exclusão em cascata (projeto -> gateway/devices/points; site -> projetos...)
 *
 * Uso: npx ts-node scripts/e2e-hierarchy-test.ts
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function createSite(name: string, tenantId: string) {
  return prisma.site.create({ data: { name: name.trim(), tenantId } });
}

async function createProjectWithGateway(name: string, siteId: string, tenantId: string) {
  const site = await prisma.site.findFirstOrThrow({ where: { id: siteId, tenantId } });
  const suffix = randomBytes(4).toString('hex');
  const gatewayId = `gw-${slugify(site.name)}-${slugify(name)}-${suffix}`;
  const mqttPass = randomBytes(16).toString('hex');
  const gateway = await prisma.gateway.create({
    data: { id: gatewayId, mqttUser: gatewayId, mqttPass, status: 'offline', tenantId },
  });
  const project = await prisma.project.create({
    data: { name: name.trim(), siteId, tenantId, gatewayId: gateway.id },
  });
  return { ...project, gateway };
}

async function deleteProjectCascade(id: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id } });
  const gatewayId = project.gatewayId!;
  await prisma.$transaction([
    prisma.devicePoint.deleteMany({ where: { device: { gatewayId } } }),
    prisma.device.deleteMany({ where: { gatewayId } }),
    prisma.project.delete({ where: { id } }),
    prisma.gateway.delete({ where: { id: gatewayId } }),
  ]);
}

async function deleteSiteCascade(id: string) {
  const gateways = await prisma.gateway.findMany({
    where: { projects: { some: { siteId: id } } },
    select: { id: true },
  });
  const gatewayIds = gateways.map((g) => g.id);
  await prisma.$transaction([
    prisma.devicePoint.deleteMany({ where: { device: { siteId: id } } }),
    prisma.device.deleteMany({ where: { siteId: id } }),
    prisma.project.deleteMany({ where: { siteId: id } }),
    prisma.gateway.deleteMany({ where: { id: { in: gatewayIds } } }),
    prisma.site.delete({ where: { id } }),
  ]);
}

async function main() {
  console.log('\n=== E2E Hierarquia BlueBee — Cliente > Site > Projeto > Gateway > Ponto ===\n');

  // ── Setup: dois tenants de teste (isolamento) ──
  const slugA = `e2e-a-${randomBytes(3).toString('hex')}`;
  const slugB = `e2e-b-${randomBytes(3).toString('hex')}`;
  const tenantA = await prisma.tenant.create({ data: { name: 'E2E Hospital A', slug: slugA } });
  const tenantB = await prisma.tenant.create({ data: { name: 'E2E Banco B', slug: slugB } });
  console.log(`Tenants de teste: A=${tenantA.id}  B=${tenantB.id}\n`);

  console.log('1) Criar Site no cliente A');
  const siteA = await createSite('Unidade Morumbi', tenantA.id);
  check('Site criado com tenantId direto (sem projectId)', siteA.tenantId === tenantA.id && !('projectId' in siteA));

  console.log('2) Criar Projeto dentro do Site (gateway automático)');
  const projBMS = await createProjectWithGateway('BMS Principal', siteA.id, tenantA.id);
  check('Projeto vinculado ao site', projBMS.siteId === siteA.id);
  check('Gateway criado automaticamente (1 por projeto)', !!projBMS.gateway);
  check('Projeto aponta para o gateway', projBMS.gatewayId === projBMS.gateway?.id);
  check('Gateway nomeado gw-<site>-<projeto>', projBMS.gateway?.id.startsWith('gw-unidade-morumbi-bms-principal-') === true);
  check('Gateway tem credenciais MQTT', !!projBMS.gateway?.mqttUser && !!projBMS.gateway?.mqttPass);

  console.log('3) Segundo projeto no mesmo site (CFTV)');
  const projCFTV = await createProjectWithGateway('CFTV', siteA.id, tenantA.id);
  check('Site agora tem 2 projetos', (await prisma.project.count({ where: { siteId: siteA.id } })) === 2);
  check('Cada projeto tem seu próprio gateway', projCFTV.gateway?.id !== projBMS.gateway?.id);

  console.log('4) Cadastrar controladora (device) no gateway do projeto BMS');
  const device = await prisma.device.create({
    data: {
      name: 'MPC-46D Bloco A', protocol: 'bacnet', ip: '192.168.0.50', port: 47808,
      status: 'offline', tenantId: tenantA.id, siteId: siteA.id, gatewayId: projBMS.gateway!.id,
      points: { create: [
        { tag: 'TEMP_SALA01', objectName: 'Temp Sala 01', objectType: '0', instance: 1, unit: '°C' },
        { tag: 'VALVULA_02', objectName: 'Valvula 02', objectType: '4', instance: 2, unit: '' },
      ] },
    },
    include: { points: true },
  });
  check('Device vinculado ao gateway do projeto', device.gatewayId === projBMS.gateway!.id);
  check('Device vinculado ao site', device.siteId === siteA.id);
  check('Device com 2 pontos', device.points.length === 2);

  console.log('5) Gerar gateway-config.env do projeto');
  const gw = await prisma.gateway.findFirstOrThrow({ where: { id: projBMS.gatewayId!, tenantId: tenantA.id } });
  const envContent = [
    `GATEWAY_ID=${gw.id}`, `TENANT_ID=${gw.tenantId}`,
    `MQTT_USERNAME=${gw.mqttUser}`, `MQTT_PASSWORD=${gw.mqttPass}`,
  ].join('\n');
  check('.env contém GATEWAY_ID', envContent.includes(`GATEWAY_ID=${gw.id}`));
  check('.env contém credenciais MQTT', envContent.includes('MQTT_PASSWORD='));

  console.log('6) Isolamento multi-tenant');
  const siteB = await createSite('Agência Paulista', tenantB.id);
  await createProjectWithGateway('Energia', siteB.id, tenantB.id);
  const sitesA = await prisma.site.findMany({ where: { tenantId: tenantA.id }, include: { _count: { select: { projects: true } } } });
  const projectsA = await prisma.project.findMany({ where: { siteId: siteA.id, tenantId: tenantA.id } });
  check('Listagem de sites do A não vaza B', sitesA.every((s) => s.tenantId === tenantA.id) && sitesA.length === 1);
  check('_count.projects do site A = 2', sitesA[0]?._count.projects === 2);
  check('Projetos do site A só do tenant A', projectsA.every((p) => p.tenantId === tenantA.id) && projectsA.length === 2);
  check('Tenant B isolado (1 site, 1 projeto)',
    (await prisma.site.count({ where: { tenantId: tenantB.id } })) === 1 &&
    (await prisma.project.count({ where: { tenantId: tenantB.id } })) === 1);

  console.log('7) Exclusão em cascata do projeto BMS');
  await deleteProjectCascade(projBMS.id);
  check('Projeto removido', (await prisma.project.count({ where: { id: projBMS.id } })) === 0);
  check('Gateway do projeto removido', (await prisma.gateway.count({ where: { id: projBMS.gateway!.id } })) === 0);
  check('Devices do gateway removidos', (await prisma.device.count({ where: { id: device.id } })) === 0);
  check('Pontos do device removidos', (await prisma.devicePoint.count({ where: { deviceId: device.id } })) === 0);
  check('Site preservado e outro projeto (CFTV) intacto',
    (await prisma.site.count({ where: { id: siteA.id } })) === 1 &&
    (await prisma.project.count({ where: { id: projCFTV.id } })) === 1);

  console.log('8) Exclusão em cascata do site');
  await deleteSiteCascade(siteA.id);
  check('Site removido', (await prisma.site.count({ where: { id: siteA.id } })) === 0);
  check('Projetos do site removidos', (await prisma.project.count({ where: { siteId: siteA.id } })) === 0);
  check('Gateways do site removidos', (await prisma.gateway.count({ where: { id: projCFTV.gateway!.id } })) === 0);

  // ── Cleanup ──
  console.log('\n9) Limpeza dos dados de teste');
  await deleteSiteCascade(siteB.id);
  await prisma.tenant.delete({ where: { id: tenantA.id } });
  await prisma.tenant.delete({ where: { id: tenantB.id } });
  check('Tenants de teste removidos',
    (await prisma.tenant.count({ where: { id: { in: [tenantA.id, tenantB.id] } } })) === 0);

  console.log(`\n=== Resultado: ${passed} passou(aram), ${failed} falhou(aram) ===\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => { console.error('Erro no teste E2E:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
