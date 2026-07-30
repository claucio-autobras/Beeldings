import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { AlarmEventState, AlarmSeverity, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlarmEngineService } from './alarm-engine.service.js';
import { nextStateOnAck } from './alarm-evaluator.js';
import { alarmPeriodWhere, sortBySeverityThenActivity } from './alarm-activity.util.js';

const ACTIVE_STATES: AlarmEventState[] = ['ACTIVE', 'ACTIVE_ACK'];
// Aguardando ACK = apenas normalizados sem reconhecimento. Alarmes ainda ativos
// NÃO são reconhecíveis (só depois de normalizarem), logo não entram aqui.
const PENDING_ACK_STATES: AlarmEventState[] = ['NORMALIZED_UNACK'];
const ACK_STATES: AlarmEventState[] = ['ACTIVE_ACK', 'NORMALIZED_ACK'];

export interface AlarmEventFilters {
  tenantId?: string;
  siteId?: string;
  deviceId?: string;
  pointId?: string;
  severity?: AlarmSeverity;
  state?: AlarmEventState;
  /** 'open' = apenas ocorrências ativas (ACTIVE/ACTIVE_ACK). */
  open?: boolean;
  from?: Date;
  to?: Date;
}

const EVENT_INCLUDE = {
  alarmRule: {
    include: {
      point: {
        select: {
          id: true, tag: true, objectName: true, objectType: true, instance: true, unit: true, deviceId: true,
          device: { select: { id: true, name: true, site: { select: { name: true } }, tenant: { select: { name: true } } } },
        },
      },
    },
  },
} as const;

type EventWithRule = Prisma.AlarmEventGetPayload<{ include: typeof EVENT_INCLUDE }>;

/** TTL do cache de ids de tenants inativos (silenciamento de notificações). */
const INACTIVE_TENANTS_CACHE_TTL_MS = 15_000;

@Injectable()
export class AlarmEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: AlarmEngineService,
  ) {}

  private inactiveTenantsCache: { ids: string[]; expiresAt: number } | null = null;

  /**
   * Ids de clientes inativos, com cache curto. Usado para OMITIR eventos desses
   * clientes das listas/contadores (sino, dashboard, tela de alarmes) quando a
   * consulta está em escopo global — os eventos continuam gravados no histórico
   * e voltam a aparecer assim que o cliente for reativado.
   */
  async inactiveTenantIds(): Promise<string[]> {
    if (this.inactiveTenantsCache && this.inactiveTenantsCache.expiresAt > Date.now()) {
      return this.inactiveTenantsCache.ids;
    }
    const rows = await this.prisma.tenant.findMany({
      where: { active: false },
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    this.inactiveTenantsCache = { ids, expiresAt: Date.now() + INACTIVE_TENANTS_CACHE_TTL_MS };
    return ids;
  }

  async findAll(filters: AlarmEventFilters) {
    const rule: Prisma.AlarmRuleWhereInput = {};
    if (filters.pointId) rule.pointId = filters.pointId;
    const pointWhere: Prisma.DevicePointWhereInput = {};
    if (filters.deviceId) pointWhere.deviceId = filters.deviceId;
    if (filters.siteId) pointWhere.device = { siteId: filters.siteId };
    if (Object.keys(pointWhere).length) rule.point = pointWhere;
    if (filters.severity) rule.severity = filters.severity;

    // Escopo global (sem filtro de tenant): omite eventos de clientes inativos.
    const inactiveIds = filters.tenantId ? [] : await this.inactiveTenantIds();

    const where: Prisma.AlarmEventWhereInput = {
      // A tela de alarmes é exclusiva de telemetria; avisos de automação
      // (kind=AUTOMATION_NOTICE) só aparecem no sino (controller legado).
      kind: 'ALARM',
      ...(filters.tenantId
        ? { tenantId: filters.tenantId }
        : inactiveIds.length > 0
          ? { tenantId: { notIn: inactiveIds } }
          : {}),
      ...(filters.state ? { state: filters.state } : {}),
      ...(filters.open ? { state: { in: ACTIVE_STATES } } : {}),
      // Período pela atividade mais recente (reativação/normalização), não só
      // pela primeira ativação — mesma semântica do relatório de alarmes.
      ...alarmPeriodWhere(filters.from, filters.to),
      ...(Object.keys(rule).length ? { alarmRule: rule } : {}),
    };

    const events = await this.prisma.alarmEvent.findMany({
      where,
      include: EVENT_INCLUDE,
      // Severidade mais alta primeiro (enum desc: HIGH→MEDIUM→LOW), depois mais recente.
      orderBy: [{ alarmRule: { severity: 'desc' } }, { activatedAt: 'desc' }],
    });
    // Dentro de cada severidade, atividade mais recente primeiro (alarme que
    // acabou de reativar sobe para o topo) — igual ao relatório.
    sortBySeverityThenActivity(events, (e) => e.alarmRule!.severity);

    const ackNames = await this.ackUserNames(events.map((e) => e.acknowledgedBy));
    return events.map((e) => this.toDto(e, ackNames));
  }

  /**
   * Resolve em lote os nomes dos usuários que reconheceram (acknowledgedBy guarda
   * o userId). Usuário excluído fica fora do mapa — o DTO devolve null e o
   * frontend exibe um fallback amigável, nunca o UUID cru.
   */
  async ackUserNames(userIds: (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((v): v is string => !!v))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  async stats(tenantId: string | undefined, siteId?: string) {
    // Escopo global: contadores não incluem eventos de clientes inativos.
    const inactiveIds = tenantId ? [] : await this.inactiveTenantIds();
    const scope: Prisma.AlarmEventWhereInput = {
      kind: 'ALARM',
      ...(tenantId
        ? { tenantId }
        : inactiveIds.length > 0
          ? { tenantId: { notIn: inactiveIds } }
          : {}),
      ...(siteId ? { alarmRule: { point: { device: { siteId } } } } : {}),
    };
    const [total, active, pendingAck, acknowledged, activeOnly, normalizedUnack] = await Promise.all([
      this.prisma.alarmEvent.count({ where: scope }),
      this.prisma.alarmEvent.count({ where: { ...scope, state: { in: ACTIVE_STATES } } }),
      this.prisma.alarmEvent.count({ where: { ...scope, state: { in: PENDING_ACK_STATES } } }),
      this.prisma.alarmEvent.count({ where: { ...scope, state: { in: ACK_STATES } } }),
      this.prisma.alarmEvent.count({ where: { ...scope, state: 'ACTIVE' } }),
      this.prisma.alarmEvent.count({ where: { ...scope, state: 'NORMALIZED_UNACK' } }),
    ]);
    return {
      total,
      active,
      pendingAck,
      acknowledged,
      // Distribuição mutuamente exclusiva por estado, para o gráfico "Alarmes por
      // Status" do dashboard (cada ocorrência numa única fatia; total = soma):
      //   alarme      = ACTIVE
      //   normal      = NORMALIZED_UNACK (voltou ao normal, sem ACK)
      //   reconhecido = ACTIVE_ACK + NORMALIZED_ACK (= acknowledged)
      byStatus: {
        alarme: activeOnly,
        normal: normalizedUnack,
        reconhecido: acknowledged,
      },
    };
  }

  async acknowledge(
    id: string,
    tenantId: string | undefined,
    userId: string,
    note?: string,
    opts: { requireNote?: boolean } = {},
  ) {
    // Motivo obrigatório: a nota justifica o ACK e aparece no relatório de
    // alarmes. O sino legado (alarms-legacy) não tem campo de motivo e opta
    // por não exigir (requireNote: false).
    const requireNote = opts.requireNote ?? true;
    const trimmedNote = note?.trim();
    if (requireNote && !trimmedNote) {
      throw new BadRequestException('Informe o motivo do reconhecimento');
    }

    const event = await this.prisma.alarmEvent.findFirst({ where: tenantId ? { id, tenantId } : { id } });
    if (!event) throw new NotFoundException(`Evento de alarme ${id} não encontrado`);

    // ACK nunca produz INACTIVE, então o resultado é sempre um AlarmEventState válido.
    const next = nextStateOnAck(event.state) as AlarmEventState;
    if (next === event.state) {
      throw new BadRequestException('Evento não está em estado reconhecível');
    }

    const updated = await this.prisma.alarmEvent.update({
      where: { id },
      data: {
        state: next,
        acknowledgedAt: new Date(),
        acknowledgedBy: userId,
        ackNote: trimmedNote || null,
      },
      include: EVENT_INCLUDE,
    });
    // Sincroniza o runtime quando o ACK incidiu sobre a ocorrência ainda aberta.
    this.engine.syncAcknowledged(id);
    const ackNames = await this.ackUserNames([updated.acknowledgedBy]);
    return this.toDto(updated, ackNames);
  }

  /**
   * ACK em lote: aplica o mesmo motivo a todas as ocorrências, reusando a
   * lógica individual (escopo de tenant, transição de estado e sync do motor).
   * Itens que já não são reconhecíveis (ex.: outro operador acabou de dar ACK)
   * são pulados sem derrubar o lote inteiro.
   */
  async acknowledgeMany(ids: string[], tenantId: string | undefined, userId: string, note?: string) {
    const trimmedNote = note?.trim();
    if (!trimmedNote) {
      throw new BadRequestException('Informe o motivo do reconhecimento');
    }
    const uniqueIds = [...new Set(ids)].filter((id) => typeof id === 'string' && id.length > 0);
    if (uniqueIds.length === 0) {
      throw new BadRequestException('Informe ao menos uma ocorrência para reconhecer');
    }

    let acknowledged = 0;
    for (const id of uniqueIds) {
      try {
        await this.acknowledge(id, tenantId, userId, trimmedNote);
        acknowledged++;
      } catch (err) {
        // NotFound (fora do escopo) ou estado não reconhecível: pula o item.
        if (err instanceof NotFoundException || err instanceof BadRequestException) continue;
        throw err;
      }
    }

    if (acknowledged === 0) {
      throw new BadRequestException('Nenhuma das ocorrências selecionadas pôde ser reconhecida');
    }
    return { acknowledged };
  }

  private toDto(e: EventWithRule, ackNames: Map<string, string> = new Map()) {
    // findAll/stats são escopados a kind='ALARM', portanto alarmRule está sempre presente aqui.
    const rule = e.alarmRule!;
    const point = rule.point;
    return {
      id: e.id,
      alarmRuleId: e.alarmRuleId,
      tenantId: e.tenantId,
      tenantName: point.device.tenant.name,
      siteName: point.device.site?.name ?? null,
      pointId: point.id,
      deviceId: point.device.id,
      deviceName: point.device.name,
      tag: point.tag,
      objectName: point.objectName,
      unit: point.unit,
      name: rule.name,
      message: rule.message,
      severity: rule.severity,
      state: e.state,
      valueAtTrigger: e.valueAtTrigger,
      activatedAt: e.activatedAt.toISOString(),
      normalizedAt: e.normalizedAt?.toISOString() ?? null,
      acknowledgedAt: e.acknowledgedAt?.toISOString() ?? null,
      acknowledgedBy: e.acknowledgedBy,
      // Nome resolvido de quem reconheceu; null quando o usuário foi excluído
      // (o frontend exibe fallback amigável, nunca o UUID).
      acknowledgedByName: e.acknowledgedBy ? (ackNames.get(e.acknowledgedBy) ?? null) : null,
      ackNote: e.ackNote,
      reactivationCount: e.reactivationCount,
      lastReactivatedAt: e.lastReactivatedAt?.toISOString() ?? null,
    };
  }
}
