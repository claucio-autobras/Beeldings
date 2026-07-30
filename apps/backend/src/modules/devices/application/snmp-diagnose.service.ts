import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';

/**
 * Timeout do lado backend para o diagnóstico SNMP. O gateway testa cada OID
 * (~2.5s pior caso por lote) e faz 3 walks limitados (12s cada no pior caso);
 * 120s cobre câmera/gateway lentos com folga.
 */
const DIAGNOSE_TIMEOUT_MS = 120_000;

/** Tempo que o progresso fica disponível após o término. */
const PROGRESS_TTL_MS = 60_000;

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

export interface DiagnoseWalkSection {
  root: string;
  label: string;
  entries: Array<{ oid: string; value: string }>;
  truncated: boolean;
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

export interface DiagnoseSnmpDto {
  tenantId: string;
  gatewayId: string;
  ip: string;
  port: number;
  snmpVersion: '1' | '2c';
  community: string;
  current: DiagnoseOidProbe[];
  candidates: DiagnoseOidProbe[];
  /** ID gerado pelo cliente — permite acompanhar o progresso via polling. */
  diagnoseId?: string;
}

/** Causa provável quando a câmera não respondeu ao SNMP (reachable=false). */
export type SnmpUnreachableCause = 'community' | 'no_response';

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
  durationMs: number;
}

export type SnmpDiagnoseResult =
  | SnmpDiagnoseSuccess
  | { success: false; error: string };

interface PendingDiagnose {
  resolve: (result: SnmpDiagnoseResult) => void;
}

interface DiagnoseResultPayload {
  command_id: string;
  success: boolean;
  reachable?: boolean;
  cause?: string | null;
  sysDescr?: string | null;
  sysObjectId?: string | null;
  oidResults?: Record<string, DiagnoseOidResult>;
  walk?: DiagnoseWalkSection[];
  durationMs?: number;
  error?: string;
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
export class SnmpDiagnoseService implements OnModuleInit {
  private readonly logger = new Logger(SnmpDiagnoseService.name);

  private readonly pendingDiagnoses = new Map<string, PendingDiagnose>();
  private readonly progressByDiagnose = new Map<string, SnmpDiagnoseProgress>();

  constructor(private readonly mqttService: MqttService) {}

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

  /** Progresso atual de um diagnóstico (null se desconhecido/expirado). */
  getProgress(diagnoseId: string): SnmpDiagnoseProgress | null {
    return this.progressByDiagnose.get(diagnoseId) ?? null;
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
        current: dto.current,
        candidates: dto.candidates,
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
        durationMs: Number(payload.durationMs) || 0,
      });
    } else {
      pending.resolve({
        success: false,
        error: payload.error ?? 'Gateway reportou falha no diagnóstico SNMP',
      });
    }
  }
}
