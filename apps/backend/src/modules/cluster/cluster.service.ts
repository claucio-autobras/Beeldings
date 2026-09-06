import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { hostname } from 'node:os';

/** Callback de mudança de liderança (true = virou líder, false = deixou de ser). */
type LeaderListener = (isLeader: boolean) => void;
/** Callback de notificação recebida num canal do barramento. */
type NotifyListener = (payload: string) => void;

/**
 * Chave do advisory lock que representa o papel de "ingestor" do cluster.
 * Apenas a instância que detém este lock (a líder) roda a ingestão MQTT
 * stateful (gravação de trends, avaliação de alarmes, timers, republish de
 * config no boot). Número fixo, < 2^53 (seguro em JS).
 */
const LEADER_LOCK_KEY = 8076990001;

/** Prefixo dos canais NOTIFY para isolar o namespace da aplicação. */
const CHANNEL_PREFIX = 'bluebee_';

/** Período de tentativa de aquisição do lock e de reconexão. */
const POLL_INTERVAL_MS = 5_000;

/**
 * ClusterService — coordenação entre múltiplas instâncias do backend usando
 * apenas o Postgres (sem Redis nem broker adicional).
 *
 * Mecanismos:
 *  1. Eleição de líder via `pg_try_advisory_lock` numa conexão DEDICADA. O lock
 *     de sessão é liberado automaticamente pelo Postgres se a conexão cair
 *     (crash da líder) → outra instância assume no próximo poll (auto-failover).
 *  2. Barramento de eventos via LISTEN/NOTIFY na mesma conexão dedicada — usado
 *     para fan-out de eventos de alarme (gerados só na líder) a TODAS as
 *     instâncias e para sinalizar recarga de configuração entre instâncias.
 *
 * Importante: telemetria e resultados de comando NÃO trafegam por aqui — cada
 * instância assina o MQTT diretamente, então o realtime de alta frequência não
 * passa pelo Postgres. O barramento carrega só eventos de baixa frequência.
 */
@Injectable()
export class ClusterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClusterService.name);
  private client: Client | null = null;
  private leader = false;
  private destroyed = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private readonly leaderListeners: LeaderListener[] = [];
  private readonly channelListeners = new Map<string, NotifyListener[]>();
  private readonly channels = new Set<string>();

  /**
   * Identificador estável desta instância, exposto em GET /cluster/status para
   * tornar a liderança observável sem ler o Postgres nem raspar o stdout.
   * Configurável via INSTANCE_ID; senão derivado de hostname + PID (estável
   * durante a vida do processo e único entre instâncias no mesmo host).
   */
  private readonly instanceId: string;

  constructor(private readonly config: ConfigService) {
    this.instanceId =
      this.config.get<string>('INSTANCE_ID') ?? `${hostname()}-${process.pid}`;
  }

  /** Identificador estável desta instância (para health/observabilidade). */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Estado de liderança legível por HTTP (read-only, seguro para expor a
   * dashboards e load balancers). Reflete a promoção/demissão no próximo poll.
   */
  getStatus(): { isLeader: boolean; instanceId: string } {
    return { isLeader: this.leader, instanceId: this.instanceId };
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.client) {
      try {
        await this.client.end();
      } catch {
        /* encerrando — ignora */
      }
    }
  }

  /** Esta instância é, neste momento, a líder (a ingestora stateful)? */
  isLeader(): boolean {
    return this.leader;
  }

  /**
   * Registra um callback de liderança. Se a instância JÁ for líder no momento
   * do registro, o callback é disparado imediatamente com `true` — isso evita
   * perder a transição inicial por causa da ordem de boot dos módulos.
   */
  onLeadership(cb: LeaderListener): void {
    this.leaderListeners.push(cb);
    if (this.leader) {
      try {
        cb(true);
      } catch (err) {
        this.logger.error(`Erro em listener de liderança: ${(err as Error).message}`);
      }
    }
  }

  /** Assina um canal do barramento. Funciona registrado antes ou depois do connect. */
  on(channel: string, cb: NotifyListener): void {
    const full = CHANNEL_PREFIX + channel;
    const arr = this.channelListeners.get(full) ?? [];
    arr.push(cb);
    this.channelListeners.set(full, arr);
    if (!this.channels.has(full)) {
      this.channels.add(full);
      if (this.client) {
        // Nome de canal vem de constante interna (não de input) — interpolação segura.
        this.client.query(`LISTEN ${full}`).catch((err: Error) =>
          this.logger.warn(`Falha ao LISTEN ${full}: ${err.message}`),
        );
      }
    }
  }

  /** Publica um evento no barramento (entregue a todas as instâncias, inclusive a própria). */
  async publish(channel: string, payload: string): Promise<void> {
    const full = CHANNEL_PREFIX + channel;
    if (!this.client) {
      this.logger.warn(`Barramento indisponível — evento "${full}" não publicado`);
      return;
    }
    try {
      await this.client.query('SELECT pg_notify($1, $2)', [full, payload]);
    } catch (err) {
      this.logger.warn(`Falha ao publicar em ${full}: ${(err as Error).message}`);
    }
  }

  // ── Conexão dedicada + eleição ────────────────────────────────────────────

  private async connect(): Promise<void> {
    if (this.destroyed) return;
    const connectionString = this.config.get<string>('DATABASE_URL');
    if (!connectionString) {
      this.logger.error('DATABASE_URL ausente — coordenação de cluster desabilitada');
      return;
    }

    const client = new Client({ connectionString });
    client.on('error', (err: Error) => {
      this.logger.warn(`Erro na conexão de cluster: ${err.message}`);
      this.handleDisconnect();
    });
    client.on('end', () => this.handleDisconnect());
    client.on('notification', (msg) => this.dispatch(msg.channel, msg.payload ?? ''));

    try {
      await client.connect();
    } catch (err) {
      this.logger.warn(
        `Conexão de cluster falhou (${(err as Error).message}); nova tentativa em ${POLL_INTERVAL_MS}ms`,
      );
      this.scheduleReconnect();
      return;
    }

    this.client = client;
    for (const ch of this.channels) {
      try {
        await client.query(`LISTEN ${ch}`);
      } catch (err) {
        this.logger.warn(`Falha ao LISTEN ${ch}: ${(err as Error).message}`);
      }
    }
    this.logger.log('Coordenação de cluster conectada (advisory lock + LISTEN/NOTIFY)');

    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => void this.tryAcquireLeadership(), POLL_INTERVAL_MS);
    }
    void this.tryAcquireLeadership();
  }

  /** Tenta adquirir o lock de líder. Uma vez líder, não tenta de novo (lock de sessão é mantido). */
  private async tryAcquireLeadership(): Promise<void> {
    if (this.destroyed || this.leader || !this.client) return;
    try {
      const res = await this.client.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS ok',
        [LEADER_LOCK_KEY],
      );
      if (res.rows[0]?.ok === true) this.becomeLeader();
    } catch (err) {
      this.logger.warn(`Falha ao tentar liderança: ${(err as Error).message}`);
    }
  }

  private becomeLeader(): void {
    if (this.leader) return;
    this.leader = true;
    this.logger.log('Esta instância é a LÍDER — assumindo ingestão MQTT e motores stateful');
    this.emitLeadership(true);
  }

  private loseLeadership(): void {
    if (!this.leader) return;
    this.leader = false;
    this.logger.warn('Esta instância deixou de ser líder — pausando ingestão stateful');
    this.emitLeadership(false);
  }

  private emitLeadership(isLeader: boolean): void {
    for (const cb of this.leaderListeners) {
      try {
        cb(isLeader);
      } catch (err) {
        this.logger.error(`Erro em listener de liderança: ${(err as Error).message}`);
      }
    }
  }

  private dispatch(channel: string, payload: string): void {
    const cbs = this.channelListeners.get(channel);
    if (!cbs) return;
    for (const cb of cbs) {
      try {
        cb(payload);
      } catch (err) {
        this.logger.error(`Erro em listener do canal ${channel}: ${(err as Error).message}`);
      }
    }
  }

  private handleDisconnect(): void {
    if (this.destroyed || !this.client) return;
    // Perder a conexão libera o advisory lock no servidor → deixamos de ser líder.
    this.loseLeadership();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    const old = this.client;
    this.client = null;
    try {
      old.removeAllListeners();
      void old.end().catch(() => undefined);
    } catch {
      /* ignora */
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, POLL_INTERVAL_MS);
  }
}
