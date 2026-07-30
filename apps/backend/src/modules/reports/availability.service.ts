import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { EXCLUDE_VIRTUAL_DEVICES } from '../prisma/device-filters.js';

/** Protocolos de câmera CFTV (rótulo "Câmera" no relatório). */
const CFTV_PROTOCOLS = new Set(['snmp', 'onvif']);

export interface AvailabilityInput {
  tenantId?: string;
  siteId?: string;
  from?: Date;
  to?: Date;
}

export interface AvailabilityRow {
  id: string;
  name: string;
  kind: 'gateway' | 'device' | 'camera';
  siteName: string;
  tenantName: string;
  /** % de uptime na janela coberta; null = sem dados no período. */
  uptimePct: number | null;
  /** Quedas (transições online→offline) dentro da janela coberta. */
  drops: number;
  offlineMs: number;
  longestOfflineMs: number;
  /** Duração da janela efetivamente coberta por dados. */
  coverageMs: number;
  /** Início da cobertura (ISO); null = sem dados. */
  coverageFrom: string | null;
  noData: boolean;
}

export interface AvailabilityData {
  from: string | null;
  to: string;
  summary: {
    entityCount: number;
    withDataCount: number;
    /** Média simples do uptime das entidades com dados; null se nenhuma. */
    avgUptimePct: number | null;
    totalDrops: number;
    totalOfflineMs: number;
    /** Piores disponibilidades (até 5, só entidades com dados). */
    worst: { id: string; name: string; uptimePct: number }[];
  };
  rows: AvailabilityRow[];
}

interface TimelineEvent {
  status: string;
  at: Date;
}

/**
 * Cálculo de disponibilidade: reconstrói a linha do tempo de cada equipamento
 * (gateway, dispositivo, câmera) a partir das transições persistidas em
 * `status_events` e deriva uptime %, quedas, tempo offline e maior queda.
 *
 * Janela coberta: começa em `from` se há estado conhecido antes de `from`
 * (último evento anterior); senão, no primeiro evento dentro do período.
 * Períodos sem cobertura aparecem como "sem dados" — nunca 0%/100% enganosos.
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(input: AvailabilityInput): Promise<AvailabilityData> {
    const now = new Date();
    const to = input.to && input.to < now ? input.to : now;
    const from = input.from && input.from < to ? input.from : input.from ? to : undefined;

    // Escopo global sem cliente: exclui clientes desativados (padrão dos feeds).
    const inactiveIds = input.tenantId
      ? []
      : (
          await this.prisma.tenant.findMany({ where: { active: false }, select: { id: true } })
        ).map((t) => t.id);
    const tenantScope = input.tenantId
      ? { tenantId: input.tenantId }
      : inactiveIds.length > 0
        ? { tenantId: { notIn: inactiveIds } }
        : {};

    const [gateways, devices] = await Promise.all([
      this.prisma.gateway.findMany({
        where: {
          ...tenantScope,
          ...(input.siteId
            ? {
                OR: [
                  { projects: { some: { siteId: input.siteId } } },
                  { devices: { some: { siteId: input.siteId } } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          tenantId: true,
          tenant: { select: { name: true } },
          projects: { select: { site: { select: { name: true } } }, take: 1 },
        },
      }),
      this.prisma.device.findMany({
        where: {
          ...EXCLUDE_VIRTUAL_DEVICES,
          ...tenantScope,
          ...(input.siteId ? { siteId: input.siteId } : {}),
        },
        select: {
          id: true,
          name: true,
          protocol: true,
          tenantId: true,
          tenant: { select: { name: true } },
          site: { select: { name: true } },
        },
      }),
    ]);

    const entities: Omit<AvailabilityRow, 'uptimePct' | 'drops' | 'offlineMs' | 'longestOfflineMs' | 'coverageMs' | 'coverageFrom' | 'noData'>[] = [
      ...gateways.map((g) => ({
        id: g.id,
        name: `Gateway ${g.id}`,
        kind: 'gateway' as const,
        siteName: g.projects[0]?.site.name ?? '',
        tenantName: g.tenant.name,
      })),
      ...devices.map((d) => ({
        id: d.id,
        name: d.name,
        kind: CFTV_PROTOCOLS.has(d.protocol) ? ('camera' as const) : ('device' as const),
        siteName: d.site?.name ?? '',
        tenantName: d.tenant.name,
      })),
    ];

    const ids = entities.map((e) => e.id);
    const eventsByEntity = new Map<string, TimelineEvent[]>();
    const beforeByEntity = new Map<string, TimelineEvent>();

    if (ids.length > 0) {
      const events = await this.prisma.statusEvent.findMany({
        where: {
          entityId: { in: ids },
          at: { ...(from ? { gte: from } : {}), lte: to },
        },
        orderBy: { at: 'asc' },
        select: { entityId: true, status: true, at: true },
      });
      for (const e of events) {
        const list = eventsByEntity.get(e.entityId);
        if (list) list.push(e);
        else eventsByEntity.set(e.entityId, [e]);
      }

      if (from) {
        // Estado vigente na borda inicial: último evento ANTES de `from`.
        const before = await this.prisma.$queryRaw<
          { entity_id: string; status: string; at: Date }[]
        >`
          SELECT DISTINCT ON (entity_id) entity_id, status, at
          FROM status_events
          WHERE entity_id IN (${Prisma.join(ids)}) AND at < ${from}
          ORDER BY entity_id, at DESC`;
        for (const b of before) {
          beforeByEntity.set(b.entity_id, { status: b.status, at: b.at });
        }
      }
    }

    const rows: AvailabilityRow[] = entities.map((e) => {
      const stats = computeTimeline(
        eventsByEntity.get(e.id) ?? [],
        beforeByEntity.get(e.id) ?? null,
        from ?? null,
        to,
      );
      return { ...e, ...stats };
    });

    // Pior disponibilidade primeiro; "sem dados" no fim.
    rows.sort((a, b) => {
      if (a.noData !== b.noData) return a.noData ? 1 : -1;
      return (a.uptimePct ?? 101) - (b.uptimePct ?? 101);
    });

    const withData = rows.filter((r) => !r.noData);
    const avg =
      withData.length > 0
        ? withData.reduce((acc, r) => acc + (r.uptimePct ?? 0), 0) / withData.length
        : null;

    return {
      from: from ? from.toISOString() : null,
      to: to.toISOString(),
      summary: {
        entityCount: rows.length,
        withDataCount: withData.length,
        avgUptimePct: avg,
        totalDrops: withData.reduce((acc, r) => acc + r.drops, 0),
        totalOfflineMs: withData.reduce((acc, r) => acc + r.offlineMs, 0),
        worst: withData
          .filter((r) => r.uptimePct !== null)
          .slice(0, 5)
          .map((r) => ({ id: r.id, name: r.name, uptimePct: r.uptimePct as number })),
      },
      rows,
    };
  }
}

/**
 * Reconstrói a linha do tempo de UMA entidade e devolve as métricas da janela.
 * `before` é o último evento anterior a `from` (estado vigente na borda);
 * sem `before`, a cobertura começa no primeiro evento dentro do período.
 */
export function computeTimeline(
  events: TimelineEvent[],
  before: TimelineEvent | null,
  from: Date | null,
  to: Date,
): Pick<
  AvailabilityRow,
  'uptimePct' | 'drops' | 'offlineMs' | 'longestOfflineMs' | 'coverageMs' | 'coverageFrom' | 'noData'
> {
  let coverStart: Date | null = null;
  let status: string | null = null;

  if (before && from) {
    coverStart = from;
    status = before.status;
  } else if (events.length > 0) {
    coverStart = events[0].at;
    status = events[0].status;
  }

  if (!coverStart || coverStart >= to || !status) {
    return {
      uptimePct: null,
      drops: 0,
      offlineMs: 0,
      longestOfflineMs: 0,
      coverageMs: 0,
      coverageFrom: null,
      noData: true,
    };
  }

  let offlineMs = 0;
  let drops = 0;
  let longest = 0;
  let cursor = coverStart;

  for (const e of events) {
    if (e.at <= cursor) {
      status = e.status;
      continue;
    }
    const seg = e.at.getTime() - cursor.getTime();
    if (status === 'offline') {
      offlineMs += seg;
      if (seg > longest) longest = seg;
    }
    if (status === 'online' && e.status === 'offline') drops++;
    status = e.status;
    cursor = e.at;
  }

  const tail = to.getTime() - cursor.getTime();
  if (tail > 0 && status === 'offline') {
    offlineMs += tail;
    if (tail > longest) longest = tail;
  }

  const coverageMs = to.getTime() - coverStart.getTime();
  const uptimePct = coverageMs > 0 ? ((coverageMs - offlineMs) / coverageMs) * 100 : null;

  return {
    uptimePct,
    drops,
    offlineMs,
    longestOfflineMs: longest,
    coverageMs,
    coverageFrom: coverStart.toISOString(),
    noData: uptimePct === null,
  };
}
