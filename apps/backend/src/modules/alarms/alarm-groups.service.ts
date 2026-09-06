import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { AlarmEventState, AlarmSeverity, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AlarmGroupFilters {
  tenantId?: string;
  siteId?: string;
  projectId?: string;
}

export interface CreateAlarmGroupInput {
  siteId: string;
  name: string;
  memberRuleIds?: string[];
  enabled?: boolean;
}

export interface UpdateAlarmGroupInput {
  name?: string;
  enabled?: boolean;
  memberRuleIds?: string[];
}

// Uma regra está "ativa" quando tem uma ocorrência aberta (ACTIVE/ACTIVE_ACK).
const ACTIVE_STATES: AlarmEventState[] = ['ACTIVE', 'ACTIVE_ACK'];

// Ordenação de severidade p/ derivar a "maior severidade ativa".
const SEVERITY_RANK: Record<AlarmSeverity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

const GROUP_INCLUDE = {
  site: { select: { name: true } },
  members: {
    orderBy: { createdAt: 'asc' },
    include: {
      alarmRule: {
        select: {
          id: true,
          name: true,
          severity: true,
          enabled: true,
          tenantId: true,
          point: {
            select: {
              id: true,
              tag: true,
              deviceId: true,
              device: { select: { id: true, name: true, siteId: true } },
            },
          },
        },
      },
    },
  },
} as const;

type GroupWithMembers = Prisma.AlarmGroupGetPayload<{ include: typeof GROUP_INCLUDE }>;

@Injectable()
export class AlarmGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters: AlarmGroupFilters) {
    // Filtro por projeto: um projeto pertence a um site; resolvemos o site do
    // projeto e escopamos os grupos por ele (grupos são por-site, não por-projeto).
    let siteId = filters.siteId;
    if (filters.projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: filters.projectId },
        select: { siteId: true },
      });
      // Projeto inexistente → nenhum grupo. Se filterou por site também, mantém consistência.
      if (!project) return [];
      if (siteId && siteId !== project.siteId) return [];
      siteId = project.siteId;
    }

    const groups = await this.prisma.alarmGroup.findMany({
      where: {
        ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
        ...(siteId ? { siteId } : {}),
      },
      include: GROUP_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    const activeRuleIds = await this.activeRuleIds(groups.flatMap((g) => g.members.map((m) => m.alarmRuleId)));
    return groups.map((g) => this.toDto(g, activeRuleIds));
  }

  async findOne(id: string, tenantId: string | undefined) {
    const group = await this.prisma.alarmGroup.findFirst({
      where: tenantId ? { id, tenantId } : { id },
      include: GROUP_INCLUDE,
    });
    if (!group) throw new NotFoundException(`Soma de alarmes ${id} não encontrada`);
    const activeRuleIds = await this.activeRuleIds(group.members.map((m) => m.alarmRuleId));
    return this.toDto(group, activeRuleIds);
  }

  async create(input: CreateAlarmGroupInput, tenantId: string | undefined) {
    if (!input.name?.trim()) throw new BadRequestException('name é obrigatório');
    if (!input.siteId) throw new BadRequestException('siteId é obrigatório');

    const site = await this.prisma.site.findUnique({
      where: { id: input.siteId },
      select: { id: true, tenantId: true },
    });
    if (!site) throw new NotFoundException(`Site ${input.siteId} não encontrado`);
    // Escopo de tenant: não-globais só criam no próprio tenant.
    if (tenantId && site.tenantId !== tenantId) {
      throw new BadRequestException('Site não pertence ao seu tenant');
    }

    const ruleIds = dedupe(input.memberRuleIds ?? []);
    await this.assertRulesInSite(ruleIds, site.id, site.tenantId);

    const group = await this.prisma.alarmGroup.create({
      data: {
        tenantId: site.tenantId,
        siteId: site.id,
        name: input.name.trim(),
        enabled: input.enabled ?? true,
        members: { create: ruleIds.map((alarmRuleId) => ({ alarmRuleId })) },
      },
      include: GROUP_INCLUDE,
    });
    const activeRuleIds = await this.activeRuleIds(group.members.map((m) => m.alarmRuleId));
    return this.toDto(group, activeRuleIds);
  }

  async update(id: string, tenantId: string | undefined, input: UpdateAlarmGroupInput) {
    const existing = await this.prisma.alarmGroup.findFirst({
      where: tenantId ? { id, tenantId } : { id },
      select: { id: true, siteId: true, tenantId: true },
    });
    if (!existing) throw new NotFoundException(`Soma de alarmes ${id} não encontrada`);

    const data: Prisma.AlarmGroupUpdateInput = {};
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new BadRequestException('name não pode ser vazio');
      data.name = input.name.trim();
    }
    if (input.enabled !== undefined) data.enabled = input.enabled;

    // Substitui o conjunto de membros quando informado (delete-all + recria).
    if (input.memberRuleIds !== undefined) {
      const ruleIds = dedupe(input.memberRuleIds);
      await this.assertRulesInSite(ruleIds, existing.siteId, existing.tenantId);
      data.members = {
        deleteMany: {},
        create: ruleIds.map((alarmRuleId) => ({ alarmRuleId })),
      };
    }

    const group = await this.prisma.alarmGroup.update({
      where: { id },
      data,
      include: GROUP_INCLUDE,
    });
    const activeRuleIds = await this.activeRuleIds(group.members.map((m) => m.alarmRuleId));
    return this.toDto(group, activeRuleIds);
  }

  async delete(id: string, tenantId: string | undefined): Promise<void> {
    const existing = await this.prisma.alarmGroup.findFirst({
      where: tenantId ? { id, tenantId } : { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(`Soma de alarmes ${id} não encontrada`);
    await this.prisma.alarmGroup.delete({ where: { id } });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Valida que cada regra existe e pertence ao site/tenant do grupo. */
  private async assertRulesInSite(ruleIds: string[], siteId: string, tenantId: string): Promise<void> {
    if (ruleIds.length === 0) return;
    const rules = await this.prisma.alarmRule.findMany({
      where: { id: { in: ruleIds } },
      select: { id: true, tenantId: true, point: { select: { device: { select: { siteId: true } } } } },
    });
    if (rules.length !== ruleIds.length) {
      throw new BadRequestException('Uma ou mais regras de alarme não foram encontradas');
    }
    for (const r of rules) {
      if (r.tenantId !== tenantId || r.point.device.siteId !== siteId) {
        throw new BadRequestException('Todas as regras devem pertencer ao mesmo site/tenant do grupo');
      }
    }
  }

  /** Conjunto de ruleIds com ocorrência aberta (kind='ALARM'). */
  private async activeRuleIds(ruleIds: string[]): Promise<Set<string>> {
    const ids = dedupe(ruleIds);
    if (ids.length === 0) return new Set();
    const open = await this.prisma.alarmEvent.findMany({
      where: { kind: 'ALARM', state: { in: ACTIVE_STATES }, alarmRuleId: { in: ids } },
      select: { alarmRuleId: true },
      distinct: ['alarmRuleId'],
    });
    return new Set(open.map((e) => e.alarmRuleId).filter((x): x is string => x !== null));
  }

  private toDto(g: GroupWithMembers, activeRuleIds: Set<string>) {
    const members = g.members.map((m) => {
      const rule = m.alarmRule;
      const point = rule.point;
      return {
        alarmRuleId: rule.id,
        name: rule.name,
        severity: rule.severity,
        enabled: rule.enabled,
        pointId: point.id,
        tag: point.tag,
        deviceId: point.device.id,
        deviceName: point.device.name,
        active: activeRuleIds.has(rule.id),
      };
    });

    let severity: AlarmSeverity | null = null;
    let active = 0;
    for (const m of members) {
      if (!m.active) continue;
      active += 1;
      if (!severity || SEVERITY_RANK[m.severity] > SEVERITY_RANK[severity]) severity = m.severity;
    }

    return {
      id: g.id,
      tenantId: g.tenantId,
      siteId: g.siteId,
      siteName: g.site.name,
      projectId: null as string | null,
      name: g.name,
      enabled: g.enabled,
      aggregate: { total: members.length, active, severity },
      members,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
    };
  }
}

function dedupe(ids: string[]): string[] {
  return Array.from(new Set(ids));
}
