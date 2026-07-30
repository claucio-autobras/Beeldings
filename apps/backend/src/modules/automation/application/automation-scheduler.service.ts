import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ClusterService } from '../../cluster/cluster.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AutomationRunnerService } from './automation-runner.service.js';
import type { ScheduleTriggerConfig } from '../domain/automation.types.js';

const ONESHOT_TICK_MS = 30_000;
const CONTINUOUS_TICK_MS = 10_000;

/**
 * Agenda a execução das automações. Roda **apenas no líder** do cluster (mesmo
 * padrão do resto do projeto — sem BullMQ nem `@nestjs/schedule`).
 *
 * - Tick ONESHOT (30s): dispara início no `time` e término (reverso) no `endTime`.
 * - Tick CONTINUOUS (10s): reavalia cada automação cujo `evalSeconds` venceu.
 */
@Injectable()
export class AutomationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationSchedulerService.name);

  private oneshotTimer?: ReturnType<typeof setInterval>;
  private continuousTimer?: ReturnType<typeof setInterval>;

  /** Dedup de disparos ONESHOT no minuto atual (`id:idx:start|end`). */
  private firedThisMinute = new Set<string>();
  private currentMinuteKey = '';

  /** Última avaliação de cada automação CONTINUOUS (`id → epoch ms`). */
  private readonly lastEval = new Map<string, number>();

  constructor(
    private readonly cluster: ClusterService,
    private readonly prisma: PrismaService,
    private readonly runner: AutomationRunnerService,
  ) {}

  onModuleInit(): void {
    this.cluster.onLeadership((isLeader) => {
      if (isLeader) this.start();
      else this.stop();
    });
    if (this.cluster.isLeader()) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  private start(): void {
    if (this.oneshotTimer || this.continuousTimer) return;
    this.logger.log('Agendador de automações iniciado (líder)');
    this.oneshotTimer = setInterval(() => {
      void this.tickOneshot();
    }, ONESHOT_TICK_MS);
    this.continuousTimer = setInterval(() => {
      void this.tickContinuous();
    }, CONTINUOUS_TICK_MS);
  }

  private stop(): void {
    if (this.oneshotTimer) {
      clearInterval(this.oneshotTimer);
      this.oneshotTimer = undefined;
    }
    if (this.continuousTimer) {
      clearInterval(this.continuousTimer);
      this.continuousTimer = undefined;
    }
    this.firedThisMinute.clear();
    this.lastEval.clear();
  }

  // ─── ONESHOT ─────────────────────────────────────────────────────────────────

  private async tickOneshot(): Promise<void> {
    // Reseta a dedup quando o minuto UTC muda.
    const minuteKey = new Date().toISOString().slice(0, 16);
    if (minuteKey !== this.currentMinuteKey) {
      this.currentMinuteKey = minuteKey;
      this.firedThisMinute.clear();
    }

    const automations = await this.prisma.automation.findMany({
      where: { enabled: true, mode: 'ONESHOT' },
    });

    for (const auto of automations) {
      const trigger = auto.triggerConfig as unknown as ScheduleTriggerConfig | null;
      if (!trigger || !Array.isArray(trigger.entries)) continue;
      const tz = trigger.timezone || 'America/Sao_Paulo';
      const { hhmm, day } = this.nowInZone(tz);

      trigger.entries.forEach((entry, idx) => {
        if (!Array.isArray(entry.days) || entry.days.length === 0) return;

        // Início: dispara no `time`, nos dias selecionados.
        if (entry.time === hhmm && entry.days.includes(day)) {
          const key = `${auto.id}:${idx}:start`;
          if (!this.firedThisMinute.has(key)) {
            this.firedThisMinute.add(key);
            void this.runner.run(auto.id, 'agenda', false);
          }
        }

        // Término (reverso): dispara no `endTime`. Numa janela OVERNIGHT
        // (endTime < time, ex.: liga 18:00 / desliga 06:00) o término pertence
        // ao dia SEGUINTE ao início — só roda se o dia anterior foi um dia de
        // início. Numa janela do mesmo dia (endTime >= time), roda se hoje é
        // dia de início. Isso evita reverter num dia sem início prévio.
        if (entry.endTime && entry.endTime === hhmm) {
          const overnight = entry.endTime < entry.time;
          const startDay = overnight ? (day + 6) % 7 : day;
          if (entry.days.includes(startDay)) {
            const key = `${auto.id}:${idx}:end`;
            if (!this.firedThisMinute.has(key)) {
              this.firedThisMinute.add(key);
              void this.runner.run(auto.id, 'término', true);
            }
          }
        }
      });
    }
  }

  // ─── CONTINUOUS ──────────────────────────────────────────────────────────────

  private async tickContinuous(): Promise<void> {
    const now = Date.now();
    const automations = await this.prisma.automation.findMany({
      where: { enabled: true, mode: 'CONTINUOUS' },
    });

    for (const auto of automations) {
      const evalMs = Math.max(auto.evalSeconds, 5) * 1000;
      const last = this.lastEval.get(auto.id) ?? 0;
      if (now - last < evalMs) continue;
      this.lastEval.set(auto.id, now);
      void this.runner.run(auto.id, 'enquanto', false);
    }
  }

  // ─── Timezone helper ─────────────────────────────────────────────────────────

  /** Retorna hora "HH:mm" e dia da semana (0=domingo…6=sábado) no timezone dado. */
  private nowInZone(timezone: string): { hhmm: string; day: number } {
    const now = new Date();
    let fmt: Intl.DateTimeFormat;
    try {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        weekday: 'short',
      });
    } catch {
      // Timezone IANA inválido → cai para o horário local do processo em vez
      // de quebrar o tick inteiro.
      this.logger.warn(`Timezone inválido "${timezone}"; usando horário local`);
      fmt = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        weekday: 'short',
      });
    }
    const parts = fmt.formatToParts(now);
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const dayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return {
      hhmm: `${hour === '24' ? '00' : hour}:${minute}`,
      day: dayMap[weekday] ?? 0,
    };
  }
}
