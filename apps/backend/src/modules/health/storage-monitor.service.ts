import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** Cadência normal de verificação (uso baixo). */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** Cadência acelerada quando o uso já está na zona quente (perto da trava). */
const HOT_INTERVAL_MS = 30 * 1000;
/** A partir desta fração da quota, verifica com cadência acelerada. */
const HOT_FRACTION = 0.8;
/** Fração da quota a partir da qual a INGESTÃO de telemetria é pausada. */
const DEFAULT_BLOCK_FRACTION = 0.97;
/** Quota do banco de PRODUÇÃO do Replit (100 GB no plano atual). */
const DEFAULT_PROD_QUOTA_BYTES = 100_000_000_000;
/** Quota do banco de HOMOLOGAÇÃO/desenvolvimento do Replit (20 GB no plano atual). */
const DEFAULT_DEV_QUOTA_BYTES = 20_000_000_000;
/** Bandas de alerta (fração da quota). Avisa ao CRUZAR cada uma, para cima. */
const THRESHOLDS = [0.7, 0.8, 0.9, 0.95];

export type StorageEnvironment = 'production' | 'homologacao';

function gb(bytes: number): string {
  return (bytes / 1e9).toFixed(1);
}

/**
 * Monitor de uso de storage do banco.
 *
 * O storage do banco gerenciado do Replit NÃO autoescala (só o compute escala);
 * ao bater a quota a escrita é bloqueada e a ingestão para. Este serviço mede o
 * tamanho do banco periodicamente e emite um WARN ao cruzar 70/80/90/95% da
 * quota, dando margem para ajustar retenção ou migrar antes do estouro.
 *
 * Só registra log quando SOBE para uma banda nova (evita spam); se o uso cair
 * (após a retenção rodar), a banda baixa e um novo cruzamento volta a avisar.
 *
 * Detecta o ambiente automaticamente (NODE_ENV): em produção usa a quota de
 * 100 GB, em homologação/dev usa 20 GB — então ao migrar para produção já aplica
 * o limite certo sem reconfiguração. Um override explícito ainda tem prioridade.
 *
 * Configurável por env:
 *   DB_STORAGE_QUOTA_BYTES  — força a quota em bytes (vence a detecção automática).
 */
@Injectable()
export class StorageMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageMonitorService.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private lastBand = -1;
  /** Trava de ingestão: true quando o uso cruza DEFAULT_BLOCK_FRACTION. */
  private ingestionBlocked = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // Primeira medição logo após o boot (curta espera p/ o banco ficar pronto);
    // check() se reagenda sozinho com cadência adaptativa ao uso.
    this.timer = setTimeout(() => void this.check(), 5 * 1000);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Ambiente atual, derivado de NODE_ENV (mesmo sinal usado no resto do backend). */
  private environment(): StorageEnvironment {
    return process.env.NODE_ENV === 'production' ? 'production' : 'homologacao';
  }

  private quotaBytes(): number {
    // Override explícito vence a detecção automática.
    const v = Number(process.env.DB_STORAGE_QUOTA_BYTES);
    if (Number.isFinite(v) && v > 0) return v;
    return this.environment() === 'production'
      ? DEFAULT_PROD_QUOTA_BYTES
      : DEFAULT_DEV_QUOTA_BYTES;
  }

  /** Fração da quota que dispara a trava de ingestão (override por env). */
  private blockFraction(): number {
    const v = Number(process.env.DB_STORAGE_BLOCK_FRACTION);
    if (Number.isFinite(v) && v > 0 && v <= 1) return v;
    return DEFAULT_BLOCK_FRACTION;
  }

  /**
   * A gravação de telemetria deve ser pausada? Lido de forma síncrona pelo
   * gravador de trends a cada ciclo (valor em cache, atualizado em check()).
   */
  isIngestionBlocked(): boolean {
    return this.ingestionBlocked;
  }

  /** Aplica a decisão de bloqueio e loga apenas na transição de estado. */
  private setBlocked(shouldBlock: boolean, pct: number, used?: number, quota?: number): void {
    if (shouldBlock === this.ingestionBlocked) return;
    this.ingestionBlocked = shouldBlock;
    const where = used != null && quota != null ? ` (${gb(used)} / ${gb(quota)} GB)` : '';
    if (shouldBlock) {
      this.logger.error(
        `Storage em ${(pct * 100).toFixed(1)}%${where} — ` +
          `INGESTÃO DE TELEMETRIA PAUSADA para proteger o banco. ` +
          `Reduza a retenção/expurgue dados; a gravação retoma sozinha ao liberar espaço.`,
      );
    } else {
      this.logger.warn(
        `Storage em ${(pct * 100).toFixed(1)}% — abaixo do limite de proteção; ` +
          `ingestão de telemetria RETOMADA.`,
      );
    }
  }

  /** Tamanho atual do banco em bytes (proxy via pg_database_size). */
  async currentUsageBytes(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ size: bigint }[]>`
      SELECT pg_database_size(current_database()) AS size`;
    return Number(rows[0]?.size ?? 0);
  }

  /**
   * Maiores tabelas por tamanho total (dados + índices + TOAST). Faz rollup dos
   * chunks do TimescaleDB no hypertable lógico (trend_records), então o tamanho
   * reflete o que a operação reconhece, não os chunks internos. Cai num cálculo
   * só-Postgres se a extensão TimescaleDB não estiver disponível.
   */
  async getTableBreakdown(limit = 12): Promise<{ name: string; bytes: number }[]> {
    try {
      const rows = await this.prisma.$queryRaw<{ name: string; bytes: bigint }[]>`
        WITH hyper AS (
          SELECT hypertable_name AS name,
                 hypertable_size(format('%I.%I', hypertable_schema, hypertable_name)::regclass) AS bytes
          FROM timescaledb_information.hypertables
        ),
        regular AS (
          SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
            AND c.relname NOT IN (SELECT name FROM hyper)
        )
        SELECT name, bytes FROM hyper
        UNION ALL SELECT name, bytes FROM regular
        ORDER BY bytes DESC
        LIMIT ${limit}`;
      return rows.map((r) => ({ name: r.name, bytes: Number(r.bytes) }));
    } catch {
      const rows = await this.prisma.$queryRaw<{ name: string; bytes: bigint }[]>`
        SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        ORDER BY bytes DESC
        LIMIT ${limit}`;
      return rows.map((r) => ({ name: r.name, bytes: Number(r.bytes) }));
    }
  }

  /** Status de storage para dashboards (uso, quota e percentual já calculado). */
  async getStorageStatus(): Promise<{
    usedBytes: number;
    quotaBytes: number;
    percent: number;
    environment: StorageEnvironment;
    ingestionBlocked: boolean;
    blockPercent: number;
  }> {
    const usedBytes = await this.currentUsageBytes();
    const quotaBytes = this.quotaBytes();
    const percent = quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0;
    // Deriva o bloqueio da MESMA medição (não do cache) p/ não exibir estados
    // contraditórios; também atualiza o flag — cada poll do painel é um refresh.
    const frac = quotaBytes > 0 ? usedBytes / quotaBytes : 0;
    this.setBlocked(frac >= this.blockFraction(), frac, usedBytes, quotaBytes);
    return {
      usedBytes,
      quotaBytes,
      percent,
      environment: this.environment(),
      ingestionBlocked: this.ingestionBlocked,
      blockPercent: this.blockFraction() * 100,
    };
  }

  async check(): Promise<void> {
    let pct = 0;
    try {
      const used = await this.currentUsageBytes();
      const quota = this.quotaBytes();
      pct = quota > 0 ? used / quota : 0;
      // Banda = índice do MAIOR threshold já atingido (-1 = abaixo de todos).
      const band = THRESHOLDS.reduce((acc, t, i) => (pct >= t ? i : acc), -1);
      if (band > this.lastBand && band >= 0) {
        this.logger.warn(
          `Storage de produção em ${(pct * 100).toFixed(1)}% da quota ` +
            `(${gb(used)} / ${gb(quota)} GB) — cruzou ${(THRESHOLDS[band] * 100).toFixed(0)}%. ` +
            `Reduza a retenção ou planeje a migração do banco.`,
        );
      }
      this.lastBand = band;

      // Trava de ingestão: pausa a gravação de telemetria antes de bater a quota
      // dura do Replit (que bloquearia TODAS as escritas — login, config, etc.).
      this.setBlocked(pct >= this.blockFraction(), pct, used, quota);
    } catch (err) {
      this.logger.error(`Falha ao medir storage: ${(err as Error).message}`);
    } finally {
      // Reagenda com cadência adaptativa: acelerada na zona quente (perto da
      // trava), normal quando o uso está baixo. Bound da defasagem onde importa.
      if (!this.stopped) {
        const next = pct >= HOT_FRACTION ? HOT_INTERVAL_MS : CHECK_INTERVAL_MS;
        this.timer = setTimeout(() => void this.check(), next);
      }
    }
  }
}
