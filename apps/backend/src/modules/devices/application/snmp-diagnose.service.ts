import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Timeout do lado backend para o diagnóstico SNMP. O gateway testa cada OID
 * (~2.5s pior caso por lote) e faz 3 walks limitados (12s cada no pior caso);
 * 120s cobre câmera/gateway lentos com folga.
 */
const DIAGNOSE_TIMEOUT_MS = 120_000;

/** Tempo que o progresso fica disponível após o término. */
const PROGRESS_TTL_MS = 60_000;

/**
 * Janela além do DIAGNOSE_TIMEOUT_MS antes de considerar um job "órfão":
 * a instância que recebeu o POST caiu/reiniciou antes de concluir (própria
 * pendência MQTT vive só em memória, então nenhuma instância vai resolvê-la).
 * Sem isso, o job ficaria 'pending' no banco para sempre. Roda em TODA
 * instância — UPDATE condicionado a status='pending' é idempotente, então
 * corridas entre instâncias não têm efeito colateral duplicado.
 */
const ORPHAN_SWEEP_GRACE_MS = 30_000;
const ORPHAN_SWEEP_INTERVAL_MS = 20_000;
const ORPHAN_JOB_ERROR_MESSAGE =
  'O gateway não respondeu dentro do tempo limite (a instância que processava o diagnóstico pode ter reiniciado). Tente novamente.';

/** OID a testar (cadastrado ou candidato de perfil). */
export interface DiagnoseOidProbe {
  metric: string;
  oid: string;
}

/** Resultado de leitura de um OID reportado pelo gateway. */
export interface DiagnoseOidResult {
  oid: string;
  responded: boolean;
  value: number | null;
  raw: string | null;
}

/**
 * Entrada do walk. Gateways novos (≥1.20) enriquecem cada entrada com tipo
 * ASN.1, valor normalizado e índice de instância; gateways antigos mandam só
 * { oid, value } — todos os campos novos são opcionais.
 */
export interface DiagnoseWalkEntry {
  oid: string;
  value: string;
  /** Nome do tipo ASN.1 ('OctetString', 'Gauge32', …). */
  type?: string;
  /** Valor normalizado numérico (null quando não numérico). */
  numeric?: number | null;
  /** Índice de instância (entradas de tabela/não-.0); null p/ escalares. */
  index?: number | null;
}

export interface DiagnoseWalkSection {
  root: string;
  label: string;
  entries: DiagnoseWalkEntry[];
  truncated: boolean;
  /** Campos enriquecidos (gateway ≥1.20). */
  found?: number;
  discarded?: Record<string, number>;
  error?: string | null;
  durationMs?: number;
}

/** Estatísticas agregadas do walk (gateway ≥1.20). */
export interface DiagnoseWalkStats {
  /** Alvo do walk — SEM a community (credencial nunca trafega no resultado). */
  target: { ip: string; port: number; snmpVersion: string };
  roots: Array<{
    root: string;
    label: string;
    found: number;
    discarded: number;
    truncated: boolean;
    durationMs: number;
    error: string | null;
  }>;
  totalFound: number;
  totalDiscarded: number;
  discardedReasons: Record<string, number>;
  errors: Array<{ root: string; error: string }>;
  walkDurationMs: number;
}

/** Progresso parcial de um diagnóstico em andamento. */
export interface SnmpDiagnoseProgress {
  phase: 'oids' | 'walk';
  tested: number;
  total: number;
  done: boolean;
  /** Tenant dono do diagnóstico (do tópico MQTT) — escopa o polling. */
  tenantId?: string;
}

/** Credenciais SNMPv3 (USM) em texto claro — só trafegam backend → gateway. */
export interface DiagnoseSnmpV3 {
  securityName: string;
  securityLevel?: 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';
  authProtocol?: string;
  authKey?: string;
  privProtocol?: string;
  privKey?: string;
  contextName?: string;
}

export interface DiagnoseSnmpDto {
  tenantId: string;
  gatewayId: string;
  ip: string;
  port: number;
  snmpVersion: '1' | '2c' | '3';
  community: string;
  /** Credenciais USM decifradas — obrigatórias quando snmpVersion='3'. */
  v3?: DiagnoseSnmpV3 | null;
  current: DiagnoseOidProbe[];
  candidates: DiagnoseOidProbe[];
  /** ID gerado pelo cliente — permite acompanhar o progresso via polling. */
  diagnoseId?: string;
  /**
   * Dicas de identificação do device (opcionais): habilitam raízes de walk
   * proprietárias declaradas pelos perfis do gateway. Gateways antigos ignoram.
   */
  deviceType?: string;
  manufacturer?: string;
}

/** Causa provável quando a câmera não respondeu ao SNMP (reachable=false). */
export type SnmpUnreachableCause = 'community' | 'no_response';

/**
 * Métrica canônica reportada pelo gateway (gateway ≥1.21+).
 * Resultado de resolução automática de métrica por catálogo interno do gateway.
 */
export interface GatewayCanonicalMetricResult {
  /** Chave canônica (ex.: 'cpu_usage', 'memory_used_percent', 'uptime'). */
  canonicalKey: string;
  /** Nome legível da métrica. */
  label: string;
  /** OID escolhido como melhor candidato; null para métricas derivadas/tabelas. */
  selectedOid: string | null;
  /** Valor lido pelo gateway (já em unidade de exibição). */
  value: number | null;
  /** Valor máximo observado (CPU multi-core). */
  maxValue?: number | null;
  /** Unidade de exibição. */
  unit: string;
  /** Fonte vencedora, já resolvida para nome legível. */
  source: string | null;
  /** Confiança da resolução feita pelo gateway. */
  confidence: 'exact' | 'inferred';
  /** OIDs membros (para métricas agregadas como média de CPUs). */
  memberOids?: string[];
  /** OIDs necessários para métricas derivadas de tabela. */
  dependencyOids?: string[];
  /** Detalhes por núcleo ou volume. */
  detail?: Array<Record<string, unknown>>;
  /** Contadores acumulados precisam ser convertidos para taxa no polling. */
  isCounter?: boolean;
  counterType?: 'counter32' | 'counter64';
  rawUnit?: string;
}

export type GatewayCanonicalMetrics = Record<string, GatewayCanonicalMetricResult>;

/** Formato transitório usado por gateways de desenvolvimento da Fase 3. */
interface LegacyGatewayCanonicalMetricResult {
  metricKey: string;
  oid: string;
  value: number | null;
  unit: string;
  verified?: boolean;
  memberOids?: string[];
  memberLabels?: Record<string, string>;
}

type GatewayCanonicalMetricsPayload =
  | GatewayCanonicalMetrics
  | LegacyGatewayCanonicalMetricResult[];

export interface SnmpDiagnoseSuccess {
  success: true;
  command_id: string;
  reachable: boolean;
  /** Preenchido só quando reachable=false. */
  cause: SnmpUnreachableCause | null;
  sysDescr: string | null;
  sysObjectId: string | null;
  oidResults: Record<string, DiagnoseOidResult>;
  walk: DiagnoseWalkSection[];
  /** Estatísticas do walk (null quando o gateway é antigo). */
  walkStats: DiagnoseWalkStats | null;
  durationMs: number;
  /**
   * Métricas canônicas resolvidas pelo gateway (gateway ≥1.21+).
   * null/undefined em gateways antigos — nesse caso os controllers fazem
   * a resolução via catálogo estático local.
   */
  canonicalMetrics?: GatewayCanonicalMetrics | null;
}

export type SnmpDiagnoseResult =
  | SnmpDiagnoseSuccess
  | { success: false; error: string };

interface PendingDiagnose {
  resolve: (result: SnmpDiagnoseResult) => void;
}

/** Status durável de um job de diagnóstico (persistido em Postgres). */
export type SnmpDiagnoseJobStatus =
  | { status: 'unknown' }
  | { status: 'pending'; progress: SnmpDiagnoseProgress }
  | { status: 'done'; result: unknown }
  | { status: 'error'; error: string };

interface DiagnoseResultPayload {
  command_id: string;
  success: boolean;
  reachable?: boolean;
  cause?: string | null;
  sysDescr?: string | null;
  sysObjectId?: string | null;
  oidResults?: Record<string, DiagnoseOidResult>;
  walk?: DiagnoseWalkSection[];
  walkStats?: DiagnoseWalkStats;
  durationMs?: number;
  error?: string;
  /** Gateway ≥1.21+ — métricas canônicas resolvidas automaticamente. */
  canonicalMetrics?: GatewayCanonicalMetricsPayload;
}

interface DiagnoseProgressPayload {
  command_id: string;
  phase?: string;
  tested?: number;
  total?: number;
}

/**
 * SnmpDiagnoseService (backend)
 *
 * Dispara o diagnóstico SNMP de uma câmera no gateway (comando MQTT) e aguarda
 * o resultado: leitura de cada OID cadastrado/candidato + walk resumido das
 * subárvores padrão. Mesmo padrão request/response dos probes: pendências por
 * command_id registradas ANTES do publish + tópico de resultado próprio, com
 * timeout no backend. Progresso parcial exposto via getProgress() (polling).
 */
@Injectable()
export class SnmpDiagnoseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SnmpDiagnoseService.name);

  private readonly pendingDiagnoses = new Map<string, PendingDiagnose>();
  private readonly progressByDiagnose = new Map<string, SnmpDiagnoseProgress>();
  private readonly orphanSweepTimer: NodeJS.Timeout;

  constructor(
    private readonly mqttService: MqttService,
    private readonly prisma: PrismaService,
  ) {
    this.orphanSweepTimer = setInterval(
      () => void this.sweepOrphanedJobs(),
      ORPHAN_SWEEP_INTERVAL_MS,
    );
    this.orphanSweepTimer.unref?.();
  }

  onModuleInit(): void {
    this.mqttService.subscribe('bluebee/+/gateway/+/discovery/snmp-diagnose-result', 0);
    this.mqttService.subscribe('bluebee/+/gateway/+/discovery/snmp-diagnose-progress', 0);
    this.mqttService.onMessage((topic: string, rawPayload: Buffer) => {
      if (topic.endsWith('/discovery/snmp-diagnose-result')) {
        this.handleResult(rawPayload);
      } else if (topic.endsWith('/discovery/snmp-diagnose-progress')) {
        this.handleProgress(topic, rawPayload);
      }
    });
  }

  onModuleDestroy(): void {
    clearInterval(this.orphanSweepTimer);
  }

  /**
   * Marca como 'error' jobs que ficaram 'pending' além do timeout de
   * segurança (DIAGNOSE_TIMEOUT_MS + margem) — cobre o caso em que a
   * instância que recebeu o POST caiu/reiniciou antes de resolver a
   * pendência MQTT em memória, o que deixaria o job pendente para sempre.
   * UPDATE condicionado a status='pending' é seguro mesmo com várias
   * instâncias rodando a mesma varredura concorrentemente.
   */
  private async sweepOrphanedJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - DIAGNOSE_TIMEOUT_MS - ORPHAN_SWEEP_GRACE_MS);
    try {
      const { count } = await this.prisma.snmpDiagnoseJob.updateMany({
        where: { status: 'pending', createdAt: { lt: cutoff } },
        data: { status: 'error', error: ORPHAN_JOB_ERROR_MESSAGE, completedAt: new Date() },
      });
      if (count > 0) {
        this.logger.warn(`${count} diagnóstico(s) SNMP órfão(s) marcado(s) como erro por timeout.`);
      }
    } catch (err) {
      this.logger.error(`Falha ao varrer diagnósticos SNMP órfãos: ${(err as Error).message}`);
    }
  }

  /** Progresso atual de um diagnóstico (null se desconhecido/expirado). */
  getProgress(diagnoseId: string): SnmpDiagnoseProgress | null {
    return this.progressByDiagnose.get(diagnoseId) ?? null;
  }

  /**
   * Cria o job durável do diagnóstico (Postgres) — chamado pelo controller
   * ANTES de disparar a execução em segundo plano, para que o polling nunca
   * veja "unknown" logo após o POST. Limpa jobs antigos do mesmo device: só
   * o diagnóstico mais recente por equipamento precisa ficar guardado.
   */
  async createJob(params: {
    diagnoseId: string;
    tenantId: string;
    deviceId: string;
  }): Promise<void> {
    await this.prisma.snmpDiagnoseJob.deleteMany({
      where: { deviceId: params.deviceId, id: { not: params.diagnoseId } },
    });
    await this.prisma.snmpDiagnoseJob.upsert({
      where: { id: params.diagnoseId },
      create: {
        id: params.diagnoseId,
        tenantId: params.tenantId,
        deviceId: params.deviceId,
        status: 'pending',
      },
      update: {
        status: 'pending',
        result: undefined,
        error: null,
        completedAt: null,
      },
    });
  }

  /** Marca o job como concluído com sucesso — payload é a resposta final da API. */
  async completeJobSuccess(diagnoseId: string, result: unknown): Promise<void> {
    try {
      await this.prisma.snmpDiagnoseJob.update({
        where: { id: diagnoseId },
        data: { status: 'done', result: result as never, error: null, completedAt: new Date() },
      });
    } catch (err) {
      this.logger.error(
        `Falha ao persistir resultado do diagnóstico ${diagnoseId}: ${(err as Error).message}`,
      );
    }
  }

  /** Marca o job como concluído com erro — mensagem amigável exibida no modal. */
  async completeJobError(diagnoseId: string, error: string): Promise<void> {
    try {
      await this.prisma.snmpDiagnoseJob.update({
        where: { id: diagnoseId },
        data: { status: 'error', error, result: undefined, completedAt: new Date() },
      });
    } catch (err) {
      this.logger.error(
        `Falha ao persistir erro do diagnóstico ${diagnoseId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Status durável do job para o polling do frontend — combina o resultado
   * final (Postgres, sobrevive a múltiplas instâncias) com o progresso
   * parcial em memória (MQTT, atualizado em TODAS as instâncias) enquanto o
   * job ainda está pendente. `tenantScope` (null = admin global) restringe a
   * consulta ao tenant dono do diagnóstico.
   */
  async getJobStatus(
    diagnoseId: string,
    tenantScope: string | undefined,
  ): Promise<SnmpDiagnoseJobStatus> {
    const job = await this.prisma.snmpDiagnoseJob.findUnique({ where: { id: diagnoseId } });
    if (!job) return { status: 'unknown' };
    if (tenantScope && job.tenantId !== tenantScope) return { status: 'unknown' };

    if (job.status === 'done') return { status: 'done', result: job.result };
    if (job.status === 'error') {
      return { status: 'error', error: job.error ?? 'Gateway reportou falha no diagnóstico SNMP' };
    }
    const progress = this.progressByDiagnose.get(diagnoseId) ?? {
      phase: 'oids' as const,
      tested: 0,
      total: 0,
      done: false,
    };
    return { status: 'pending', progress };
  }

  async diagnose(dto: DiagnoseSnmpDto): Promise<SnmpDiagnoseResult> {
    const commandId = dto.diagnoseId?.trim() || randomUUID();
    const commandTopic = `bluebee/${dto.tenantId}/gateway/${dto.gatewayId}/commands`;

    const commandPayload = {
      command_id: commandId,
      tenant_id: dto.tenantId,
      device_id: 'snmp-diagnose',
      protocol: 'snmp',
      action: 'diagnose',
      params: {
        ip: dto.ip,
        port: dto.port,
        snmpVersion: dto.snmpVersion,
        community: dto.community,
        // Credenciais v3 decifradas SÓ no payload MQTT ao gateway — nunca em
        // respostas da API nem em logs (mesmo padrão das senhas ONVIF).
        ...(dto.snmpVersion === '3' && dto.v3 ? { v3: dto.v3 } : {}),
        current: dto.current,
        candidates: dto.candidates,
        deviceType: dto.deviceType,
        manufacturer: dto.manufacturer,
      },
    };

    this.logger.log(
      `Publicando diagnóstico SNMP ${commandId} em ${commandTopic} ` +
        `(${dto.ip}:${dto.port}, ${dto.current.length} atual/is + ` +
        `${dto.candidates.length} candidato(s))`,
    );

    this.progressByDiagnose.set(commandId, {
      phase: 'oids',
      tested: 0,
      total: 0,
      done: false,
      tenantId: dto.tenantId,
    });

    // Registra a pendência ANTES do publish: o resultado pode chegar antes do
    // ack do publish QoS1 (regra aprendida no write BACnet).
    const resultPromise = new Promise<SnmpDiagnoseResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pendingDiagnoses.has(commandId)) {
          this.pendingDiagnoses.delete(commandId);
          this.finishProgress(commandId);
          this.logger.warn(
            `Timeout do diagnóstico SNMP ${commandId} (gateway: ${dto.gatewayId})`,
          );
          resolve({
            success: false,
            error:
              'O gateway não respondeu ao diagnóstico. Verifique se o gateway está online.',
          });
        }
      }, DIAGNOSE_TIMEOUT_MS);

      this.pendingDiagnoses.set(commandId, {
        resolve: (result: SnmpDiagnoseResult) => {
          clearTimeout(timeoutHandle);
          resolve(result);
        },
      });
    });

    try {
      await this.mqttService.publish(commandTopic, commandPayload, 1);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.error(`Falha ao publicar diagnóstico SNMP: ${msg}`);
      const pending = this.pendingDiagnoses.get(commandId);
      this.pendingDiagnoses.delete(commandId);
      this.finishProgress(commandId);
      pending?.resolve({
        success: false,
        error: 'Falha ao enviar o comando ao gateway. Tente novamente.',
      });
    }

    return resultPromise;
  }

  private handleProgress(topic: string, rawPayload: Buffer): void {
    let payload: DiagnoseProgressPayload;
    try {
      payload = JSON.parse(rawPayload.toString()) as DiagnoseProgressPayload;
    } catch {
      return;
    }
    if (!payload.command_id) return;
    // Progresso atrasado (entregue depois do resultado) não pode "reviver"
    // um diagnóstico já concluído.
    if (this.progressByDiagnose.get(payload.command_id)?.done) return;
    const tenantId = topic.split('/')[1] || this.progressByDiagnose.get(payload.command_id)?.tenantId;
    this.progressByDiagnose.set(payload.command_id, {
      phase: payload.phase === 'walk' ? 'walk' : 'oids',
      tested: Number(payload.tested) || 0,
      total: Number(payload.total) || 0,
      done: false,
      tenantId,
    });
  }

  private finishProgress(commandId: string): void {
    const current = this.progressByDiagnose.get(commandId);
    this.progressByDiagnose.set(
      commandId,
      current
        ? { ...current, done: true }
        : { phase: 'oids', tested: 0, total: 0, done: true },
    );
    const handle = setTimeout(
      () => this.progressByDiagnose.delete(commandId),
      PROGRESS_TTL_MS,
    );
    handle.unref?.();
  }

  private handleResult(rawPayload: Buffer): void {
    let payload: DiagnoseResultPayload;
    try {
      payload = JSON.parse(rawPayload.toString()) as DiagnoseResultPayload;
    } catch {
      this.logger.error('Falha ao parsear payload do resultado de diagnóstico SNMP');
      return;
    }
    if (!payload.command_id) return;

    // Marca o progresso como concluído em TODAS as instâncias (o resultado
    // chega via MQTT em cada uma) — não só na que originou o POST. Sem isso,
    // instâncias sem pendência ficariam com progresso "vivo" para sempre e o
    // polling em outra instância nunca veria done=true.
    this.finishProgress(payload.command_id);

    const pending = this.pendingDiagnoses.get(payload.command_id);
    if (!pending) return;
    this.pendingDiagnoses.delete(payload.command_id);

    if (payload.success) {
      pending.resolve({
        success: true,
        command_id: payload.command_id,
        reachable: Boolean(payload.reachable),
        cause: payload.reachable
          ? null
          : payload.cause === 'community'
            ? 'community'
            : 'no_response',
        sysDescr: payload.sysDescr ?? null,
        sysObjectId: payload.sysObjectId ?? null,
        oidResults: payload.oidResults ?? {},
        walk: Array.isArray(payload.walk) ? payload.walk : [],
        walkStats: payload.walkStats ?? null,
        durationMs: Number(payload.durationMs) || 0,
        canonicalMetrics: normalizeCanonicalMetrics(payload.canonicalMetrics),
      });
    } else {
      pending.resolve({
        success: false,
        error: payload.error ?? 'Gateway reportou falha no diagnóstico SNMP',
      });
    }
  }
}

function normalizeCanonicalMetrics(
  input: GatewayCanonicalMetricsPayload | undefined,
): GatewayCanonicalMetrics | null {
  if (!input) return null;
  if (!Array.isArray(input)) return input;

  return Object.fromEntries(
    input
      .filter((metric) => typeof metric.metricKey === 'string' && metric.metricKey.length > 0)
      .map((metric) => [
        metric.metricKey,
        {
          canonicalKey: metric.metricKey,
          label: metric.metricKey,
          selectedOid: metric.oid || null,
          value: metric.value,
          unit: metric.unit,
          source: null,
          confidence: metric.verified === false ? 'inferred' : 'exact',
          memberOids: metric.memberOids,
          detail: Object.entries(metric.memberLabels ?? {}).map(([oid, descr]) => ({
            oid,
            descr,
          })),
        } satisfies GatewayCanonicalMetricResult,
      ]),
  );
}
