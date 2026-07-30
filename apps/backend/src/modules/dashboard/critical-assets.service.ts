import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { DeviceStatusService } from '../mqtt/device-status.service.js';
import { EXCLUDE_VIRTUAL_DEVICES } from '../prisma/device-filters.js';

/** Protocolos de câmera CFTV. */
const CFTV_PROTOCOLS = new Set(['snmp', 'onvif']);

/** Ordem de severidade para escolher o alarme "dominante" de um ativo. */
const SEVERITY_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export interface CriticalAssetDto {
  /** deviceId (kind device/camera) ou pointId (kind point). */
  id: string;
  kind: 'device' | 'camera' | 'point';
  name: string;
  deviceId: string;
  deviceName: string;
  /** Só para kind='point'. */
  pointId: string | null;
  tenantId: string;
  tenantName: string;
  siteId: string | null;
  siteName: string | null;
  /** Estado atual: 'fault' quando há alarme ativo; senão online/offline. */
  status: 'online' | 'offline' | 'fault';
  /**
   * Tempo em funcionamento (ms) dentro da janela do período, derivado do
   * ponto com opRole='status' com trend. null = sem dados (nunca 0 fake).
   */
  runtimeMs: number | null;
  /**
   * Ativo agora: último valor do ponto de status >= 0.5 com o device online.
   * null = sem dados suficientes para saber (sem ponto de status/sem valor).
   */
  activeNow: boolean | null;
  /**
   * Início do período "ligado" contínuo vigente (ISO, via trend do ponto de
   * status) e duração até agora. null = sem dados (nunca 0 fake).
   */
  activeSince: string | null;
  activeMs: number | null;
  /** Falha contínua: início do alarme ativo mais antigo (ISO) e duração. */
  faultSince: string | null;
  faultMs: number | null;
  faultSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  /** Evento de alarme dominante (deep-link /alarms?highlight=). */
  faultAlarmEventId: string | null;
  faultRuleName: string | null;
  /** Offline contínuo: início da queda vigente (status_events) e duração. */
  offlineSince: string | null;
  offlineMs: number | null;
  /** Última comunicação conhecida (durável), ISO ou null. */
  lastSeen: string | null;
  /** Tela SCADA (ativa) do tenant que referencia o equipamento, se houver. */
  scadaScreenId: string | null;
}

export interface CriticalAssetsData {
  from: string;
  to: string;
  generatedAt: string;
  assets: CriticalAssetDto[];
}

/**
 * Ativos críticos do dashboard: para cada device/ponto marcado como crítico,
 * computa estado atual, horas em funcionamento no período (trend do ponto
 * opRole='status'), duração de falha contínua (alarm_events ativos) e tempo
 * offline (status_events). Payload autodescritivo (durações em ms + timestamps
 * ISO) — mesma fonte consumida pela IA/assistente para manutenção preditiva.
 */
@Injectable()
export class CriticalAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deviceStatus: DeviceStatusService,
  ) {}

  async compute(input: {
    tenantId?: string;
    siteId?: string;
    from: Date;
    to: Date;
  }): Promise<CriticalAssetsData> {
    const { from, to } = input;
    const now = new Date();

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
    const deviceScope = {
      ...EXCLUDE_VIRTUAL_DEVICES,
      ...tenantScope,
      ...(input.siteId ? { siteId: input.siteId } : {}),
    };

    const [criticalDevices, criticalPoints] = await Promise.all([
      this.prisma.device.findMany({
        where: { critical: true, ...deviceScope },
        include: {
          site: { select: { id: true, name: true } },
          tenant: { select: { id: true, name: true } },
          points: {
            select: {
              id: true, tag: true, objectName: true, opRole: true,
              lastValue: true, lastValueAt: true,
              trends: { select: { id: true, enabled: true } },
            },
          },
        },
      }),
      this.prisma.devicePoint.findMany({
        where: { critical: true, device: deviceScope },
        include: {
          trends: { select: { id: true, enabled: true } },
          device: {
            include: {
              site: { select: { id: true, name: true } },
              tenant: { select: { id: true, name: true } },
              // Ponto STATUS da câmera: estado do ponto crítico considera o
              // canal da câmera (STATUS=0 com gateway vivo = offline).
              points: { select: { tag: true, lastValue: true } },
            },
          },
        },
      }),
    ]);

    const deviceIds = Array.from(new Set([
      ...criticalDevices.map((d) => d.id),
      ...criticalPoints.map((p) => p.deviceId),
    ]));
    if (deviceIds.length === 0) {
      return { from: from.toISOString(), to: to.toISOString(), generatedAt: now.toISOString(), assets: [] };
    }

    const tenantIds = Array.from(new Set([
      ...criticalDevices.map((d) => d.tenantId),
      ...criticalPoints.map((p) => p.device.tenantId),
    ]));

    const [lastSeenMap, latestStatusEvents, activeAlarms, scadaScreens] = await Promise.all([
      this.deviceStatus.resolveLastSeenMany(deviceIds),
      // Último evento de status por entidade (estado vigente da queda).
      this.prisma.$queryRaw<{ entity_id: string; status: string; at: Date }[]>`
        SELECT DISTINCT ON (entity_id) entity_id, status, at
        FROM status_events
        WHERE entity_id IN (${Prisma.join(deviceIds)})
        ORDER BY entity_id, at DESC`,
      this.prisma.alarmEvent.findMany({
        where: {
          kind: 'ALARM',
          state: { in: ['ACTIVE', 'ACTIVE_ACK'] },
          alarmRule: { point: { deviceId: { in: deviceIds } } },
        },
        select: {
          id: true, activatedAt: true,
          alarmRule: { select: { name: true, severity: true, pointId: true, point: { select: { deviceId: true } } } },
        },
      }),
      // Telas SCADA ativas dos tenants envolvidos (deep-link preferido do cliente).
      this.prisma.scadaScreen.findMany({
        where: { tenantId: { in: tenantIds }, status: 'active' },
        select: { id: true, tenantId: true, widgets: true },
      }),
    ]);

    const statusEventByDevice = new Map(latestStatusEvents.map((e) => [e.entity_id, e]));

    // Alarmes ativos agrupados por device e por ponto.
    type ActiveAlarm = { id: string; activatedAt: Date; severity: string; ruleName: string; pointId: string };
    const alarmsByDevice = new Map<string, ActiveAlarm[]>();
    for (const e of activeAlarms) {
      const rule = e.alarmRule!;
      const devId = rule.point.deviceId;
      const entry: ActiveAlarm = {
        id: e.id, activatedAt: e.activatedAt,
        severity: rule.severity, ruleName: rule.name, pointId: rule.pointId,
      };
      const list = alarmsByDevice.get(devId);
      if (list) list.push(entry);
      else alarmsByDevice.set(devId, [entry]);
    }

    // Tela SCADA que referencia o device (busca textual no JSON dos widgets).
    const screenTextByTenant = new Map<string, { id: string; text: string }[]>();
    for (const s of scadaScreens) {
      const list = screenTextByTenant.get(s.tenantId) ?? [];
      list.push({ id: s.id, text: JSON.stringify(s.widgets ?? []) });
      screenTextByTenant.set(s.tenantId, list);
    }
    const findScreen = (tenantId: string, deviceId: string): string | null =>
      screenTextByTenant.get(tenantId)?.find((s) => s.text.includes(deviceId))?.id ?? null;

    const faultOf = (alarms: ActiveAlarm[] | undefined) => {
      if (!alarms || alarms.length === 0) return null;
      const since = alarms.reduce((min, a) => (a.activatedAt < min ? a.activatedAt : min), alarms[0].activatedAt);
      const dominant = [...alarms].sort(
        (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
          || a.activatedAt.getTime() - b.activatedAt.getTime(),
      )[0];
      return { since, dominant };
    };

    type StatusPoint =
      | { lastValue: number | null; trends: { id: string; enabled: boolean }[] }
      | undefined;

    const assets: CriticalAssetDto[] = [];

    for (const d of criticalDevices) {
      const isCamera = CFTV_PROTOCOLS.has(d.protocol);
      const liveStatus = this.resolveDeviceStatus(d.id, isCamera, d.points);
      const fault = faultOf(alarmsByDevice.get(d.id));
      const statusPoint: StatusPoint = d.points.find((p) => p.opRole === 'status');
      assets.push(await this.buildAsset({
        id: d.id,
        kind: isCamera ? 'camera' : 'device',
        name: d.name,
        deviceId: d.id,
        deviceName: d.name,
        pointId: null,
        tenantId: d.tenantId,
        tenantName: d.tenant.name,
        siteId: d.siteId,
        siteName: d.site?.name ?? null,
        liveStatus,
        fault,
        statusPoint: isCamera ? undefined : statusPoint,
        from, to, now,
        statusEvent: statusEventByDevice.get(d.id),
        lastSeen: lastSeenMap.get(d.id) ?? null,
        scadaScreenId: findScreen(d.tenantId, d.id),
      }));
    }

    for (const p of criticalPoints) {
      // Ponto de device já crítico inteiro: mantém os dois (o usuário pediu os dois).
      const d = p.device;
      const isCamera = CFTV_PROTOCOLS.has(d.protocol);
      const liveStatus = this.resolveDeviceStatus(d.id, isCamera, d.points);
      const pointAlarms = (alarmsByDevice.get(d.id) ?? []).filter((a) => a.pointId === p.id);
      const fault = faultOf(pointAlarms);
      assets.push(await this.buildAsset({
        id: p.id,
        kind: 'point',
        name: p.objectName || p.tag,
        deviceId: d.id,
        deviceName: d.name,
        pointId: p.id,
        tenantId: d.tenantId,
        tenantName: d.tenant.name,
        siteId: d.siteId,
        siteName: d.site?.name ?? null,
        liveStatus,
        fault,
        statusPoint: p.opRole === 'status' ? p : undefined,
        from, to, now,
        statusEvent: statusEventByDevice.get(d.id),
        lastSeen: lastSeenMap.get(d.id) ?? null,
        scadaScreenId: findScreen(d.tenantId, d.id),
      }));
    }

    // Card foca o que importa ao operador: só itens em alarme OU ativos agora
    // (ponto de status ligado). Estrelados parados/offline sem alarme ficam fora.
    const visible = assets.filter((a) => a.status === 'fault' || a.activeNow === true);

    // Pior situação primeiro: falha (por severidade) > offline > online.
    const rank = (a: CriticalAssetDto) =>
      a.status === 'fault'
        ? 100 + (SEVERITY_RANK[a.faultSeverity ?? 'LOW'] ?? 1)
        : a.status === 'offline'
          ? 50
          : 0;
    visible.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: now.toISOString(),
      assets: visible,
    };
  }

  /**
   * Status atual do device. Câmeras: o valor do ponto STATUS manda (a câmera
   * pode estar offline com o gateway online publicando STATUS=0) — mas só se o
   * canal de monitoramento (device) estiver vivo; sem telemetria = offline.
   */
  private resolveDeviceStatus(
    deviceId: string,
    isCamera: boolean,
    points: { tag: string; lastValue: number | null }[],
  ): 'online' | 'offline' {
    const live = this.deviceStatus.getStatus(deviceId);
    if (!isCamera) return live;
    if (live === 'offline') return 'offline';
    const statusPoint = points.find((p) => p.tag === 'STATUS');
    if (!statusPoint || statusPoint.lastValue === null) return live;
    return statusPoint.lastValue >= 0.5 ? 'online' : 'offline';
  }

  private async buildAsset(args: {
    id: string;
    kind: 'device' | 'camera' | 'point';
    name: string;
    deviceId: string;
    deviceName: string;
    pointId: string | null;
    tenantId: string;
    tenantName: string;
    siteId: string | null;
    siteName: string | null;
    liveStatus: 'online' | 'offline';
    fault: { since: Date; dominant: { id: string; severity: string; ruleName: string } } | null;
    statusPoint?: { lastValue: number | null; trends: { id: string; enabled: boolean }[] };
    from: Date;
    to: Date;
    now: Date;
    statusEvent?: { status: string; at: Date };
    lastSeen: string | null;
    scadaScreenId: string | null;
  }): Promise<CriticalAssetDto> {
    const { fault, liveStatus, statusEvent, now } = args;

    // Offline contínuo: só quando o estado atual é offline E a última transição
    // registrada foi para offline; sem histórico = null ("sem dados").
    let offlineSince: string | null = null;
    let offlineMs: number | null = null;
    if (liveStatus === 'offline' && statusEvent?.status === 'offline') {
      offlineSince = statusEvent.at.toISOString();
      offlineMs = Math.max(0, now.getTime() - statusEvent.at.getTime());
    }

    const runtimeMs = await this.computeRuntime(args.statusPoint, args.from, args.to);

    // Ativo agora: último valor do ponto de status >= 0.5, mas só com o device
    // vivo (valor stale de device offline não vale). Sem ponto/valor = null.
    const sp = args.statusPoint;
    const activeNow: boolean | null =
      sp && sp.lastValue !== null
        ? liveStatus === 'online' && sp.lastValue >= 0.5
        : null;
    let activeSince: string | null = null;
    let activeMs: number | null = null;
    if (activeNow === true) {
      const since = await this.computeActiveSince(sp, now);
      if (since) {
        activeSince = since.toISOString();
        activeMs = Math.max(0, now.getTime() - since.getTime());
      }
    }

    return {
      id: args.id,
      kind: args.kind,
      name: args.name,
      deviceId: args.deviceId,
      deviceName: args.deviceName,
      pointId: args.pointId,
      tenantId: args.tenantId,
      tenantName: args.tenantName,
      siteId: args.siteId,
      siteName: args.siteName,
      status: fault ? 'fault' : liveStatus,
      runtimeMs,
      activeNow,
      activeSince,
      activeMs,
      faultSince: fault ? fault.since.toISOString() : null,
      faultMs: fault ? Math.max(0, now.getTime() - fault.since.getTime()) : null,
      faultSeverity: fault ? (fault.dominant.severity as 'LOW' | 'MEDIUM' | 'HIGH') : null,
      faultAlarmEventId: fault ? fault.dominant.id : null,
      faultRuleName: fault ? fault.dominant.ruleName : null,
      offlineSince,
      offlineMs,
      lastSeen: args.lastSeen,
      scadaScreenId: args.scadaScreenId,
    };
  }

  /**
   * Início do período "ligado" contínuo vigente: última transição off→on na
   * trend do ponto de status. Busca a amostra mais recente com valor < 0.5 e
   * usa a primeira amostra >= 0.5 depois dela; sem amostra "desligado", a
   * primeira amostra ligada conhecida. Sem trend/amostras = null (nunca 0 fake).
   */
  private async computeActiveSince(
    statusPoint: { trends: { id: string; enabled: boolean }[] } | undefined,
    now: Date,
  ): Promise<Date | null> {
    const trendIds = statusPoint?.trends.map((t) => t.id) ?? [];
    if (trendIds.length === 0) return null;

    const lastOff = await this.prisma.trendRecord.findFirst({
      where: { trendId: { in: trendIds }, value: { lt: 0.5 }, timestamp: { lte: now } },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });
    const firstOnAfter = await this.prisma.trendRecord.findFirst({
      where: {
        trendId: { in: trendIds },
        value: { gte: 0.5 },
        timestamp: { ...(lastOff ? { gt: lastOff.timestamp } : {}), lte: now },
      },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true },
    });
    return firstOnAfter?.timestamp ?? null;
  }

  /**
   * Tempo "ligado" (valor >= 0.5) dentro da janela, a partir da trend do ponto
   * de status. Inclui a amostra vigente anterior à janela. Sem trend/sem
   * amostras = null — nunca 0 fake.
   */
  private async computeRuntime(
    statusPoint: { trends: { id: string; enabled: boolean }[] } | undefined,
    from: Date,
    to: Date,
  ): Promise<number | null> {
    const trendIds = statusPoint?.trends.map((t) => t.id) ?? [];
    if (trendIds.length === 0) return null;

    const [prev, inWindow] = await Promise.all([
      this.prisma.trendRecord.findFirst({
        where: { trendId: { in: trendIds }, timestamp: { lt: from } },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true, value: true },
      }),
      this.prisma.trendRecord.findMany({
        where: { trendId: { in: trendIds }, timestamp: { gte: from, lte: to } },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true, value: true },
      }),
    ]);

    if (!prev && inWindow.length === 0) return null;

    let runtime = 0;
    let cursor = prev ? from.getTime() : inWindow[0].timestamp.getTime();
    let value = prev ? prev.value : inWindow[0].value;
    for (const r of inWindow) {
      const t = r.timestamp.getTime();
      if (t > cursor) {
        if (value >= 0.5) runtime += t - cursor;
        cursor = t;
      }
      value = r.value;
    }
    const end = to.getTime();
    if (end > cursor && value >= 0.5) runtime += end - cursor;
    return runtime;
  }
}
