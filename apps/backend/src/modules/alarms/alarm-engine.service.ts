import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { AlarmEvent, AlarmEventState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelemetryGateway } from '../mqtt/telemetry.gateway.js';
import { isConditionMet, type EvalRule } from './alarm-evaluator.js';

/** Subconjunto de telemetria consumido (compatível com BacnetTelemetryPayload). */
export interface TelemetrySample {
  deviceId: string;
  timestamp?: string;
  points: { tag: string; value: number | boolean | string }[];
}

/** Configuração + metadados da regra carregada do banco. */
interface LoadedRule extends EvalRule {
  id: string;
  tenantId: string;
  pointId: string;
  deviceId: string;
  tag: string;
  name: string;
  message: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  delaySeconds: number;
}

/** Estado de runtime por regra (em memória, re-hidratado no boot). */
interface RuleRuntime {
  rule: LoadedRule;
  openEventId: string | null;
  openEventState: AlarmEventState | null;
  pendingTimer: NodeJS.Timeout | null;
  pendingValue: number | null;
  /** Fila serial de operações de banco por regra (evita corrida normaliza↔reativa). */
  chain: Promise<void>;
}

const SEP = ' ';

/**
 * Runtime do motor de alarmes. Consome o stream de telemetria, aplica a lógica
 * pura (condição + histerese) do evaluator, trata delay com timer in-process,
 * persiste a máquina de estados em AlarmEvent e emite o evento no Socket.IO.
 *
 * A avaliação roda no backend (event-driven na ingestão). O evaluator é puro e
 * portável para o edge no futuro; só o runtime (banco/timer/socket) fica aqui.
 */
@Injectable()
export class AlarmEngineService implements OnModuleInit {
  private readonly logger = new Logger(AlarmEngineService.name);
  private byDeviceTag = new Map<string, RuleRuntime[]>();
  private byRuleId = new Map<string, RuleRuntime>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: TelemetryGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.reload();
    } catch (err) {
      this.logger.warn(`Alarmes ainda não disponíveis (migração pendente?): ${(err as Error).message}`);
    }
  }

  /** (Re)carrega regras ativas e re-hidrata ocorrências abertas. Chamado no boot e em CRUD. */
  async reload(): Promise<void> {
    // Cancela timers pendentes da configuração anterior.
    for (const rt of this.byRuleId.values()) {
      if (rt.pendingTimer) clearTimeout(rt.pendingTimer);
    }

    const rules = await this.prisma.alarmRule.findMany({
      where: { enabled: true },
      include: { point: { select: { deviceId: true, tag: true } } },
    });

    // Ocorrências ainda abertas (ACTIVE/ACTIVE_ACK) para re-hidratar o runtime.
    // Apenas alarmes de telemetria (kind='ALARM'); avisos de automação não têm regra.
    const openEvents = await this.prisma.alarmEvent.findMany({
      where: { state: { in: ['ACTIVE', 'ACTIVE_ACK'] }, kind: 'ALARM' },
      orderBy: { activatedAt: 'desc' },
    });
    // Apenas a ocorrência aberta MAIS RECENTE de cada regra vai para o runtime;
    // abertas excedentes (duplicatas de corrida do código antigo) são órfãs —
    // ninguém nunca as normalizaria e ficariam "Ativo" para sempre na lista.
    const openByRule = new Map<string, AlarmEvent>();
    const extraOpenIds: string[] = [];
    for (const e of openEvents) {
      if (!e.alarmRuleId) continue;
      if (!openByRule.has(e.alarmRuleId)) openByRule.set(e.alarmRuleId, e);
      else extraOpenIds.push(e.id);
    }

    // Reconciliação de duplicatas históricas (dados gravados antes do reuso de
    // ocorrência): para cada regra com ocorrência aberta, encerra como absorvida
    // (a) as ocorrências abertas excedentes e (b) as NORMALIZED_UNACK órfãs — a
    // lista e os contadores param de mostrar a mesma condição em duas linhas.
    const openRuleIds = [...openByRule.keys()];
    try {
      let reconciled = 0;
      if (extraOpenIds.length > 0) {
        const res = await this.prisma.alarmEvent.updateMany({
          where: { id: { in: extraOpenIds } },
          data: {
            state: 'NORMALIZED_ACK',
            normalizedAt: new Date(),
            acknowledgedAt: new Date(),
            ackNote: 'Encerrado automaticamente: ocorrência duplicada absorvida pela ocorrência ativa mais recente',
          },
        });
        reconciled += res.count;
      }
      if (openRuleIds.length > 0) {
        const res = await this.prisma.alarmEvent.updateMany({
          where: { kind: 'ALARM', state: 'NORMALIZED_UNACK', alarmRuleId: { in: openRuleIds } },
          data: {
            state: 'NORMALIZED_ACK',
            acknowledgedAt: new Date(),
            ackNote: 'Encerrado automaticamente: reativação do alarme absorveu esta ocorrência pendente',
          },
        });
        reconciled += res.count;
      }
      if (reconciled > 0) {
        this.logger.log(`Reconciliação de alarmes — ${reconciled} ocorrência(s) duplicada(s) encerrada(s)`);
      }
    } catch (err) {
      this.logger.error(`Falha na reconciliação de duplicatas de alarme: ${(err as Error).message}`);
    }

    const byTag = new Map<string, RuleRuntime[]>();
    const byId = new Map<string, RuleRuntime>();

    for (const r of rules) {
      const loaded: LoadedRule = {
        id: r.id,
        tenantId: r.tenantId,
        pointId: r.pointId,
        deviceId: r.point.deviceId,
        tag: r.point.tag,
        name: r.name,
        message: r.message,
        severity: r.severity,
        delaySeconds: r.delaySeconds,
        type: r.type,
        activationState: r.activationState,
        condition: r.condition,
        limitValue: r.limitValue,
        limitLow: r.limitLow,
        limitHigh: r.limitHigh,
        hysteresis: r.hysteresis,
      };
      const open = openByRule.get(r.id);
      const rt: RuleRuntime = {
        rule: loaded,
        openEventId: open?.id ?? null,
        openEventState: open?.state ?? null,
        pendingTimer: null,
        pendingValue: null,
        chain: Promise.resolve(),
      };
      const key = `${loaded.deviceId}${SEP}${loaded.tag}`;
      const arr = byTag.get(key) ?? [];
      arr.push(rt);
      byTag.set(key, arr);
      byId.set(r.id, rt);
    }

    this.byDeviceTag = byTag;
    this.byRuleId = byId;
    this.logger.log(`Config de alarmes recarregada — ${rules.length} regra(s) ativa(s)`);
  }

  /** Consome um ciclo de telemetria e avalia as regras dos pontos presentes. */
  consume(sample: TelemetrySample): void {
    if (this.byDeviceTag.size === 0 || !sample.deviceId) return;
    const ts = sample.timestamp ? new Date(sample.timestamp) : new Date();

    for (const p of sample.points ?? []) {
      const rts = this.byDeviceTag.get(`${sample.deviceId}${SEP}${p.tag}`);
      if (!rts) continue;
      const value = typeof p.value === 'boolean' ? (p.value ? 1 : 0) : Number(p.value);
      if (Number.isNaN(value)) continue;
      for (const rt of rts) this.evaluate(rt, value, ts);
    }
  }

  /** Aplica a decisão (condição + histerese + delay) a uma regra para um valor. */
  private evaluate(rt: RuleRuntime, value: number, ts: Date): void {
    const wasActive = rt.openEventId !== null;
    const met = isConditionMet(rt.rule, value, wasActive);

    if (wasActive) {
      // Ocorrência aberta: normaliza quando a condição cessa; senão mantém.
      if (!met) this.closeEvent(rt, ts);
      return;
    }

    // Sem ocorrência aberta.
    if (!met) {
      // Condição saiu antes do prazo → cancela o disparo pendente.
      if (rt.pendingTimer) {
        clearTimeout(rt.pendingTimer);
        rt.pendingTimer = null;
        rt.pendingValue = null;
      }
      return;
    }

    // Condição satisfeita.
    if (rt.rule.delaySeconds > 0) {
      rt.pendingValue = value; // mantém o último valor enquanto aguarda o prazo
      if (!rt.pendingTimer) {
        rt.pendingTimer = setTimeout(() => {
          rt.pendingTimer = null;
          const v = rt.pendingValue ?? value;
          rt.pendingValue = null;
          this.openEvent(rt, v, new Date());
        }, rt.rule.delaySeconds * 1000);
      }
    } else {
      this.openEvent(rt, value, ts);
    }
  }

  /**
   * Enfileira uma operação de banco na cadeia serial da regra. Garante que
   * normalizar → reativar executem em ordem (a reativação só consulta o banco
   * depois que a normalização anterior foi persistida), sem corrida.
   */
  private enqueue(rt: RuleRuntime, op: () => Promise<void>): void {
    rt.chain = rt.chain.then(op).catch((err: unknown) => {
      this.logger.error(`Falha em operação do alarme ${rt.rule.name}: ${(err as Error).message}`);
    });
  }

  /**
   * Abre a ocorrência (ACTIVE), persiste e emite no socket.
   * Se a regra tem uma ocorrência NORMALIZED_UNACK (normalizou mas ninguém
   * reconheceu), REAPROVEITA essa ocorrência: volta para ACTIVE, limpa o
   * horário de normalização e atualiza o valor do disparo — evitando duas
   * linhas ("Ativo" + "Aguardando ACK") para o mesmo alarme. Ocorrências já
   * reconhecidas (NORMALIZED_ACK) ficam fechadas: nova ativação cria linha nova.
   */
  private openEvent(rt: RuleRuntime, value: number, ts: Date): void {
    this.enqueue(rt, async () => {
      // Corrida: se já abriu entre o agendamento e a execução, ignora.
      if (rt.openEventId) return;

      // Procura ocorrência pendente de ACK para reaproveitar.
      const pending = await this.prisma.alarmEvent.findFirst({
        where: { alarmRuleId: rt.rule.id, kind: 'ALARM', state: 'NORMALIZED_UNACK' },
        orderBy: { activatedAt: 'desc' },
      });
      if (pending) {
        // Guarda contra corrida com ACK via API: só reativa se AINDA está
        // NORMALIZED_UNACK no banco (updateMany é condicional; count=0 = perdeu).
        const res = await this.prisma.alarmEvent.updateMany({
          where: { id: pending.id, state: 'NORMALIZED_UNACK' },
          data: {
            state: 'ACTIVE',
            normalizedAt: null,
            valueAtTrigger: value,
            // Registra a oscilação: a ocorrência normalizou e voltou a ATIVO
            // antes do ACK. O contador vive só neste ciclo (nova ocorrência
            // pós-ACK nasce com 0).
            reactivationCount: { increment: 1 },
            lastReactivatedAt: new Date(),
          },
        });
        if (res.count === 1) {
          const event = await this.prisma.alarmEvent.findUniqueOrThrow({ where: { id: pending.id } });
          rt.openEventId = event.id;
          rt.openEventState = 'ACTIVE';
          await this.emit(rt, event);
          this.logger.log(
            `Alarme REATIVADO — regra ${rt.rule.name} (ponto ${rt.rule.tag}, valor ${value}) — ocorrência pendente reaproveitada`,
          );
          return;
        }
        // Perdeu a corrida (ex.: ACK chegou antes) → segue criando uma nova.
      }

      const event = await this.prisma.alarmEvent.create({
        data: {
          alarmRuleId: rt.rule.id,
          tenantId: rt.rule.tenantId,
          state: 'ACTIVE',
          valueAtTrigger: value,
          activatedAt: ts,
        },
      });
      rt.openEventId = event.id;
      rt.openEventState = 'ACTIVE';
      await this.emit(rt, event);
      this.logger.log(`Alarme ATIVADO — regra ${rt.rule.name} (ponto ${rt.rule.tag}, valor ${value})`);
    });
  }

  /** Normaliza a ocorrência aberta (NORMALIZED_UNACK/ACK), persiste e emite. */
  private closeEvent(rt: RuleRuntime, ts: Date): void {
    const id = rt.openEventId;
    if (!id) return;
    const nextState: AlarmEventState =
      rt.openEventState === 'ACTIVE_ACK' ? 'NORMALIZED_ACK' : 'NORMALIZED_UNACK';
    // Limpa o runtime de forma síncrona para evitar dupla normalização concorrente.
    rt.openEventId = null;
    rt.openEventState = null;
    this.enqueue(rt, async () => {
      const event = await this.prisma.alarmEvent.update({
        where: { id },
        data: { state: nextState, normalizedAt: ts },
      });
      await this.emit(rt, event);
      this.logger.log(`Alarme NORMALIZADO — regra ${rt.rule.name} (ponto ${rt.rule.tag})`);
    });
  }

  /**
   * Sincroniza o runtime após um ACK feito via API (na ocorrência aberta).
   * Para ocorrências já normalizadas o ACK só altera o banco — sem runtime.
   */
  syncAcknowledged(eventId: string): void {
    for (const rt of this.byRuleId.values()) {
      if (rt.openEventId === eventId && rt.openEventState === 'ACTIVE') {
        rt.openEventState = 'ACTIVE_ACK';
        return;
      }
    }
  }

  private async emit(rt: RuleRuntime, event: AlarmEvent): Promise<void> {
    // Resolve o nome de quem reconheceu (acknowledgedBy = userId) para o payload
    // em tempo real; usuário excluído → null (frontend exibe fallback amigável).
    let acknowledgedByName: string | null = null;
    if (event.acknowledgedBy) {
      const user = await this.prisma.user.findUnique({
        where: { id: event.acknowledgedBy },
        select: { name: true },
      });
      acknowledgedByName = user?.name ?? null;
    }
    this.gateway.emitAlarmEvent({
      id: event.id,
      kind: 'ALARM',
      alarmRuleId: event.alarmRuleId,
      tenantId: event.tenantId,
      pointId: rt.rule.pointId,
      deviceId: rt.rule.deviceId,
      tag: rt.rule.tag,
      name: rt.rule.name,
      message: rt.rule.message,
      severity: rt.rule.severity,
      state: event.state,
      valueAtTrigger: event.valueAtTrigger,
      activatedAt: event.activatedAt.toISOString(),
      normalizedAt: event.normalizedAt?.toISOString() ?? null,
      acknowledgedAt: event.acknowledgedAt?.toISOString() ?? null,
      acknowledgedBy: event.acknowledgedBy,
      acknowledgedByName,
    });
  }
}
