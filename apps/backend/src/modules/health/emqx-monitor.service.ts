import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClusterService } from '../cluster/cluster.service.js';
import {
  AUTOMATION_NOTICE_CHANNEL,
  SYSTEM_TENANT_ID,
} from '../mqtt/telemetry.gateway.js';
import type { AlarmEventPayload } from '../mqtt/telemetry.gateway.js';

/** Snapshot da saúde do broker EMQX exposto ao painel de admin global. */
export interface EmqxBrokerSnapshot {
  /** EMQX configurado (EMQX_API_URL presente)? */
  configured: boolean;
  /** A API do EMQX respondeu na última coleta? */
  available: boolean;
  /** Instante da última coleta (ISO), ou null. */
  checkedAt: string | null;
  /** Conexões atuais (sessões) e conexões vivas. */
  connections: number | null;
  liveConnections: number | null;
  /** Tópicos e assinaturas no broker. */
  topics: number | null;
  subscriptions: number | null;
  /** Taxas do broker (mensagens/s recebidas e enviadas). */
  messageInRate: number | null;
  messageOutRate: number | null;
  /**
   * Contadores acumulados de descarte RELEVANTE (exclui `no_subscribers`,
   * que é benigno — publicação sem assinante é normal em MQTT).
   */
  droppedTotal: number | null;
  /** Descartes benignos por falta de assinante (informativo). */
  droppedNoSubscribersTotal: number | null;
  /** Descartes por fila cheia (uso de fila estourando). */
  queueFullDroppedTotal: number | null;
  /** Descartes observados na última janela de coleta (delta). */
  droppedDelta: number | null;
  /** Estado avaliado: 'healthy' | 'abnormal' | 'unknown'. */
  health: 'healthy' | 'abnormal' | 'unknown';
  /** Mensagem do último erro de coleta, ou null. */
  error: string | null;
}

/** Período de coleta/avaliação de alertas (líder). */
const POLL_INTERVAL_MS = 30_000;
/** Cache do snapshot para o endpoint HTTP (qualquer instância). */
const SNAPSHOT_TTL_MS = 10_000;
/** Nº de coletas consecutivas anormais para disparar o alerta (histerese). */
const ABNORMAL_TRIGGER_COUNT = 2;
/** Nº de coletas consecutivas saudáveis para rearmar o alerta. */
const HEALTHY_RESET_COUNT = 10;
/** Intervalo mínimo entre avisos (anti-spam), mesmo rearmado. */
const ALERT_COOLDOWN_MS = 30 * 60_000;
/** Nº de falhas consecutivas de coleta para alertar broker inacessível. */
const UNREACHABLE_TRIGGER_COUNT = 3;

/**
 * EmqxMonitorService — observabilidade do broker EMQX.
 *
 * 1. Snapshot sob demanda (com cache curto) da API REST do EMQX para o painel
 *    de admin global (GET /health/broker) — funciona em QUALQUER instância.
 * 2. Na instância LÍDER, um poll periódico avalia sinais anormais (mensagens
 *    descartadas, fila cheia, broker inacessível) e avisa os admins globais
 *    pelo sino (alarm_events kind=AUTOMATION_NOTICE, tenant sentinela
 *    __system__), com histerese + cooldown para não gerar spam.
 */
@Injectable()
export class EmqxMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmqxMonitorService.name);
  private readonly apiUrl: string | undefined;
  private readonly authHeader: string;

  private timer: NodeJS.Timeout | null = null;
  private leader = false;

  private cached: EmqxBrokerSnapshot | null = null;
  private cachedAt = 0;

  // ── Estado do alerta (histerese) ───────────────────────────────────────────
  private lastDroppedTotal: number | null = null;
  private lastQueueFullTotal: number | null = null;
  private abnormalStreak = 0;
  private healthyStreak = 0;
  private unreachableStreak = 0;
  private alerted = false;
  // -Infinity: o cooldown nunca deve bloquear o PRIMEIRO alerta.
  private lastAlertAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly cluster: ClusterService,
  ) {
    this.apiUrl = config.get<string>('EMQX_API_URL');
    const key = config.get<string>('EMQX_API_KEY', '');
    const secret = config.get<string>('EMQX_API_SECRET', '');
    this.authHeader = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
  }

  onModuleInit(): void {
    if (!this.apiUrl) {
      this.logger.log('EMQX_API_URL não configurado — monitor do broker desativado');
      return;
    }
    // Alertas só no líder (uma avaliação por cluster). O snapshot HTTP funciona
    // em qualquer instância, sob demanda.
    this.cluster.onLeadership((isLeader) => {
      this.leader = isLeader;
      if (isLeader && !this.timer) {
        this.timer = setInterval(() => void this.pollAndEvaluate(), POLL_INTERVAL_MS);
        void this.pollAndEvaluate();
      } else if (!isLeader && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Snapshot para o endpoint HTTP (cache curto por instância). */
  async getSnapshot(): Promise<EmqxBrokerSnapshot> {
    if (!this.apiUrl) {
      return this.emptySnapshot(false, null);
    }
    if (this.cached && Date.now() - this.cachedAt < SNAPSHOT_TTL_MS) {
      return this.cached;
    }
    const snap = await this.collect();
    this.cached = snap;
    this.cachedAt = Date.now();
    return snap;
  }

  // ── Coleta ─────────────────────────────────────────────────────────────────

  /** Coleta métricas via API REST do EMQX. Nunca lança. */
  private async collect(): Promise<EmqxBrokerSnapshot> {
    try {
      const [monitor, metrics] = await Promise.all([
        this.fetchJson('/monitor_current'),
        this.fetchJson('/metrics?aggregate=true'),
      ]);

      const m = this.firstObject(metrics);
      const mon = this.firstObject(monitor);

      // `messages.dropped` inclui `no_subscribers` (benigno: publicar sem
      // assinante é normal em MQTT e cresce continuamente). O sinal RELEVANTE
      // é o restante (ex.: await_pubrel_timeout) + descartes de entrega
      // (fila cheia, expirado, payload grande) — só isso alimenta o alerta.
      const messagesDropped = this.num(m['messages.dropped']);
      const noSubscribers = this.num(m['messages.dropped.no_subscribers']);
      const deliveryDropped = this.num(m['delivery.dropped']);
      const droppedTotal =
        messagesDropped != null
          ? Math.max(0, messagesDropped - (noSubscribers ?? 0)) + (deliveryDropped ?? 0)
          : null;
      const queueFullDroppedTotal = this.num(m['delivery.dropped.queue_full']);

      const snap: EmqxBrokerSnapshot = {
        configured: true,
        available: true,
        checkedAt: new Date().toISOString(),
        connections: this.num(mon['connections']),
        liveConnections: this.num(mon['live_connections']),
        topics: this.num(mon['topics']),
        subscriptions: this.num(mon['subscriptions']),
        messageInRate: this.num(mon['received_msg_rate']),
        messageOutRate: this.num(mon['sent_msg_rate']),
        droppedTotal,
        droppedNoSubscribersTotal: noSubscribers,
        queueFullDroppedTotal,
        droppedDelta: null,
        health: 'healthy',
        error: null,
      };
      return snap;
    } catch (err) {
      return this.emptySnapshot(true, (err as Error).message);
    }
  }

  private async fetchJson(path: string): Promise<unknown> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      headers: { Authorization: this.authHeader },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      throw new Error(`EMQX API ${path}: HTTP ${res.status}`);
    }
    return res.json();
  }

  /** A API pode devolver objeto único ou array por nó — normaliza p/ objeto. */
  private firstObject(body: unknown): Record<string, unknown> {
    if (Array.isArray(body)) {
      return (body[0] ?? {}) as Record<string, unknown>;
    }
    return (body ?? {}) as Record<string, unknown>;
  }

  private num(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  private emptySnapshot(configured: boolean, error: string | null): EmqxBrokerSnapshot {
    return {
      configured,
      available: false,
      checkedAt: configured ? new Date().toISOString() : null,
      connections: null,
      liveConnections: null,
      topics: null,
      subscriptions: null,
      messageInRate: null,
      messageOutRate: null,
      droppedTotal: null,
      droppedNoSubscribersTotal: null,
      queueFullDroppedTotal: null,
      droppedDelta: null,
      health: 'unknown',
      error,
    };
  }

  // ── Avaliação de alertas (só no líder) ─────────────────────────────────────

  private async pollAndEvaluate(): Promise<void> {
    if (!this.leader) return;
    const snap = await this.collect();
    this.cached = this.evaluate(snap, Date.now());
    this.cachedAt = Date.now();
  }

  /**
   * Avalia o snapshot, mantém a histerese e dispara avisos quando necessário.
   * Retorna o snapshot com o campo `health`/`droppedDelta` preenchidos.
   * Exposto como método para permitir teste unitário determinístico.
   */
  evaluate(snap: EmqxBrokerSnapshot, now: number): EmqxBrokerSnapshot {
    // Broker inacessível?
    if (!snap.available) {
      this.unreachableStreak += 1;
      this.abnormalStreak = 0;
      this.healthyStreak = 0;
      if (this.unreachableStreak === UNREACHABLE_TRIGGER_COUNT && this.canAlert(now)) {
        this.fireAlert(
          'Broker MQTT inacessível',
          `A API do EMQX não responde há ${Math.round((UNREACHABLE_TRIGGER_COUNT * POLL_INTERVAL_MS) / 1000)}s. Gateways podem estar sem comunicação.`,
          now,
        );
      }
      return { ...snap, health: 'unknown' };
    }
    this.unreachableStreak = 0;

    // Deltas de descarte desde a última coleta.
    const droppedDelta =
      snap.droppedTotal != null && this.lastDroppedTotal != null
        ? Math.max(0, snap.droppedTotal - this.lastDroppedTotal)
        : null;
    const queueDelta =
      snap.queueFullDroppedTotal != null && this.lastQueueFullTotal != null
        ? Math.max(0, snap.queueFullDroppedTotal - this.lastQueueFullTotal)
        : null;
    this.lastDroppedTotal = snap.droppedTotal;
    this.lastQueueFullTotal = snap.queueFullDroppedTotal;

    const abnormal = (droppedDelta ?? 0) > 0 || (queueDelta ?? 0) > 0;

    if (abnormal) {
      this.abnormalStreak += 1;
      this.healthyStreak = 0;
      if (this.abnormalStreak >= ABNORMAL_TRIGGER_COUNT && !this.alerted && this.canAlert(now)) {
        const parts: string[] = [];
        if ((droppedDelta ?? 0) > 0) parts.push(`${droppedDelta} mensagem(ns) descartada(s)`);
        if ((queueDelta ?? 0) > 0) parts.push(`${queueDelta} descarte(s) por fila cheia`);
        this.fireAlert(
          'Broker MQTT com sinal anormal',
          `O EMQX registrou ${parts.join(' e ')} na última janela de ${Math.round(POLL_INTERVAL_MS / 1000)}s. Verifique o painel de servidores.`,
          now,
        );
        this.alerted = true;
      }
    } else {
      this.healthyStreak += 1;
      this.abnormalStreak = 0;
      if (this.healthyStreak >= HEALTHY_RESET_COUNT) {
        this.alerted = false;
      }
    }

    return { ...snap, droppedDelta, health: abnormal ? 'abnormal' : 'healthy' };
  }

  private canAlert(now: number): boolean {
    return now - this.lastAlertAt >= ALERT_COOLDOWN_MS;
  }

  /**
   * Grava o aviso no sino dos admins globais (alarm_events, tenant sentinela
   * __system__) e emite em tempo real via barramento do cluster. Nunca lança.
   */
  private fireAlert(title: string, message: string, now: number): void {
    this.lastAlertAt = now;
    void (async () => {
      try {
        const event = await this.prisma.alarmEvent.create({
          data: {
            tenantId: SYSTEM_TENANT_ID,
            kind: 'AUTOMATION_NOTICE',
            state: 'ACTIVE',
            severity: 'MEDIUM',
            sourceName: title,
            sourceId: 'emqx-broker',
            message,
            activatedAt: new Date(now),
          },
        });
        const payload: AlarmEventPayload = {
          id: event.id,
          kind: 'AUTOMATION_NOTICE',
          tenantId: SYSTEM_TENANT_ID,
          sourceName: title,
          sourceId: 'emqx-broker',
          message,
          severity: 'MEDIUM',
          state: event.state,
          activatedAt: event.activatedAt.toISOString(),
        };
        await this.cluster.publish(AUTOMATION_NOTICE_CHANNEL, JSON.stringify(payload));
        this.logger.warn(`[EMQX ALERT] ${title}: ${message}`);
      } catch (err) {
        this.logger.error(`Falha ao registrar alerta do broker: ${(err as Error).message}`);
      }
    })();
  }
}
