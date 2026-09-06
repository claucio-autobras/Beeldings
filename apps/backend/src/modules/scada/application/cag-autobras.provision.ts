import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

export const CAG_SCREEN_NAME = 'CAG — Água Gelada';
export const CAG_PROVISIONER = 'cag-autobras-dev';
export const CAG_CANVAS = { width: 1920, height: 1080 } as const;

const TENANT_SLUG = 'autobras';
const TENANT_NAME = 'Autobras DEV';
const SITE_NAME = 'NIS';
const PROJECT_NAME = 'NIS Beeldings';

export interface CagProvisionTarget {
  tenant: { id: string; name: string; slug: string };
  site: { id: string; name: string; tenantId: string };
  project: {
    id: string;
    name: string;
    tenantId: string;
    siteId: string;
    gatewayId: string | null;
    scadaEnabled: boolean;
  };
}

type WidgetBase = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  zIndex: number;
};

function base(id: string, type: string, x: number, y: number, width: number, height: number, zIndex = 2): WidgetBase {
  return { id, type, x, y, width, height, opacity: 1, visible: true, zIndex };
}

function label(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  options: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...base(id, 'label-static', x, y, width, height, 3),
    text,
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#CBD5E1',
    align: 'left',
    backgroundColor: 'transparent',
    borderRadius: 0,
    ...options,
  };
}

function titledArea(id: string, x: number, y: number, width: number, height: number, title: string): Record<string, unknown> {
  return {
    ...base(id, 'titled-area', x, y, width, height, 0),
    title,
    fillColor: 'rgba(15, 23, 42, 0.28)',
    borderColor: 'rgba(56, 189, 248, 0.18)',
    titleColor: '#38BDF8',
    borderRadius: 12,
    titleFontSize: 12,
    titleFontWeight: 'semibold',
    titlePosition: 'border',
    titleAlign: 'left',
  };
}

function separator(id: string, x: number, y: number, width: number, height: number): Record<string, unknown> {
  return {
    ...base(id, 'separator', x, y, width, height, 1),
    orientation: width >= height ? 'horizontal' : 'vertical',
    color: 'rgba(148, 163, 184, 0.2)',
    thickness: 1,
    lineStyle: 'solid',
  };
}

/** Equipamento puramente visual: sem ponto de status e sem estado derivado. */
function equipment(
  id: string,
  type: 'chiller' | 'pump',
  x: number,
  y: number,
  labelText: string,
): Record<string, unknown> {
  return {
    ...base(id, type, x, y, type === 'chiller' ? 250 : 190, type === 'chiller' ? 190 : 150),
    showLabel: true,
    labelText,
    labelFontSize: type === 'chiller' ? 14 : 12,
    showStatusLed: true,
    baseColor: type === 'chiller' ? '#38BDF8' : '#F59E0B',
  };
}

/** Tubulação decorativa: o fluxo é apenas uma convenção visual do diagrama. */
function pipe(id: string, x: number, y: number, width: number, reverse = false): Record<string, unknown> {
  return {
    ...base(id, 'pipe', x, y, width, 42, 1),
    points: [{ x: 0, y: 21 }, { x: width, y: 21 }],
    pipeColor: '#1E3A5F',
    flowColor: reverse ? '#F59E0B' : '#38BDF8',
    stoppedColor: '#64748B',
    thickness: 12,
    cornerRadius: 8,
    pipeStyle: 'water',
    speed: 1,
    reverse,
    animateFlow: false,
  };
}

function kpi(id: string, x: number, title: string, subtext: string): Record<string, unknown> {
  return {
    ...base(id, 'kpi-card', x, 105, 300, 112, 3),
    backgroundColor: '#0B1220',
    textColor: '#E2E8F0',
    mutedColor: '#94A3B8',
    borderColor: '#1E3A5F',
    borderRadius: 10,
    title,
    unit: '',
    decimals: 0,
    subtext,
    valueFontSize: 28,
    showBadge: false,
    badgeRules: [],
  };
}

function equipmentCard(): Record<string, unknown> {
  const rows = [
    ['row-chiller-1', 'Chiller CH-01', 'Circuito primário'],
    ['row-chiller-2', 'Chiller CH-02', 'Circuito secundário'],
    ['row-pump-1', 'Bomba P-01', 'Circulação de ida'],
    ['row-pump-2', 'Bomba P-02', 'Circulação de retorno'],
  ].map(([id, rowLabel, subtitle]) => ({
    id,
    iconName: 'activity',
    label: rowLabel,
    subtitle,
    display: 'value',
    unit: '',
    decimals: 0,
    valueColor: '#38BDF8',
    minValue: 0,
    maxValue: 100,
    step: 1,
  }));

  return {
    ...base('cag-equipment-card', 'equipment-card', 1455, 320, 410, 330, 3),
    backgroundColor: '#0B1220',
    textColor: '#E2E8F0',
    mutedColor: '#94A3B8',
    borderColor: '#1E3A5F',
    borderRadius: 10,
    title: 'Equipamentos CAG',
    subtitle: 'Composição demonstrativa',
    accentColor: '#38BDF8',
    priority: 8,
    rows,
  };
}

/**
 * Resolve apenas a hierarquia estável de destino. Equipamentos, pontos e
 * gateways não fazem parte do contrato do provisionador desta tela.
 */
export async function resolveCagAutobrasTarget(prisma: PrismaClient): Promise<CagProvisionTarget> {
  const tenant = await prisma.tenant.findFirst({
    where: { OR: [{ slug: TENANT_SLUG }, { name: { equals: TENANT_NAME, mode: 'insensitive' } }] },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) throw new NotFoundException(`Tenant ${TENANT_NAME} não encontrado`);
  if (tenant.name.trim().toLocaleLowerCase() !== TENANT_NAME.toLocaleLowerCase()) {
    throw new BadRequestException(`Slug ${TENANT_SLUG} não pertence ao tenant ${TENANT_NAME}`);
  }

  const site = await prisma.site.findFirst({
    where: { tenantId: tenant.id, name: { equals: SITE_NAME, mode: 'insensitive' } },
    select: { id: true, name: true, tenantId: true },
  });
  if (!site || site.tenantId !== tenant.id) {
    throw new NotFoundException(`Site ${SITE_NAME} não encontrado no tenant correto`);
  }

  const project = await prisma.project.findFirst({
    where: { tenantId: tenant.id, siteId: site.id, name: { equals: PROJECT_NAME, mode: 'insensitive' } },
    select: { id: true, name: true, tenantId: true, siteId: true, gatewayId: true, scadaEnabled: true },
  });
  if (!project || project.tenantId !== tenant.id || project.siteId !== site.id) {
    throw new NotFoundException(`Projeto ${PROJECT_NAME} não encontrado no site correto`);
  }

  return { tenant, site, project };
}

/**
 * Layout demonstrativo completo. Todos os equipamentos, tubulações e cartões
 * são visuais: valores operacionais ficam como "sem dados" e não há vínculo
 * com dispositivo, ponto, gateway ou controladora.
 */
export function buildCagWidgets(_target?: CagProvisionTarget): Record<string, unknown>[] {
  const widgets: Record<string, unknown>[] = [
    titledArea('cag-header-area', 24, 24, 1872, 170, 'CAG · Água Gelada'),
    label('cag-title', 58, 54, 700, 34, 'CAG — Água Gelada', {
      fontSize: 28,
      fontWeight: 'bold',
      color: '#F8FAFC',
    }),
    label('cag-subtitle', 60, 94, 760, 24, 'NIS Beeldings · NIS · Autobras DEV', {
      fontSize: 13,
      color: '#94A3B8',
    }),
    label('cag-data-note', 60, 124, 680, 20, 'COMPOSIÇÃO DEMONSTRATIVA · SEM TELEMETRIA VINCULADA', {
      fontSize: 11,
      fontWeight: 'semibold',
      color: '#F59E0B',
    }),
    kpi('cag-kpi-supply', 760, 'Temperatura de ida', 'Sem telemetria vinculada'),
    kpi('cag-kpi-return', 1082, 'Temperatura de retorno', 'Sem telemetria vinculada'),
    kpi('cag-kpi-flow', 1404, 'Vazão do circuito', 'Sem telemetria vinculada'),
    titledArea('cag-process-area', 24, 222, 1385, 834, 'Circuito operacional · CAG'),
    titledArea('cag-equipment-area', 1435, 222, 461, 834, 'Pontos e disponibilidade'),
    label('cag-process-eyebrow', 64, 270, 560, 22, 'CIRCUITO VISUAL · IDA E RETORNO DE ÁGUA GELADA', {
      fontSize: 11,
      fontWeight: 'semibold',
      color: '#38BDF8',
    }),
    label('cag-process-note', 64, 296, 700, 22, 'Estados e leituras reais não estão vinculados nesta tela.', {
      fontSize: 12,
      color: '#94A3B8',
    }),
    equipment('cag-chiller-1', 'chiller', 105, 405, 'Chiller CH-01'),
    equipment('cag-chiller-2', 'chiller', 105, 730, 'Chiller CH-02'),
    equipment('cag-pump-1', 'pump', 1115, 365, 'Bomba P-01'),
    equipment('cag-pump-2', 'pump', 1115, 505, 'Bomba P-02'),
    equipment('cag-pump-3', 'pump', 1115, 690, 'Bomba P-03'),
    equipment('cag-pump-4', 'pump', 1115, 830, 'Bomba P-04'),
    pipe('cag-pipe-supply-1', 390, 465, 660),
    pipe('cag-pipe-supply-2', 390, 790, 660),
    pipe('cag-pipe-return-1', 390, 545, 660, true),
    pipe('cag-pipe-return-2', 390, 870, 660, true),
    label('cag-supply-label-1', 525, 430, 360, 22, 'IDA · fluxo representado', {
      fontSize: 11,
      fontWeight: 'semibold',
      color: '#38BDF8',
      align: 'center',
    }),
    label('cag-return-label-1', 525, 575, 360, 22, 'RETORNO · fluxo representado', {
      fontSize: 11,
      fontWeight: 'semibold',
      color: '#F59E0B',
      align: 'center',
    }),
    label('cag-supply-label-2', 525, 755, 360, 22, 'IDA · circuito secundário', {
      fontSize: 11,
      fontWeight: 'semibold',
      color: '#38BDF8',
      align: 'center',
    }),
    label('cag-return-label-2', 525, 900, 360, 22, 'RETORNO · circuito secundário', {
      fontSize: 11,
      fontWeight: 'semibold',
      color: '#F59E0B',
      align: 'center',
    }),
    separator('cag-process-divider', 64, 950, 1290, 1),
    label('cag-state-legend', 64, 970, 1290, 24, 'Legenda visual   ● operação   ● supervisão   ● atenção   ·   Sem dados reais nesta composição', {
      fontSize: 11,
      color: '#64748B',
    }),
    label('cag-process-footer', 64, 1004, 1290, 24, 'A tela está pronta para receber vínculos no futuro, sem alterar o cadastro de ativos.', {
      fontSize: 11,
      color: '#94A3B8',
    }),
    equipmentCard(),
    titledArea('cag-sidebar-summary', 1455, 680, 410, 155, 'Áreas de processo'),
    label('cag-sidebar-summary-text', 1480, 725, 360, 78, 'Chillers\\nBombas de circulação\\nTubulações de ida e retorno', {
      fontSize: 13,
      color: '#CBD5E1',
    }),
    titledArea('cag-sidebar-status', 1455, 860, 410, 155, 'Status da tela'),
    label('cag-sidebar-status-text', 1480, 905, 360, 74, 'Modo demonstrativo\\nSem equipamentos vinculados\\nSem telemetria ao vivo', {
      fontSize: 13,
      color: '#F59E0B',
    }),
  ];

  return widgets;
}

const BINDING_KEYS = new Set([
  'deviceId',
  'deviceIds',
  'tag',
  'tagStatus',
  'bindingDeviceId',
  'bindingTag',
  'flowDeviceId',
  'flowTag',
  'statusDeviceId',
  'statusTag',
]);

/** Garante que o JSON demonstrativo não adquira bindings por acidente. */
export function validateCagBindings(widgets: Record<string, unknown>[], _target?: CagProvisionTarget): void {
  function visit(value: unknown, path: string): void {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (BINDING_KEYS.has(key)) {
        throw new BadRequestException(`Tela CAG não pode conter vínculo em ${path}.${key}`);
      }
      visit(child, `${path}.${key}`);
    }
  }

  visit(widgets, 'widgets');
}

export async function provisionCagAutobras(
  prisma: PrismaClient,
): Promise<{ id: string; created: boolean; widgetCount: number }> {
  const target = await resolveCagAutobrasTarget(prisma);
  const widgets = buildCagWidgets(target);
  validateCagBindings(widgets, target);
  const settings = {
    backgroundColor: '#07111F',
    gridOpacity: 0.15,
    provisioner: CAG_PROVISIONER,
    telemetry: 'none',
    presentation: 'demonstration',
  } satisfies Prisma.InputJsonObject;

  const existing = await prisma.scadaScreen.findMany({
    where: {
      tenantId: target.tenant.id,
      siteId: target.site.id,
      projectId: target.project.id,
      name: { equals: CAG_SCREEN_NAME, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const canonical = existing[0];
  if (canonical) {
    await prisma.scadaScreen.update({
      where: { id: canonical.id },
      data: {
        description: 'Composição visual demonstrativa da central de água gelada, sem telemetria vinculada.',
        width: CAG_CANVAS.width,
        height: CAG_CANVAS.height,
        widgets: widgets as Prisma.InputJsonValue,
        settings: settings as Prisma.InputJsonValue,
      },
    });
    const duplicateIds = existing.slice(1).map((screen) => screen.id);
    if (duplicateIds.length > 0) {
      await prisma.scadaScreen.deleteMany({ where: { id: { in: duplicateIds } } });
    }
    return { id: canonical.id, created: false, widgetCount: widgets.length };
  }

  const created = await prisma.scadaScreen.create({
    data: {
      name: CAG_SCREEN_NAME,
      description: 'Composição visual demonstrativa da central de água gelada, sem telemetria vinculada.',
      tenantId: target.tenant.id,
      siteId: target.site.id,
      projectId: target.project.id,
      width: CAG_CANVAS.width,
      height: CAG_CANVAS.height,
      widgets: widgets as Prisma.InputJsonValue,
      settings: settings as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return { id: created.id, created: true, widgetCount: widgets.length };
}