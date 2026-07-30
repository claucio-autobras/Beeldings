import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BacnetWriteService } from '../../devices/application/bacnet-write.service.js';
import { ModbusWriteService } from '../../devices/application/modbus-write.service.js';
import { resolveModbusWriteTarget } from '../../devices/application/modbus-write-target.util.js';
import { MqttWriteService } from '../../devices/application/mqtt-write.service.js';
import { resolveMqttWriteTarget } from '../../devices/application/mqtt-write-target.util.js';
import { AuditService } from '../../audit/audit.service.js';
import { ClusterService } from '../../cluster/cluster.service.js';
import { AUTOMATION_NOTICE_CHANNEL } from '../../mqtt/telemetry.gateway.js';
import type { AlarmEventPayload } from '../../mqtt/telemetry.gateway.js';
import { PointValueCacheService } from './point-value-cache.service.js';
import {
  objectTypeToNum,
  toWriteNumber,
  isDigitalObjectType,
  type AutomationCondition,
  type NotifyConfig,
} from '../domain/automation.types.js';

type AutomationWithActions = Prisma.AutomationGetPayload<{ include: { actions: true } }>;
type ActionRow = AutomationWithActions['actions'][number];

type RunResult = 'SUCCESS' | 'PARTIAL' | 'FAILURE';

/** Detalhe por ação gravado no histórico de execuções. */
interface ActionRunDetail {
  type: string;
  branch: string;
  /** Rótulo legível: tag do ponto (WRITE_POINT) ou "Aviso" (NOTIFY). */
  label: string;
  status: 'SUCCESS' | 'FAILURE' | 'SKIPPED';
  error?: string;
}

/** Retenção fixa do histórico de execuções (dias). */
const RUN_HISTORY_RETENTION_DAYS = 90;

/**
 * Executa UMA automação. É o único ponto que despacha comandos: reusa o
 * `BacnetWriteService` (mesmo caminho de `POST /devices/bacnet/write`) e audita
 * cada escrita como `COMMAND`. Escrita reversa (término) só inverte digitais e
 * só é suportada em BACnet.
 */
@Injectable()
export class AutomationRunnerService {
  private readonly logger = new Logger(AutomationRunnerService.name);

  /** Guarda contra execução concorrente da mesma automação. */
  private readonly running = new Set<string>();

  /** Idempotência CONTINUOUS: último valor aplicado por ação (`actionId → value`). */
  private readonly lastApplied = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bacnetWrite: BacnetWriteService,
    private readonly modbusWrite: ModbusWriteService,
    private readonly mqttWrite: MqttWriteService,
    private readonly audit: AuditService,
    private readonly cache: PointValueCacheService,
    private readonly cluster: ClusterService,
  ) {}

  /**
   * Executa a automação `id`. `reason` é o rótulo humano ("agenda"/"término"/
   * "enquanto"). `reverse=true` roda em modo término (inverte digitais).
   */
  async run(id: string, reason: string, reverse = false): Promise<void> {
    if (this.running.has(id)) {
      this.logger.debug(`Automação ${id} já em execução — pulando`);
      return;
    }
    this.running.add(id);
    try {
      const auto = await this.prisma.automation.findUnique({
        where: { id },
        include: { actions: { orderBy: { order: 'asc' } } },
      });
      if (!auto || !auto.enabled) return;
      await this.execute(auto, reason, reverse);
    } catch (err) {
      this.logger.error(
        `Falha ao executar automação ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running.delete(id);
    }
  }

  private async execute(
    auto: AutomationWithActions,
    reason: string,
    reverse: boolean,
  ): Promise<void> {
    const startedAt = new Date();
    let acted = false;
    let anyFailure = false;
    let anySuccess = false;
    const details: ActionRunDetail[] = [];

    // Seleciona ações a rodar.
    let actions: ActionRow[];
    if (reverse) {
      // Término: só escritas (digitais serão invertidas dentro do executeWrite).
      actions = auto.actions.filter((a) => a.type === 'WRITE_POINT');
    } else if (auto.mode === 'CONTINUOUS') {
      const condition = auto.condition as AutomationCondition | null;
      const truth = await this.evaluateCondition(condition);
      if (truth === undefined) {
        // Skip gracioso: telemetria ausente/velha — não age neste ciclo.
        return;
      }
      const wantBranch = truth ? 'ON_TRUE' : 'ON_FALSE';
      actions = auto.actions.filter((a) => a.branch === 'ALWAYS' || a.branch === wantBranch);
    } else {
      // ONESHOT início: todas com branch ALWAYS.
      actions = auto.actions.filter((a) => a.branch === 'ALWAYS');
    }

    for (const action of actions) {
      if (action.delaySeconds && action.delaySeconds > 0) {
        await this.sleep(action.delaySeconds * 1000);
      }
      const detail: ActionRunDetail = {
        type: action.type,
        branch: action.branch,
        label: action.type === 'NOTIFY' ? 'Aviso' : '',
        status: 'SKIPPED',
      };
      try {
        let didWork = true;
        if (action.type === 'WRITE_POINT') {
          didWork = await this.executeWrite(auto, action, reason, reverse, detail);
        } else {
          await this.executeNotify(auto, action);
          detail.status = 'SUCCESS';
        }
        if (didWork) {
          acted = true;
          anySuccess = true;
          detail.status = 'SUCCESS';
        }
      } catch (err) {
        anyFailure = true;
        acted = true;
        detail.status = 'FAILURE';
        detail.error = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Ação ${action.id} da automação ${auto.id} falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      details.push(detail);
    }

    // Persistência de lastRun: em CONTINUOUS só grava quando algo aconteceu.
    if (auto.mode === 'CONTINUOUS' && !acted) return;

    const result: RunResult = anyFailure
      ? anySuccess
        ? 'PARTIAL'
        : 'FAILURE'
      : 'SUCCESS';
    await this.prisma.automation.update({
      where: { id: auto.id },
      data: { lastRunAt: new Date(), lastRunResult: result },
    });
    const errorSummary = this.buildErrorSummary(details);
    await this.recordRun(auto, reason, result, startedAt, details, errorSummary);
    // Fecha o ciclo do histórico: falha total/parcial gera aviso no sino do
    // operador (mesmo canal dos avisos NOTIFY). Nunca derruba a execução.
    if (result !== 'SUCCESS') {
      await this.notifyRunFailure(auto, result, errorSummary);
    }
  }

  /** Agrega os erros das ações que falharam num resumo legível (ou null). */
  private buildErrorSummary(details: ActionRunDetail[]): string | null {
    const failures = details.filter((d) => d.status === 'FAILURE');
    if (failures.length === 0) return null;
    return failures
      .map((d) => `Falha ao comandar ${d.label || 'ação'}: ${d.error ?? 'erro desconhecido'}`)
      .join('; ');
  }

  /**
   * Notifica o operador (sino) quando a execução falhou total ou parcialmente.
   * Reusa o padrão AUTOMATION_NOTICE dos avisos NOTIFY; `sourceId` carrega o id
   * da automação para o deep-link do sino até o histórico pré-filtrado.
   */
  private async notifyRunFailure(
    auto: AutomationWithActions,
    result: RunResult,
    errorSummary: string | null,
  ): Promise<void> {
    const prefix =
      result === 'PARTIAL'
        ? `Automação "${auto.name}" falhou parcialmente`
        : `Automação "${auto.name}" falhou`;
    const message = errorSummary ? `${prefix} — ${errorSummary}` : prefix;
    await this.publishNotice(auto, message, 'MEDIUM');
  }

  /**
   * Grava um registro no histórico de execuções (`automation_runs`) e expurga
   * registros além da retenção fixa. Nunca derruba a execução: falha aqui é
   * só logada (ex.: migração ainda não aplicada).
   */
  private async recordRun(
    auto: AutomationWithActions,
    trigger: string,
    result: RunResult,
    startedAt: Date,
    details: ActionRunDetail[],
    errorSummary: string | null,
  ): Promise<void> {
    try {
      await this.prisma.automationRun.create({
        data: {
          tenantId: auto.tenantId,
          automationId: auto.id,
          automationName: auto.name,
          trigger,
          result,
          startedAt,
          details: details as unknown as Prisma.InputJsonValue,
          errorSummary,
        },
      });
      // Retenção fixa: expurga o que passou do limite (barato: índice por automação).
      const cutoff = new Date(Date.now() - RUN_HISTORY_RETENTION_DAYS * 86_400_000);
      await this.prisma.automationRun.deleteMany({
        where: { automationId: auto.id, startedAt: { lt: cutoff } },
      });
    } catch (err) {
      this.logger.error(
        `Falha ao gravar histórico da automação ${auto.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Avalia a condição CONTINUOUS lendo o último valor do ponto no cache.
   * Retorna `undefined` se não houver valor fresco (skip gracioso).
   */
  private async evaluateCondition(
    condition: AutomationCondition | null,
  ): Promise<boolean | undefined> {
    if (!condition) return undefined;
    const point = await this.prisma.devicePoint.findUnique({
      where: { id: condition.pointId },
    });
    if (!point) return undefined;
    // Leitura funciona em TODOS os protocolos. Consulta pela identidade BACnet
    // (deviceId:objectType:objectInstance, conforme spec) e, quando o ponto não
    // tem objectType BACnet (Modbus/MQTT), o cache cai para a chave por tag.
    const current = this.cache.get(point.deviceId, {
      objectType: objectTypeToNum(point.objectType),
      instance: point.instance,
      tag: point.tag,
    });
    if (current === undefined) return undefined;
    return this.compare(current, condition.operator, condition.value);
  }

  private compare(
    current: number | boolean | string,
    operator: AutomationCondition['operator'],
    target: number | boolean,
  ): boolean {
    // Valores textuais (ex.: CharacterString Value, BACnet tipo 40): strings
    // numéricas são comparadas como número; texto puro só suporta igualdade.
    if (typeof current === 'string') {
      const numeric = Number(current);
      if (!Number.isFinite(numeric) || current.trim() === '') {
        if (operator === 'EQ') return current === String(target);
        if (operator === 'NEQ') return current !== String(target);
        return false;
      }
      current = numeric;
    }
    const a = typeof current === 'boolean' ? (current ? 1 : 0) : current;
    const b = typeof target === 'boolean' ? (target ? 1 : 0) : target;
    switch (operator) {
      case 'EQ':
        return a === b;
      case 'NEQ':
        return a !== b;
      case 'GT':
        return a > b;
      case 'LT':
        return a < b;
      case 'GTE':
        return a >= b;
      case 'LTE':
        return a <= b;
      default:
        return false;
    }
  }

  /**
   * Executa uma ação WRITE_POINT. Retorna `true` se de fato despachou um comando,
   * `false` se foi pulada por idempotência (CONTINUOUS mesmo valor) ou por ser
   * analógica em modo reverso.
   */
  private async executeWrite(
    auto: AutomationWithActions,
    action: ActionRow,
    reason: string,
    reverse: boolean,
    detail?: { label: string },
  ): Promise<boolean> {
    if (!action.targetPointId) {
      throw new Error('Ação de escrita sem ponto de destino');
    }
    const point = await this.prisma.devicePoint.findUnique({
      where: { id: action.targetPointId },
      include: { device: true },
    });
    if (!point) throw new Error(`Ponto ${action.targetPointId} não encontrado`);
    if (detail) detail.label = point.tag;
    const device = point.device;

    if (!device.gatewayId) {
      const msg = `Dispositivo "${device.name}" não tem gateway associado`;
      await this.auditFailure(auto, action, point.tag, msg);
      throw new Error(msg);
    }
    if (
      device.protocol !== 'bacnet' &&
      device.protocol !== 'modbus' &&
      device.protocol !== 'mqtt'
    ) {
      const msg = `escrita via ${device.protocol} ainda não suportada`;
      await this.auditFailure(auto, action, point.tag, msg);
      throw new Error(msg);
    }

    // Modbus/MQTT: resolve binding/config pelo MESMO caminho do endpoint manual.
    // Modbus: só holding/coil, RTU exige serial (coil = digital). MQTT: exige
    // binding de escrita (tópico + template); boolean = digital (reverse).
    // Falha de cadastro é auditada como FAILURE.
    let modbusTarget: ReturnType<typeof resolveModbusWriteTarget> | null = null;
    let mqttTarget: ReturnType<typeof resolveMqttWriteTarget> | null = null;
    let digital: boolean;
    let objNum: number | undefined;
    if (device.protocol === 'modbus') {
      try {
        modbusTarget = resolveModbusWriteTarget(device, point);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.auditFailure(auto, action, point.tag, msg);
        throw new Error(msg);
      }
      digital = modbusTarget.isDigital;
    } else if (device.protocol === 'mqtt') {
      try {
        mqttTarget = resolveMqttWriteTarget(device, point);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.auditFailure(auto, action, point.tag, msg);
        throw new Error(msg);
      }
      digital = mqttTarget.isDigital;
    } else {
      objNum = objectTypeToNum(point.objectType);
      if (objNum === undefined) {
        throw new Error(`objectType desconhecido: ${point.objectType}`);
      }
      digital = isDigitalObjectType(objNum);
    }

    // Valor configurado.
    const rawValue = action.value as number | boolean | null;
    if (rawValue === null || rawValue === undefined) {
      throw new Error('Ação de escrita sem valor');
    }

    let writeValue: number;
    if (reverse) {
      // Término: só inverte digitais; analógico/NOTIFY ignorados.
      if (!digital) return false;
      const on = toWriteNumber(rawValue) !== 0;
      writeValue = on ? 0 : 1;
    } else {
      writeValue = toWriteNumber(rawValue);
    }

    // Idempotência CONTINUOUS: só escreve se o valor-alvo mudou.
    if (auto.mode === 'CONTINUOUS') {
      const prev = this.lastApplied.get(action.id);
      if (prev !== undefined && prev === writeValue) {
        return false;
      }
    }

    let result: { success: boolean; error?: string };
    if (mqttTarget) {
      // MQTT: mesmo serviço do POST /devices/mqtt/write (template RPC renderizado
      // no backend; gateway confirma via responseTopic e publica o readback como
      // telemetria). Boolean respeita o valueType do binding.
      const { isDigital: _isDigital, ...request } = mqttTarget;
      result = await this.mqttWrite.writeMqtt({
        ...request,
        value: request.valueType === 'boolean' ? writeValue !== 0 : writeValue,
      });
    } else if (modbusTarget) {
      // Modbus: mesmo serviço do POST /devices/modbus/write (valor em unidade
      // de engenharia; o gateway reverte scale/offset e publica o readback).
      const { isDigital: _isDigital, ...request } = modbusTarget;
      result = await this.modbusWrite.writeModbus({ ...request, value: writeValue });
    } else {
      // Rota BACnet do device (MS/TP atrás de roteador) persistida em Device.config.
      const devCfg = (device.config ?? {}) as { net?: number | null; adr?: number[] | null };
      const net = typeof devCfg.net === 'number' && devCfg.net > 0 ? devCfg.net : null;
      const adr = Array.isArray(devCfg.adr) && devCfg.adr.length > 0 ? devCfg.adr : null;

      result = await this.bacnetWrite.writeBacnet({
        tenantId: device.tenantId,
        gatewayId: device.gatewayId,
        ip: device.ip,
        port: device.port,
        net,
        adr,
        objectType: objNum!,
        objectInstance: point.instance,
        value: writeValue,
        priority: auto.priority,
      });
    }

    if (!result.success) {
      const errMsg = result.error ?? 'erro desconhecido';
      await this.auditFailure(auto, action, point.tag, errMsg);
      throw new Error(errMsg);
    }

    if (auto.mode === 'CONTINUOUS') {
      this.lastApplied.set(action.id, writeValue);
    }

    await this.audit.record({
      actor: { name: `Automação: ${auto.name}`, email: 'automacao@bluebee' },
      action: 'COMMAND',
      entityType: 'device_command',
      entityName: point.tag,
      entityId: point.id,
      change: `${point.tag} (${reason}) → ${digital ? (writeValue ? 'Ligado' : 'Desligado') : writeValue}${point.unit ? ` ${point.unit}` : ''}`,
      after: {
        automationId: auto.id,
        automationName: auto.name,
        pointId: point.id,
        pointTag: point.tag,
        value: writeValue,
        priority: auto.priority,
        reason,
        reverse,
      },
      tenantId: device.tenantId,
      result: 'SUCCESS',
    });
    return true;
  }

  /**
   * NOTIFY: grava um aviso na mesma tabela que alimenta o sino (`alarm_events`,
   * kind=AUTOMATION_NOTICE) e emite em tempo real pelo mesmo gateway dos alarmes,
   * para o operador ver o pop-up e a entrada no sino. Envio externo (WhatsApp/
   * e-mail) fica para a V2. Nunca aborta a execução da automação: falha ao avisar
   * é logada, mas não derruba as demais ações.
   */
  private async executeNotify(auto: AutomationWithActions, action: ActionRow): Promise<void> {
    const cfg = (action.config ?? {}) as unknown as NotifyConfig;
    const message = cfg.message?.trim() || '(sem mensagem)';
    await this.publishNotice(auto, message, 'LOW');
  }

  /**
   * Grava um aviso na mesma tabela que alimenta o sino (`alarm_events`,
   * kind=AUTOMATION_NOTICE) e emite em tempo real pelo mesmo gateway dos
   * alarmes. `sourceId` = id da automação (deep-link do sino p/ o histórico).
   * Nunca aborta a execução: falha ao avisar é só logada.
   */
  private async publishNotice(
    auto: AutomationWithActions,
    message: string,
    severity: 'LOW' | 'MEDIUM',
  ): Promise<void> {
    try {
      const event = await this.prisma.alarmEvent.create({
        data: {
          tenantId: auto.tenantId,
          kind: 'AUTOMATION_NOTICE',
          state: 'ACTIVE',
          severity,
          sourceName: auto.name,
          sourceId: auto.id,
          message,
          activatedAt: new Date(),
        },
      });
      // Avisos de automação nascem SÓ no líder (o scheduler é leadership-gated).
      // Para que clientes conectados em QUALQUER instância os recebam, publicamos
      // no barramento do cluster (LISTEN/NOTIFY) — todas as instâncias reemitem
      // via Socket.IO no room do tenant. (Alarmes de telemetria não passam aqui:
      // são avaliados em cada instância e emitidos direto — ver TelemetryGateway.)
      const payload: AlarmEventPayload = {
        id: event.id,
        kind: 'AUTOMATION_NOTICE',
        tenantId: event.tenantId,
        sourceName: auto.name,
        sourceId: auto.id,
        message,
        severity,
        state: event.state,
        activatedAt: event.activatedAt.toISOString(),
      };
      await this.cluster.publish(AUTOMATION_NOTICE_CHANNEL, JSON.stringify(payload));
      this.logger.log(`[NOTIFY] Automação "${auto.name}": ${message}`);
    } catch (err) {
      this.logger.error(
        `Falha ao registrar aviso da automação "${auto.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async auditFailure(
    auto: AutomationWithActions,
    action: ActionRow,
    pointTag: string,
    error: string,
  ): Promise<void> {
    await this.audit.record({
      actor: { name: `Automação: ${auto.name}`, email: 'automacao@bluebee' },
      action: 'COMMAND',
      entityType: 'device_command',
      entityName: pointTag,
      entityId: action.targetPointId ?? undefined,
      change: `Falha ao comandar ${pointTag}: ${error}`,
      after: {
        automationId: auto.id,
        automationName: auto.name,
        pointId: action.targetPointId,
        error,
      },
      tenantId: auto.tenantId,
      result: 'FAILURE',
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
