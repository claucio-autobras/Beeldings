import { Injectable } from '@nestjs/common';

/**
 * Contador de taxa por janela deslizante de 60s, com buckets de 1 segundo.
 * Limitado a ~60 entradas (podado a cada acesso) — barato e sem crescimento.
 */
class RollingRate {
  private readonly buckets = new Map<number, number>();

  add(n = 1): void {
    const sec = Math.floor(Date.now() / 1000);
    this.buckets.set(sec, (this.buckets.get(sec) ?? 0) + n);
    this.prune(sec);
  }

  /** Total ocorrido nos últimos 60 segundos (equivalente a "por minuto"). */
  perMinute(): number {
    const now = Math.floor(Date.now() / 1000);
    this.prune(now);
    let sum = 0;
    for (const v of this.buckets.values()) sum += v;
    return sum;
  }

  private prune(now: number): void {
    for (const k of this.buckets.keys()) {
      if (k <= now - 60) this.buckets.delete(k);
    }
  }
}

/** Snapshot legível por HTTP das métricas de ingestão MQTT do backend. */
export interface IngestionMetricsSnapshot {
  /** Total de mensagens de telemetria consumidas desde o boot. */
  telemetryMessages: number;
  /** Total de pontos de telemetria consumidos desde o boot. */
  telemetryPoints: number;
  /** Total de resultados de comando recebidos desde o boot. */
  commandResults: number;
  /** Total de mensagens de status (LWT/heartbeat) recebidas desde o boot. */
  statusMessages: number;
  /** Total de payloads que falharam no parse desde o boot. */
  parseErrors: number;
  /** Mensagens de telemetria nos últimos 60s (taxa de ingestão). */
  telemetryMessagesPerMinute: number;
  /** Pontos de telemetria nos últimos 60s (taxa de ingestão). */
  telemetryPointsPerMinute: number;
  /** Instante da última telemetria consumida (ISO), ou null. */
  lastTelemetryAt: string | null;
  /** Instante em que a coleta de métricas começou (ISO). */
  startedAt: string;
}

/**
 * IngestionMetricsService — acumula contadores da ingestão MQTT do backend
 * (telemetria, pontos, resultados de comando, status e erros de parse) para
 * exposição num endpoint de observabilidade. É puramente observacional: não
 * altera o comportamento da ingestão.
 */
@Injectable()
export class IngestionMetricsService {
  private telemetryMessages = 0;
  private telemetryPoints = 0;
  private commandResults = 0;
  private statusMessages = 0;
  private parseErrors = 0;
  private lastTelemetryAt: string | null = null;
  private readonly startedAt = new Date().toISOString();

  private readonly messagesRate = new RollingRate();
  private readonly pointsRate = new RollingRate();

  recordTelemetry(pointCount: number): void {
    this.telemetryMessages += 1;
    this.telemetryPoints += pointCount;
    this.lastTelemetryAt = new Date().toISOString();
    this.messagesRate.add(1);
    this.pointsRate.add(pointCount);
  }

  recordCommandResult(): void {
    this.commandResults += 1;
  }

  recordStatus(): void {
    this.statusMessages += 1;
  }

  recordParseError(): void {
    this.parseErrors += 1;
  }

  getSnapshot(): IngestionMetricsSnapshot {
    return {
      telemetryMessages: this.telemetryMessages,
      telemetryPoints: this.telemetryPoints,
      commandResults: this.commandResults,
      statusMessages: this.statusMessages,
      parseErrors: this.parseErrors,
      telemetryMessagesPerMinute: this.messagesRate.perMinute(),
      telemetryPointsPerMinute: this.pointsRate.perMinute(),
      lastTelemetryAt: this.lastTelemetryAt,
      startedAt: this.startedAt,
    };
  }
}
