import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import type { AlarmEventState, AlarmSeverity, AlarmEventKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { AlarmEventsService } from './alarm-events.service.js';
import { SYSTEM_TENANT_ID } from '../mqtt/telemetry.gateway.js';
import { resolveTenantScope } from '../auth/presentation/tenant-scope.util.js';

/**
 * Shim de compatibilidade do contrato binário antigo (`/alarms`), consumido pelo
 * sino de notificações (Topbar) e pelo dashboard. Lê do novo `alarm_events` e
 * mapeia para o shape legado (ALARME/NORMAL/RECONHECIDO). A tela principal de
 * alarmes usa os endpoints novos (`/alarm-events`).
 */
const ACTIVE_STATES: AlarmEventState[] = ['ACTIVE', 'ACTIVE_ACK'];
// Ocorrências que aguardam reconhecimento: apenas normalizadas sem ACK (voltaram
// ao normal mas nunca foram reconhecidas). Alarmes ainda ativos NÃO são
// reconhecíveis, então ficam de fora. Alimenta a lista "a reconhecer" do card
// "Prioridade dos alarmes" do dashboard. Espelha PENDING_ACK_STATES do serviço.
const PENDING_ACK_STATES: AlarmEventState[] = ['NORMALIZED_UNACK'];

const eventInclude = {
  alarmRule: {
    include: {
      point: { include: { device: { include: { site: { select: { name: true } }, tenant: { select: { name: true } } } } } },
    },
  },
} as const;

@Controller('alarms')
@UseGuards(JwtAuthGuard)
export class AlarmsLegacyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AlarmEventsService,
  ) {}

  @Get('/')
  async getAlarms(
    @CurrentUser() user: AuthenticatedUser,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: string,
  ) {
    const effectiveTenantId = resolveTenantScope(user, tenantId);

    // Avisos de automação (kind=AUTOMATION_NOTICE) são destinados ao operador do
    // cliente. Papéis globais (admin/CCO/supervisor, sem tenant próprio) nunca os
    // veem no sino — nem estando em escopo global, nem ao filtrar um cliente
    // específico. Alarmes de telemetria seguem visíveis para o escopo global.
    const isGlobalRole = user.tenantId == null;

    // Escopo global (sem filtro de cliente): o sino/dashboard não deve exibir
    // eventos de clientes inativos — o histórico permanece no banco e volta a
    // aparecer quando o cliente for reativado.
    const inactiveIds = effectiveTenantId ? [] : await this.events.inactiveTenantIds();

    const rows = await this.prisma.alarmEvent.findMany({
      where: {
        ...(effectiveTenantId
          ? { tenantId: effectiveTenantId }
          : inactiveIds.length > 0
            ? { tenantId: { notIn: inactiveIds } }
            : {}),
        ...(status === 'open'
          ? { state: { in: ACTIVE_STATES } }
          : status === 'pending-ack'
            ? { state: { in: PENDING_ACK_STATES } }
            : {}),
        // Papéis globais não veem avisos de automação dos clientes, MAS veem os
        // avisos de SISTEMA (tenantId sentinela __system__, ex.: saúde do broker).
        ...(isGlobalRole
          ? {
              OR: [
                { kind: { not: 'AUTOMATION_NOTICE' as AlarmEventKind } },
                { tenantId: SYSTEM_TENANT_ID },
              ],
            }
          : {}),
      },
      include: eventInclude,
      orderBy: { activatedAt: 'desc' },
    });

    // Avisos de automação (kind=AUTOMATION_NOTICE) não têm alarmRule, logo não
    // trazem o tenant pelo join. Resolve os nomes em lote para exibir a origem.
    const noticeTenantIds = [
      ...new Set(rows.filter((e) => e.alarmRule == null).map((e) => e.tenantId)),
    ];
    const tenantNames = new Map<string, string>([[SYSTEM_TENANT_ID, 'Sistema']]);
    if (noticeTenantIds.length > 0) {
      const tenants = await this.prisma.tenant.findMany({
        where: { id: { in: noticeTenantIds } },
        select: { id: true, name: true },
      });
      for (const t of tenants) tenantNames.set(t.id, t.name);
    }

    // Resolve em lote o nome de quem reconheceu (acknowledgedBy = userId).
    const ackNames = await this.events.ackUserNames(rows.map((e) => e.acknowledgedBy));

    return rows.map((e) => this.toLegacy(e, tenantNames, ackNames));
  }

  @Get('/stats')
  getStats(@CurrentUser() user: AuthenticatedUser, @Query('tenantId') tenantId?: string) {
    const scope = resolveTenantScope(user, tenantId);
    // O serviço novo já devolve { total, active, pendingAck, acknowledged }.
    return this.events.stats(scope).then((s) => ({
      total: s.total,
      pendingAck: s.pendingAck,
      activeCount: s.active,
      acknowledgedCount: s.acknowledged,
    }));
  }

  /**
   * Marca avisos de automação (kind=AUTOMATION_NOTICE) como lidos de forma
   * persistente. Diferente do alarme de telemetria, o aviso não tem regra/ponto
   * e não passa pelo ciclo ACK/normalização — apenas some do sino após lido.
   * Vai direto para NORMALIZED_ACK (mapeia p/ RECONHECIDO, logo sai do "ALARME").
   */
  @Post('/notices/read')
  async markNoticesRead(
    @Body() body: { ids?: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
    if (ids.length === 0) return { updated: 0 };

    const isPrivileged = user.role === 'ADMIN' || user.role === 'CCO';
    const tenantScope = isPrivileged
      ? {}
      : { tenantId: user.tenantId ?? '__none__' };

    const result = await this.prisma.alarmEvent.updateMany({
      where: {
        id: { in: ids },
        kind: 'AUTOMATION_NOTICE',
        state: { in: ACTIVE_STATES },
        ...tenantScope,
      },
      data: {
        state: 'NORMALIZED_ACK',
        acknowledgedAt: new Date(),
        acknowledgedBy: user.id,
      },
    });

    return { updated: result.count };
  }

  @Post('/:id/acknowledge')
  async acknowledge(
    @Param('id') id: string,
    @Body() body: { userId?: string; note?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const scope = resolveTenantScope(user);
    const dto = await this.events.acknowledge(id, scope, body.userId ?? user.id, body.note, {
      requireNote: false,
    });
    return {
      id: dto.id,
      tenantId: dto.tenantId,
      tenantName: dto.tenantName,
      deviceId: dto.deviceId,
      deviceName: dto.deviceName,
      site: dto.tenantName,
      severity: dto.severity,
      alarmText: dto.message,
      status: this.mapStatus(dto.state),
      triggeredAt: dto.activatedAt,
      occurredAt: dto.activatedAt,
      acknowledgedBy: dto.acknowledgedBy,
      acknowledgedByName: dto.acknowledgedByName,
      acknowledgedAt: dto.acknowledgedAt,
      note: body.note ?? null,
      tag: dto.tag,
      valueAtTrigger: dto.valueAtTrigger,
    };
  }

  private toLegacy(
    e: {
      id: string; tenantId: string; kind: AlarmEventKind; state: AlarmEventState; valueAtTrigger: number | null;
      message: string | null; sourceName: string | null; sourceId: string | null; severity: AlarmSeverity | null;
      activatedAt: Date; lastReactivatedAt: Date | null; acknowledgedAt: Date | null; acknowledgedBy: string | null;
      alarmRule: { message: string; severity: AlarmSeverity; point: { tag: string; device: { id: string; name: string; site: { name: string } | null; tenant: { name: string } } } } | null;
    },
    tenantNames: Map<string, string>,
    ackNames: Map<string, string> = new Map(),
  ) {
    // Nome de quem reconheceu; null quando o usuário foi excluído (o frontend
    // exibe fallback amigável, nunca o UUID).
    const acknowledgedByName = e.acknowledgedBy ? (ackNames.get(e.acknowledgedBy) ?? null) : null;
    // Aviso de automação: sem regra/ponto/dispositivo. A origem é a automação.
    if (e.kind === 'AUTOMATION_NOTICE' || e.alarmRule == null) {
      const source = e.sourceName ?? 'Automação';
      return {
        id: e.id,
        kind: 'automation' as const,
        tenantId: e.tenantId,
        tenantName: tenantNames.get(e.tenantId) ?? '',
        deviceId: '',
        deviceName: source,
        site: source,
        sourceName: source,
        sourceId: e.sourceId ?? null,
        severity: e.severity ?? 'LOW',
        alarmText: e.message ?? '',
        status: this.mapStatus(e.state),
        triggeredAt: e.activatedAt.toISOString(),
        occurredAt: e.activatedAt.toISOString(),
        lastReactivatedAt: e.lastReactivatedAt?.toISOString() ?? null,
        acknowledgedBy: e.acknowledgedBy,
        acknowledgedByName,
        acknowledgedAt: e.acknowledgedAt?.toISOString() ?? null,
        note: null,
        tag: undefined,
        valueAtTrigger: null,
      };
    }

    const device = e.alarmRule.point.device;
    return {
      id: e.id,
      kind: 'alarm' as const,
      tenantId: e.tenantId,
      tenantName: device.tenant.name,
      deviceId: device.id,
      deviceName: device.name,
      site: device.site?.name ?? device.tenant.name,
      sourceName: null,
      sourceId: null,
      severity: e.alarmRule.severity,
      alarmText: e.alarmRule.message,
      status: this.mapStatus(e.state),
      triggeredAt: e.activatedAt.toISOString(),
      occurredAt: e.activatedAt.toISOString(),
      lastReactivatedAt: e.lastReactivatedAt?.toISOString() ?? null,
      acknowledgedBy: e.acknowledgedBy,
      acknowledgedByName,
      acknowledgedAt: e.acknowledgedAt?.toISOString() ?? null,
      note: null,
      tag: e.alarmRule.point.tag,
      valueAtTrigger: e.valueAtTrigger,
    };
  }

  private mapStatus(state: AlarmEventState): 'ALARME' | 'NORMAL' | 'RECONHECIDO' {
    if (state === 'ACTIVE') return 'ALARME';
    if (state === 'ACTIVE_ACK' || state === 'NORMALIZED_ACK') return 'RECONHECIDO';
    return 'NORMAL';
  }
}
