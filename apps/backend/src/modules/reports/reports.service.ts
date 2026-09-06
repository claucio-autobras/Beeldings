import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AlarmEventState, AlarmSeverity, AuditResult } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildReportPdf } from './report-pdf.helper.js';
import { buildAlarmsReportPdf, type AlarmsPdfOccurrence } from './alarms-report-pdf.helper.js';
import { maskIp } from '../audit/audit.util.js';
import { alarmPeriodWhere, sortBySeverityThenActivity } from '../alarms/alarm-activity.util.js';
import { fmtDateTime } from './report-time.js';
import { AvailabilityService, type AvailabilityData, type AvailabilityInput, type AvailabilityRow } from './availability.service.js';

export type ReportTypeId = 'alarms' | 'trends' | 'audit' | 'availability';
export type ReportFormat = 'PDF' | 'CSV';

/** Filtro de estado para o relatório de alarmes. */
export type AlarmReportStatus = 'all' | 'active' | 'ack' | 'closed';

export interface ReportTypeInfo {
  id: ReportTypeId;
  label: string;
  description: string;
  formats: ReportFormat[];
  /** `false` enquanto a geração ainda não estiver implementada. */
  available: boolean;
}

export interface ReportFile {
  filename: string;
  mime: string;
  body: Buffer | string;
}

export interface AlarmReportInput {
  tenantId?: string;
  siteId?: string;
  from?: Date;
  to?: Date;
  status: AlarmReportStatus;
  format: ReportFormat;
}

export interface TrendReportInput {
  tenantId?: string;
  siteId?: string;
  ids: string[];
  from?: Date;
  to?: Date;
  format: ReportFormat;
}

export interface AuditReportInput {
  tenantId?: string;
  from?: Date;
  to?: Date;
  format: ReportFormat;
}

export interface AuditPreviewInput {
  tenantId?: string;
  from?: Date;
  to?: Date;
}

export interface CommandHistoryInput {
  tenantId?: string;
  userId?: string;
  result?: 'success' | 'error';
  from?: Date;
  to?: Date;
}

/** Contrato consumido pela aba "Histórico" da página Comandos do frontend. */
export interface CommandHistoryEntry {
  id: string;
  createdAt: string;
  userId: string | null;
  userName: string;
  userEmail: string;
  userRole: string;
  tenantId: string | null;
  gatewayId: string | null;
  siteId: string | null;
  siteName: string | null;
  target: string;
  value: string;
  result: 'success' | 'error' | 'unknown';
  error: string | null;
}

/** Contrato consumido pela tela "Relatório de Auditoria" do frontend. */
export interface AuditPreviewEntry {
  id: string;
  createdAt: string;
  user: string;
  userRole: string;
  action: string;
  actionCode: string;
  client: string;
  entity: string;
  change: string;
  entityId: string;
  origin: string;
  result: string;
}

export interface AuditPreviewData {
  total: number;
  rows: AuditPreviewEntry[];
}

const MAX_PDF_ROWS = 600;
const MAX_TREND_IDS = 12;

const ACTIVE_STATES: AlarmEventState[] = ['ACTIVE', 'ACTIVE_ACK'];
const ACK_STATES: AlarmEventState[] = ['ACTIVE_ACK', 'NORMALIZED_ACK'];
const CLOSED_STATES: AlarmEventState[] = ['NORMALIZED_UNACK', 'NORMALIZED_ACK'];

const STATE_LABEL: Record<AlarmEventState, string> = {
  ACTIVE: 'Ativo',
  ACTIVE_ACK: 'Ativo (reconhecido)',
  NORMALIZED_UNACK: 'Normalizado',
  NORMALIZED_ACK: 'Normalizado (reconhecido)',
};

const SEVERITY_LABEL: Record<AlarmSeverity, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
};

const STATUS_LABEL: Record<AlarmReportStatus, string> = {
  all: 'Histórico completo',
  active: 'Alarmes ativos',
  ack: 'Alarmes reconhecidos',
  closed: 'Alarmes encerrados',
};

/** Rótulos legíveis dos códigos de ação da trilha de auditoria. */
const ACTION_LABEL: Record<string, string> = {
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  CREATE: 'Criação',
  UPDATE: 'Edição',
  DELETE: 'Exclusão',
  COMMAND: 'Comando',
  ACK: 'Reconhecimento',
};

const AUDIT_RESULT_LABEL: Record<AuditResult, string> = {
  SUCCESS: 'Sucesso',
  FAILURE: 'Falha',
};

const MAX_AUDIT_ROWS = 500;
const MAX_COMMAND_HISTORY_ROWS = 500;

const ALARM_INCLUDE = {
  alarmRule: {
    include: {
      point: {
        select: {
          tag: true,
          objectName: true,
          unit: true,
          device: { select: { name: true } },
        },
      },
    },
  },
} as const;

/**
 * Geração de relatórios do BlueBee. Consulta os dados diretamente via Prisma
 * (PrismaModule é global) e formata em CSV ou PDF.
 *
 * - Alarmes e Trends estão funcionais.
 * - Auditoria depende de uma trilha de auditoria ainda inexistente (`available: false`).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  listTypes(): ReportTypeInfo[] {
    return [
      {
        id: 'alarms',
        label: 'Relatório de Alarmes',
        description: 'Alarmes ativos, reconhecidos, encerrados e histórico completo por período.',
        formats: ['PDF', 'CSV'],
        available: true,
      },
      {
        id: 'trends',
        label: 'Relatório de Trends',
        description: 'Exportação dos dados históricos das trends.',
        formats: ['PDF', 'CSV'],
        available: true,
      },
      {
        id: 'audit',
        label: 'Relatório de Auditoria',
        description: 'Rastreabilidade das ações realizadas na plataforma.',
        formats: ['PDF', 'CSV'],
        available: true,
      },
      {
        id: 'availability',
        label: 'Relatório de Disponibilidade',
        description: 'Uptime, quedas e tempo offline de gateways, equipamentos e câmeras.',
        formats: ['PDF', 'CSV'],
        available: true,
      },
    ];
  }

  // ─── Relatório de Disponibilidade ───────────────────────────────────────────

  /** Prévia (JSON) da disponibilidade — mesma fonte do PDF/CSV. */
  async getAvailabilityPreview(input: AvailabilityInput): Promise<AvailabilityData> {
    return this.availability.compute(input);
  }

  async generateAvailabilityReport(
    input: AvailabilityInput & { format: ReportFormat },
  ): Promise<ReportFile> {
    const data = await this.availability.compute(input);
    const periodo = this.periodLabel(input.from, input.to);
    const filename = `relatorio-disponibilidade-${this.stamp()}`;

    const kindLabel = (k: AvailabilityRow['kind']): string =>
      k === 'gateway' ? 'Gateway' : k === 'camera' ? 'Câmera' : 'Equipamento';
    const pct = (v: number | null): string => (v == null ? 'Sem dados' : `${v.toFixed(2)}%`);

    if (input.format === 'CSV') {
      const header = ['Equipamento', 'Tipo', 'Cliente', 'Site', 'Disponibilidade (%)', 'Quedas', 'Tempo offline', 'Maior queda', 'Cobertura desde'];
      const lines = data.rows.map((r) =>
        [
          r.name,
          kindLabel(r.kind),
          r.tenantName,
          r.siteName,
          r.noData ? 'Sem dados' : (r.uptimePct as number).toFixed(2),
          r.noData ? '' : String(r.drops),
          r.noData ? '' : fmtDurationMs(r.offlineMs),
          r.noData ? '' : fmtDurationMs(r.longestOfflineMs),
          r.coverageFrom ? fmtDateTime(new Date(r.coverageFrom)) : '',
        ].map(csvEscape).join(','),
      );
      return { filename: `${filename}.csv`, mime: 'text/csv; charset=utf-8', body: [header.join(','), ...lines].join('\n') };
    }

    // PDF — resumo geral + tabela por equipamento (pior disponibilidade primeiro).
    const capped = data.rows.slice(0, MAX_PDF_ROWS);
    const body = capped.map((r) => [
      r.name,
      kindLabel(r.kind),
      r.siteName || '—',
      pct(r.uptimePct),
      r.noData ? '—' : String(r.drops),
      r.noData ? '—' : fmtDurationMs(r.offlineMs),
      r.noData ? '—' : fmtDurationMs(r.longestOfflineMs),
      r.coverageFrom ? fmtDateTime(new Date(r.coverageFrom)) : '—',
    ]);
    const s = data.summary;
    const pdf = buildReportPdf(
      {
        title: 'Relatório de Disponibilidade',
        subtitle: `Disponibilidade dos equipamentos · ${periodo}. Cálculo restrito à janela coberta por dados de status; períodos sem cobertura aparecem como "Sem dados".`,
        compactRight: periodo,
        kpis: [
          { label: 'Equipamentos', value: String(s.entityCount) },
          { label: 'Uptime médio', value: s.avgUptimePct == null ? '—' : `${s.avgUptimePct.toFixed(2)}%` },
          { label: 'Quedas no período', value: String(s.totalDrops) },
          { label: 'Sem dados no período', value: String(s.entityCount - s.withDataCount) },
        ],
      },
      {
        head: ['Equipamento', 'Tipo', 'Site', 'Disponibilidade', 'Quedas', 'Tempo offline', 'Maior queda', 'Cobertura desde'],
        body,
        note:
          data.rows.length > capped.length
            ? `Exibindo os primeiros ${capped.length} de ${data.rows.length} equipamentos. Use o CSV para o conjunto completo.`
            : undefined,
      },
      'landscape',
    );
    return { filename: `${filename}.pdf`, mime: 'application/pdf', body: pdf };
  }

  // ─── Relatório de Alarmes ───────────────────────────────────────────────────

  async generateAlarmsReport(input: AlarmReportInput): Promise<ReportFile> {
    // Escopo global (sem cliente): omite eventos de clientes inativos — mesmo
    // recorte da tela de alarmes/preview, para que os totais batam.
    const inactiveIds = input.tenantId
      ? []
      : (await this.prisma.tenant.findMany({ where: { active: false }, select: { id: true } })).map((t) => t.id);

    const where: Prisma.AlarmEventWhereInput = {
      kind: 'ALARM',
      ...(input.tenantId
        ? { tenantId: input.tenantId }
        : inactiveIds.length > 0
          ? { tenantId: { notIn: inactiveIds } }
          : {}),
      ...(input.siteId ? { alarmRule: { point: { device: { siteId: input.siteId } } } } : {}),
      ...(input.status === 'active' ? { state: { in: ACTIVE_STATES } } : {}),
      ...(input.status === 'ack' ? { state: { in: ACK_STATES } } : {}),
      ...(input.status === 'closed' ? { state: { in: CLOSED_STATES } } : {}),
      // Período pela atividade mais recente (reativação/normalização), não só
      // pela primeira ativação — um alarme que reativou hoje entra no relatório de hoje.
      ...alarmPeriodWhere(input.from, input.to),
    };

    const events = await this.prisma.alarmEvent.findMany({
      where,
      include: ALARM_INCLUDE,
      orderBy: [{ alarmRule: { severity: 'desc' } }, { activatedAt: 'desc' }],
    });
    // Dentro de cada severidade, atividade mais recente primeiro (alarme que
    // acabou de reativar sobe para o topo).
    sortBySeverityThenActivity(events, (e) => e.alarmRule!.severity);

    // Resolve os ids de quem reconheceu para nome legível no relatório.
    const ackUserIds = [...new Set(events.map((e) => e.acknowledgedBy).filter((v): v is string => !!v))];
    const users = ackUserIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: ackUserIds } }, select: { id: true, name: true } })
      : [];
    const userNameById = new Map(users.map((u) => [u.id, u.name]));

    const rows = events.map((e) => {
      // Escopado a kind='ALARM', portanto alarmRule está sempre presente.
      const rule = e.alarmRule!;
      const point = rule.point;
      const value = e.valueAtTrigger != null ? `${e.valueAtTrigger}${point.unit ? ` ${point.unit}` : ''}` : '—';
      return {
        severity: SEVERITY_LABEL[rule.severity],
        state: STATE_LABEL[e.state],
        device: point.device.name,
        point: point.objectName ?? point.tag,
        message: rule.message,
        value,
        activatedAt: e.activatedAt,
        normalizedAt: e.normalizedAt,
        reactivationCount: e.reactivationCount,
        lastReactivatedAt: e.lastReactivatedAt,
        acknowledgedAt: e.acknowledgedAt,
        acknowledgedBy: e.acknowledgedBy ? (userNameById.get(e.acknowledgedBy) ?? e.acknowledgedBy) : '',
        ackNote: e.ackNote ?? '',
      };
    });

    const periodo = this.periodLabel(input.from, input.to);
    const filename = `relatorio-alarmes-${this.stamp()}`;

    if (input.format === 'CSV') {
      const header = ['Severidade', 'Estado', 'Equipamento', 'Ponto', 'Mensagem', 'Valor', 'Ativado em', 'Reativações', 'Última reativação', 'Normalizado em', 'Reconhecido em', 'Reconhecido por', 'Motivo'];
      const lines = rows.map((r) =>
        [
          r.severity, r.state, r.device, r.point, r.message, r.value,
          fmtDateTime(r.activatedAt),
          r.reactivationCount > 0 ? String(r.reactivationCount) : '',
          r.reactivationCount > 0 ? fmtDateTime(r.lastReactivatedAt) : '',
          fmtDateTime(r.normalizedAt), fmtDateTime(r.acknowledgedAt),
          r.acknowledgedBy, r.ackNote,
        ].map(csvEscape).join(','),
      );
      return { filename: `${filename}.csv`, mime: 'text/csv; charset=utf-8', body: [header.join(','), ...lines].join('\n') };
    }

    // PDF — layout de cartões (exclusivo do relatório de alarmes).
    const bySeverityKey = new Map<AlarmSeverity, number>();
    for (const e of events) {
      const sev = e.alarmRule!.severity;
      bySeverityKey.set(sev, (bySeverityKey.get(sev) ?? 0) + 1);
    }
    const cappedEvents = events.slice(0, MAX_PDF_ROWS);
    const occurrences: AlarmsPdfOccurrence[] = cappedEvents.map((e, i) => {
      const r = rows[i];
      return {
        severity: e.alarmRule!.severity,
        severityLabel: r.severity,
        stateLabel: r.state,
        device: r.device,
        point: r.point,
        message: r.message,
        value: r.value,
        activatedAt: fmtDateTime(r.activatedAt),
        normalizedAt: fmtDateTime(r.normalizedAt),
        reactivationCount: r.reactivationCount,
        lastReactivatedAt: r.reactivationCount > 0 ? fmtDateTime(r.lastReactivatedAt) : '',
        acknowledgedAt: fmtDateTime(r.acknowledgedAt),
        acknowledgedBy: r.acknowledgedBy,
        ackNote: r.ackNote,
      };
    });
    const pdf = buildAlarmsReportPdf({
      meta: {
        title: 'Relatório de alarmes',
        contentLabel: STATUS_LABEL[input.status],
        periodLabel: periodo,
        generatedAt: fmtDateTime(new Date()),
      },
      summary: {
        total: rows.length,
        high: bySeverityKey.get('HIGH') ?? 0,
        medium: bySeverityKey.get('MEDIUM') ?? 0,
        low: bySeverityKey.get('LOW') ?? 0,
      },
      occurrences,
      truncationNote:
        rows.length > cappedEvents.length
          ? `Exibindo as primeiras ${cappedEvents.length} de ${rows.length} ocorrências. Use o CSV para o conjunto completo.`
          : undefined,
    });
    return { filename: `${filename}.pdf`, mime: 'application/pdf', body: pdf };
  }

  // ─── Relatório de Trends ────────────────────────────────────────────────────

  async generateTrendsReport(input: TrendReportInput): Promise<ReportFile> {
    const ids = Array.from(new Set(input.ids.map((i) => i.trim()).filter(Boolean)));
    if (ids.length === 0) throw new BadRequestException('Selecione ao menos uma trend para o relatório');
    if (ids.length > MAX_TREND_IDS) throw new BadRequestException(`Máximo de ${MAX_TREND_IDS} trends por relatório`);

    const trends = await this.prisma.trend.findMany({
      where: {
        id: { in: ids },
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        ...(input.siteId ? { point: { device: { siteId: input.siteId } } } : {}),
      },
      include: { point: { select: { objectName: true, tag: true, unit: true, device: { select: { name: true } } } } },
    });
    if (trends.length === 0) throw new BadRequestException('Nenhuma trend encontrada no escopo');
    const nameById = new Map(trends.map((t) => [t.id, t]));
    const trendIds = trends.map((t) => t.id);

    const periodo = this.periodLabel(input.from, input.to);
    const filename = `relatorio-trends-${this.stamp()}`;
    const timeFilter = input.from || input.to
      ? { timestamp: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
      : {};

    if (input.format === 'CSV') {
      const records = await this.prisma.trendRecord.findMany({
        where: { trendId: { in: trendIds }, ...timeFilter },
        orderBy: { timestamp: 'asc' },
      });
      const header = ['Data/hora', 'Variável', 'Equipamento', 'Valor', 'Unidade', 'Qualidade'];
      const lines = records.map((r) => {
        const t = nameById.get(r.trendId);
        return [
          fmtDateTime(r.timestamp), t?.name ?? r.trendId, t?.point?.device.name ?? '',
          String(r.value), t?.point?.unit ?? '', r.quality,
        ].map(csvEscape).join(',');
      });
      return { filename: `${filename}.csv`, mime: 'text/csv; charset=utf-8', body: [header.join(','), ...lines].join('\n') };
    }

    // PDF — resumo estatístico por trend (count/min/max/média no período).
    const summaries = await Promise.all(
      trendIds.map(async (id) => {
        const rows = await this.prisma.$queryRaw<{ total: number; min: number | null; max: number | null; avg: number | null }[]>`
          SELECT count(*)::int AS total, min("value")::float8 AS min, max("value")::float8 AS max, avg("value")::float8 AS avg
          FROM "trend_records"
          WHERE "trend_id" = ${id}
            ${input.from ? Prisma.sql`AND "timestamp" >= ${input.from}` : Prisma.empty}
            ${input.to ? Prisma.sql`AND "timestamp" <= ${input.to}` : Prisma.empty}`;
        const s = rows[0] ?? { total: 0, min: null, max: null, avg: null };
        const t = nameById.get(id);
        return {
          name: t?.name ?? id,
          device: t?.point?.device.name ?? '',
          unit: t?.point?.unit ?? '',
          total: s.total,
          min: s.min,
          max: s.max,
          avg: s.avg,
        };
      }),
    );

    const fmtNum = (v: number | null, unit: string): string => (v == null ? '—' : `${Number(v.toFixed(2))}${unit ? ` ${unit}` : ''}`);
    const body = summaries.map((s) => [
      s.name, s.device, String(s.total), fmtNum(s.min, s.unit), fmtNum(s.max, s.unit), fmtNum(s.avg, s.unit),
    ]);
    const totalRecords = summaries.reduce((acc, s) => acc + s.total, 0);
    const pdf = buildReportPdf(
      {
        title: 'Relatório de Trends',
        subtitle: `${summaries.map((s) => s.name).join(', ')} · ${periodo}`,
        compactRight: periodo,
        kpis: [
          { label: 'Variáveis no relatório', value: String(summaries.length) },
          { label: 'Amostras no período', value: String(totalRecords) },
        ],
      },
      {
        head: ['Variável', 'Equipamento', 'Registros', 'Mínimo', 'Máximo', 'Média'],
        body,
        note: 'Resumo estatístico por variável no período. Para os registros completos, exporte em CSV.',
      },
      'portrait',
    );
    return { filename: `${filename}.pdf`, mime: 'application/pdf', body: pdf };
  }

  // ─── Auditoria ──────────────────────────────────────────────────────────────

  /**
   * Monta o `where` do escopo de auditoria. `tenantId` undefined = sem recorte
   * (perfil global sem filtro); '' = travado em ações globais (não deveria ocorrer
   * para um usuário sem tenant, mas mantém o contrato seguro); demais = aquele tenant.
   */
  private auditWhere(input: AuditPreviewInput | AuditReportInput): Prisma.AuditLogWhereInput {
    return {
      ...(input.tenantId !== undefined ? { tenantId: input.tenantId || null } : {}),
      ...(input.from || input.to
        ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
        : {}),
    };
  }

  private toPreviewEntry(log: {
    id: string;
    createdAt: Date;
    actorName: string | null;
    actorEmail: string;
    actorRole: string | null;
    action: string;
    tenantName: string | null;
    entityType: string | null;
    entityName: string | null;
    entityId: string | null;
    change: string | null;
    ip: string | null;
    result: AuditResult | null;
  }): AuditPreviewEntry {
    const entity = log.entityType
      ? log.entityName
        ? `${log.entityType}: ${log.entityName}`
        : log.entityType
      : (log.entityName ?? '');
    return {
      id: log.id,
      createdAt: log.createdAt.toISOString(),
      user: log.actorName ?? log.actorEmail,
      userRole: log.actorRole ?? '',
      action: ACTION_LABEL[log.action] ?? log.action,
      actionCode: log.action,
      client: log.tenantName ?? '',
      entity,
      change: log.change ?? '',
      entityId: log.entityId ?? '',
      origin: maskIp(log.ip),
      result: log.result ?? '',
    };
  }

  /**
   * Histórico completo de comandos de escrita — mesma fonte do card do
   * dashboard: trilha de auditoria com action='COMMAND'. Tenant scoping segue o
   * padrão dos feeds globais: visão global SEM filtro explícito exclui clientes
   * desativados (logs sem tenant permanecem).
   */
  async getCommandHistory(input: CommandHistoryInput): Promise<CommandHistoryEntry[]> {
    const where: Prisma.AuditLogWhereInput = { action: 'COMMAND' };

    if (input.tenantId) {
      where.tenantId = input.tenantId;
    } else if (input.tenantId === undefined) {
      const inactive = await this.prisma.tenant.findMany({
        where: { active: false },
        select: { id: true },
      });
      if (inactive.length > 0) {
        where.OR = [
          { tenantId: null },
          { tenantId: { notIn: inactive.map((t) => t.id) } },
        ];
      }
    } else {
      // Usuário de tenant sem tenant (não deveria acontecer): nada a mostrar.
      where.tenantId = '__none__';
    }

    if (input.userId) where.actorUserId = input.userId;
    if (input.result) where.result = input.result === 'success' ? 'SUCCESS' : 'FAILURE';
    if (input.from || input.to) {
      where.createdAt = {
        ...(input.from ? { gte: input.from } : {}),
        ...(input.to ? { lte: input.to } : {}),
      };
    }

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_COMMAND_HISTORY_ROWS,
      select: {
        id: true,
        createdAt: true,
        actorUserId: true,
        actorName: true,
        actorEmail: true,
        actorRole: true,
        tenantId: true,
        entityId: true,
        entityName: true,
        change: true,
        result: true,
      },
    });

    // Resolve o site de cada comando a partir do entityId do log — mesma
    // resolução do GET /commands do dashboard: o entityId pode ser um Device
    // (comando manual) ou um DevicePoint (automação). Logs antigos sem
    // entityId ficam sem site.
    const entityIds = [...new Set(logs.map((l) => l.entityId).filter((v): v is string => !!v))];
    const siteByEntity = new Map<string, { siteId: string; siteName: string }>();
    if (entityIds.length > 0) {
      const [devices, points] = await Promise.all([
        this.prisma.device.findMany({
          where: { id: { in: entityIds } },
          select: { id: true, siteId: true, site: { select: { name: true } } },
        }),
        this.prisma.devicePoint.findMany({
          where: { id: { in: entityIds } },
          select: {
            id: true,
            device: { select: { siteId: true, site: { select: { name: true } } } },
          },
        }),
      ]);
      for (const d of devices) {
        if (d.siteId && d.site) siteByEntity.set(d.id, { siteId: d.siteId, siteName: d.site.name });
      }
      for (const p of points) {
        if (p.device.siteId && p.device.site) {
          siteByEntity.set(p.id, { siteId: p.device.siteId, siteName: p.device.site.name });
        }
      }
    }

    return logs.map((log) => {
      // O resumo legível fica em `change` (ex.: "Forçar valor → 22 (prioridade 8)").
      // Falhas anexam " · Falha: <motivo>" — separamos p/ exibir como tooltip.
      const change = log.change ?? '';
      const failSep = ' · Falha: ';
      const failIdx = change.indexOf(failSep);
      const value = failIdx >= 0 ? change.slice(0, failIdx) : change;
      const error = failIdx >= 0 ? change.slice(failIdx + failSep.length) : null;
      return {
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        userId: log.actorUserId,
        userName: log.actorName ?? '',
        userEmail: log.actorEmail,
        userRole: log.actorRole ?? '',
        tenantId: log.tenantId,
        gatewayId: null,
        siteId: log.entityId ? (siteByEntity.get(log.entityId)?.siteId ?? null) : null,
        siteName: log.entityId ? (siteByEntity.get(log.entityId)?.siteName ?? null) : null,
        target: log.entityName ?? 'Equipamento',
        value,
        result: log.result === 'SUCCESS' ? 'success' as const : log.result === 'FAILURE' ? 'error' as const : 'unknown' as const,
        error,
      };
    });
  }

  /** Prévia (JSON) da trilha de auditoria respeitando o escopo de cliente. */
  async getAuditPreview(input: AuditPreviewInput): Promise<AuditPreviewData> {
    const where = this.auditWhere(input);
    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: MAX_AUDIT_ROWS,
      }),
    ]);
    return { total, rows: logs.map((l) => this.toPreviewEntry(l)) };
  }

  /** Download (PDF/CSV) da trilha de auditoria. */
  async generateAuditReport(input: AuditReportInput): Promise<ReportFile> {
    const where = this.auditWhere(input);
    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    const rows = logs.map((l) => this.toPreviewEntry(l));

    const periodo = this.periodLabel(input.from, input.to);
    const filename = `relatorio-auditoria-${this.stamp()}`;

    if (input.format === 'CSV') {
      const header = ['Data/hora', 'Usuário', 'Papel', 'Cliente', 'Ação', 'Entidade/alteração', 'Origem', 'Resultado'];
      const lines = rows.map((r) =>
        [
          fmtDateTime(new Date(r.createdAt)),
          r.user,
          r.userRole,
          r.client,
          r.action,
          [r.entity, r.change].filter(Boolean).join(' — '),
          r.origin,
          r.result ? (AUDIT_RESULT_LABEL[r.result as AuditResult] ?? r.result) : '—',
        ].map(csvEscape).join(','),
      );
      return { filename: `${filename}.csv`, mime: 'text/csv; charset=utf-8', body: [header.join(','), ...lines].join('\n') };
    }

    // PDF
    const byAction = new Map<string, number>();
    for (const r of rows) byAction.set(r.action, (byAction.get(r.action) ?? 0) + 1);
    const capped = rows.slice(0, MAX_PDF_ROWS);
    const body = capped.map((r) => [
      fmtDateTime(new Date(r.createdAt)),
      r.user,
      r.userRole,
      r.client,
      r.action,
      [r.entity, r.change].filter(Boolean).join(' — '),
      r.origin,
      r.result ? (AUDIT_RESULT_LABEL[r.result as AuditResult] ?? r.result) : '—',
    ]);
    const topActions = [...byAction.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    const pdf = buildReportPdf(
      {
        title: 'Relatório de Auditoria',
        subtitle: `Trilha de auditoria · ${periodo}`,
        compactRight: periodo,
        kpis: [
          { label: 'Total de eventos', value: String(rows.length) },
          ...topActions.map(([action, n]) => ({ label: action, value: String(n) })),
        ],
      },
      {
        head: ['Data/hora', 'Usuário', 'Papel', 'Cliente', 'Ação', 'Entidade/alteração', 'Origem', 'Resultado'],
        body,
        note: rows.length > capped.length ? `Exibindo os primeiros ${capped.length} de ${rows.length} eventos. Use o CSV para o conjunto completo.` : undefined,
      },
      'landscape',
    );
    return { filename: `${filename}.pdf`, mime: 'application/pdf', body: pdf };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private periodLabel(from?: Date, to?: Date): string {
    if (!from && !to) return 'Todo o histórico';
    return `${from ? fmtDateTime(from) : 'início'} até ${to ? fmtDateTime(to) : 'agora'}`;
  }

  private stamp(): string {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  }
}

// ─── Formatação ───────────────────────────────────────────────────────────────

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Duração legível: "2d 3h 04min", "58min", "45s", "—" para zero. */
export function fmtDurationMs(ms: number): string {
  if (ms <= 0) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const d = Math.floor(totalSec / 86_400);
  const h = Math.floor((totalSec % 86_400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  parts.push(`${String(m).padStart(2, '0')}min`);
  return parts.join(' ');
}

