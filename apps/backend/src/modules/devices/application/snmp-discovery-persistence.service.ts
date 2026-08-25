import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  SnmpDiagnoseSuccess,
  DiagnoseWalkEntry,
} from './snmp-diagnose.service.js';

/** Runs mantidos por device — os mais antigos são podados a cada gravação. */
const RUNS_RETAINED_PER_DEVICE = 10;

/** Intervalo mínimo entre runs automáticos (registro/agendado): 1×/dia. */
export const DISCOVERY_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Diff entre dois runs de descoberta (persistido no run novo). */
export interface DiscoveryDiff {
  appeared: string[];
  disappeared: string[];
  typeChanged: Array<{ oid: string; from: string | null; to: string | null }>;
  counts: { appeared: number; disappeared: number; typeChanged: number };
  previousRunId: string;
}

/** Binding mapeado que deixou de responder ou mudou de tipo. */
export interface BrokenBindingAlert {
  metricKey: string;
  oid: string;
  reason: 'missing' | 'type_changed';
}

export interface RecordedDiscovery {
  runId: string;
  totalOids: number;
  diff: DiscoveryDiff | null;
  brokenBindings: BrokenBindingAlert[];
}

/** Teto de OIDs no diff (proteção contra payloads gigantes na API). */
const DIFF_LIST_CAP = 200;

/**
 * SnmpDiscoveryPersistenceService
 *
 * Persistência da fase de DESCOBERTA (separada da coleta): cada walk de
 * diagnóstico vira um `discovery_run` + snapshot em `discovery_object`, com
 * diff contra o run anterior (OIDs que apareceram/sumiram/mudaram de tipo) e
 * detecção de bindings quebrados (métrica mapeada em `device_metric_binding`
 * que deixou de responder — típico após atualização de firmware).
 */
@Injectable()
export class SnmpDiscoveryPersistenceService {
  private readonly logger = new Logger(SnmpDiscoveryPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * O device pode rodar descoberta AUTOMÁTICA agora? (cadastro/agendada —
   * no máx. 1×/dia). Descoberta MANUAL não passa por aqui: sempre permitida.
   */
  async canRunAutoDiscovery(deviceId: string): Promise<boolean> {
    const last = await this.prisma.snmpDiscoveryRun.findFirst({
      where: { deviceId },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });
    if (!last) return true;
    return Date.now() - last.startedAt.getTime() >= DISCOVERY_MIN_INTERVAL_MS;
  }

  /**
   * Grava um run de descoberta a partir do resultado do diagnóstico do
   * gateway: snapshot dos objetos respondidos, diff vs run anterior e
   * marcação de bindings quebrados. Retorna o resumo para a UI.
   */
  async recordRun(params: {
    tenantId: string;
    deviceId: string;
    trigger: 'registration' | 'manual' | 'scheduled';
    result: SnmpDiagnoseSuccess;
  }): Promise<RecordedDiscovery> {
    const { tenantId, deviceId, trigger, result } = params;

    // Snapshot: entradas do walk dedupadas por OID (última vence).
    const objects = new Map<string, DiagnoseWalkEntry>();
    for (const section of result.walk) {
      for (const entry of section.entries) {
        objects.set(entry.oid, entry);
      }
    }
    const errors = (result.walkStats?.errors ?? []).map((e) => ({
      root: e.root,
      error: e.error,
    }));

    // Run anterior (para o diff) ANTES de criar o novo.
    const previous = await this.prisma.snmpDiscoveryRun.findFirst({
      where: { deviceId },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    const previousObjects = previous
      ? await this.prisma.snmpDiscoveryObject.findMany({
          where: { runId: previous.id },
          select: { oid: true, type: true },
        })
      : [];

    const diff = previous
      ? this.computeDiff(previous.id, previousObjects, objects)
      : null;

    // Bindings quebrados: OID mapeado que não respondeu neste walk, ou cujo
    // tipo ASN.1 mudou vs o snapshot anterior. Só faz sentido com walk
    // aproveitável (device alcançável e sem erro total).
    const bindings = await this.prisma.deviceMetricBinding.findMany({
      where: { deviceId },
    });
    const brokenBindings: BrokenBindingAlert[] = [];
    if (result.reachable && objects.size > 0) {
      const prevTypeByOid = new Map(previousObjects.map((o) => [o.oid, o.type]));
      for (const b of bindings) {
        const seen = objects.get(b.oid);
        if (!seen) {
          brokenBindings.push({ metricKey: b.metricKey, oid: b.oid, reason: 'missing' });
          continue;
        }
        const prevType = prevTypeByOid.get(b.oid);
        if (prevType && seen.type && prevType !== seen.type) {
          brokenBindings.push({
            metricKey: b.metricKey,
            oid: b.oid,
            reason: 'type_changed',
          });
        }
      }
      // Atualiza o estado persistido dos bindings (broken/brokenReason).
      const brokenByOid = new Map(brokenBindings.map((b) => [b.oid, b.reason]));
      for (const b of bindings) {
        const reason = brokenByOid.get(b.oid) ?? null;
        const shouldBeBroken = reason !== null;
        if (b.broken !== shouldBeBroken || b.brokenReason !== reason) {
          await this.prisma.deviceMetricBinding.update({
            where: { id: b.id },
            data: { broken: shouldBeBroken, brokenReason: reason },
          });
        }
      }
    }

    const run = await this.prisma.snmpDiscoveryRun.create({
      data: {
        tenantId,
        deviceId,
        trigger,
        durationMs: result.durationMs,
        totalOids: objects.size,
        errorCount: errors.length,
        errors: errors as object[],
        reachable: result.reachable,
        sysObjectId: result.sysObjectId,
        diff: diff ? (diff as unknown as object) : undefined,
        brokenBindings: brokenBindings as unknown as object[],
      },
    });

    if (objects.size > 0) {
      await this.prisma.snmpDiscoveryObject.createMany({
        data: [...objects.values()].map((o) => ({
          tenantId,
          runId: run.id,
          oid: o.oid,
          type: o.type ?? null,
          rawValue: o.value ?? null,
          mibName: null,
        })),
      });
    }

    await this.pruneOldRuns(deviceId);

    this.logger.log(
      `Descoberta SNMP gravada — device=${deviceId} run=${run.id} ` +
        `(${objects.size} OID(s), trigger=${trigger}` +
        `${brokenBindings.length ? `, ${brokenBindings.length} binding(s) quebrado(s)` : ''})`,
    );

    return { runId: run.id, totalOids: objects.size, diff, brokenBindings };
  }

  /** Lista os runs de um device (sem os objetos — snapshot sob demanda). */
  async listRuns(tenantId: string, deviceId: string) {
    const runs = await this.prisma.snmpDiscoveryRun.findMany({
      where: { tenantId, deviceId },
      orderBy: { startedAt: 'desc' },
      take: RUNS_RETAINED_PER_DEVICE,
    });
    return runs.map((r) => ({
      id: r.id,
      trigger: r.trigger,
      startedAt: r.startedAt,
      durationMs: r.durationMs,
      totalOids: r.totalOids,
      errorCount: r.errorCount,
      errors: r.errors,
      reachable: r.reachable,
      sysObjectId: r.sysObjectId,
      diff: r.diff,
      brokenBindings: r.brokenBindings,
    }));
  }

  private computeDiff(
    previousRunId: string,
    previousObjects: Array<{ oid: string; type: string | null }>,
    current: Map<string, DiagnoseWalkEntry>,
  ): DiscoveryDiff {
    const prevByOid = new Map(previousObjects.map((o) => [o.oid, o.type]));
    const appeared: string[] = [];
    const typeChanged: DiscoveryDiff['typeChanged'] = [];
    for (const [oid, entry] of current) {
      if (!prevByOid.has(oid)) {
        appeared.push(oid);
        continue;
      }
      const prevType = prevByOid.get(oid) ?? null;
      const curType = entry.type ?? null;
      if (prevType && curType && prevType !== curType) {
        typeChanged.push({ oid, from: prevType, to: curType });
      }
    }
    const disappeared = [...prevByOid.keys()].filter((oid) => !current.has(oid));
    return {
      appeared: appeared.slice(0, DIFF_LIST_CAP),
      disappeared: disappeared.slice(0, DIFF_LIST_CAP),
      typeChanged: typeChanged.slice(0, DIFF_LIST_CAP),
      counts: {
        appeared: appeared.length,
        disappeared: disappeared.length,
        typeChanged: typeChanged.length,
      },
      previousRunId,
    };
  }

  /** Mantém só os últimos N runs por device (cascade apaga os objetos). */
  private async pruneOldRuns(deviceId: string): Promise<void> {
    const stale = await this.prisma.snmpDiscoveryRun.findMany({
      where: { deviceId },
      orderBy: { startedAt: 'desc' },
      skip: RUNS_RETAINED_PER_DEVICE,
      select: { id: true },
    });
    if (stale.length > 0) {
      await this.prisma.snmpDiscoveryRun.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
    }
  }
}
