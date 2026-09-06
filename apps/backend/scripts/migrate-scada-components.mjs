// One-off: migra componentes legados embutidos em scada_screens.settings.components
// para a biblioteca global por tenant (scada_components). Idempotente e SEM PERDA:
// só considera duplicata um id já migrado no mesmo tenant ou conteúdo idêntico
// (nome + dimensões + widgets em JSON canônico). O campo legado só é removido da
// tela quando todos os componentes dela foram migrados ou são duplicatas provadas.
// Rodar com: node scripts/migrate-scada-components.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const screens = await prisma.scadaScreen.findMany({ select: { id: true, tenantId: true, settings: true } });
const existing = await prisma.scadaComponent.findMany({
  select: { id: true, tenantId: true, name: true, width: true, height: true, widgets: true },
});
const tenantById = new Map(existing.map((c) => [c.id, c.tenantId]));
const contentKey = (tenantId, name, width, height, widgets) =>
  `${tenantId}|${name}|${width}x${height}|${JSON.stringify(widgets)}`;
const byContent = new Set(
  existing.map((c) => contentKey(c.tenantId, c.name, c.width, c.height, Array.isArray(c.widgets) ? c.widgets : [])),
);

let migrated = 0, skipped = 0, touched = 0, failures = 0;
for (const screen of screens) {
  const settings = screen.settings ?? {};
  const comps = Array.isArray(settings.components) ? settings.components : [];
  if (comps.length === 0) continue;
  touched += 1;
  let allHandled = true;
  for (const comp of comps) {
    const id = typeof comp.id === 'string' ? comp.id : undefined;
    const name = typeof comp.name === 'string' ? comp.name : 'Componente';
    const widgets = Array.isArray(comp.widgets) ? comp.widgets : [];
    const width = Math.max(1, Math.round(Number(comp.width) || 1));
    const height = Math.max(1, Math.round(Number(comp.height) || 1));
    if (widgets.length === 0) { skipped += 1; continue; }
    const key = contentKey(screen.tenantId, name, width, height, widgets);
    const idTaken = id ? tenantById.get(id) : undefined;
    if ((id && idTaken === screen.tenantId) || byContent.has(key)) { skipped += 1; continue; }
    try {
      const created = await prisma.scadaComponent.create({
        data: {
          // Preserva o id legado, exceto se colidir com id de OUTRO tenant.
          ...(id && !idTaken ? { id } : {}),
          name,
          tenantId: screen.tenantId,
          width,
          height,
          widgets,
        },
      });
      tenantById.set(created.id, screen.tenantId);
      byContent.add(key);
      migrated += 1;
    } catch (err) {
      failures += 1;
      allHandled = false; // mantém o legado na tela para nova tentativa
      console.error(`Falha ao migrar componente "${name}" da tela ${screen.id}:`, err?.message ?? err);
    }
  }
  if (allHandled) {
    const { components: _legacy, ...rest } = settings;
    await prisma.scadaScreen.update({ where: { id: screen.id }, data: { settings: rest } });
  }
}
console.log(JSON.stringify({ migrated, skipped, failures, screensTouched: touched }));
await prisma.$disconnect();
