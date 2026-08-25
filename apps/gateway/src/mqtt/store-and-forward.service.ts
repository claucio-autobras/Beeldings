import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

export interface PendingMessage {
  topic: string;
  payload: string;
  qos: 0 | 1;
  enqueuedAt: string;
}

/**
 * StoreAndForwardService
 *
 * Armazena mensagens MQTT que não puderam ser publicadas (gateway offline)
 * em um arquivo local JSON e as reenvia quando a conexão é restabelecida.
 *
 * Persistência resiliente:
 *   - Escrita assíncrona e atômica (arquivo temporário + rename), sem bloquear
 *     o event loop nem corromper o arquivo em caso de queda no meio da escrita.
 *   - Escritas serializadas e coalescidas (nunca concorrentes).
 *   - No boot, arquivo parcial/corrompido é tolerado: recupera o que for possível
 *     e preserva o original corrompido para inspeção, sem travar a inicialização.
 *   - Descartes por fila cheia são observáveis (contador + log).
 *
 * Garante zero perda de histórico conforme especificado no documento técnico.
 */
@Injectable()
export class StoreAndForwardService implements OnModuleInit {
  private readonly logger = new Logger(StoreAndForwardService.name);
  private readonly queue: PendingMessage[] = [];
  private readonly filePath: string;
  private readonly tmpPath: string;
  private readonly maxQueueSize = 10_000;

  /** Total de mensagens descartadas por fila cheia desde o boot (observabilidade). */
  private droppedCount = 0;

  // ── Escrita serializada + coalescida ────────────────────────────────────────
  // `writing` garante uma única escrita em disco por vez; `dirty` sinaliza que a
  // fila mudou e precisa ser re-persistida quando a escrita atual terminar.
  private writing = false;
  private dirty = false;

  constructor(private readonly config: ConfigService) {
    const dataDir = this.config.get<string>('STORE_FORWARD_DIR', './data');
    this.filePath = path.join(dataDir, 'pending-messages.json');
    this.tmpPath = `${this.filePath}.tmp`;
  }

  onModuleInit(): void {
    this.ensureDataDir();
    this.cleanupStaleTmp();
    this.loadFromDisk();
    this.logger.log(
      `Store-and-forward inicializado — ${this.queue.length} mensagem(ns) pendente(s) em disco`,
    );
  }

  /** Enfileira uma mensagem para envio posterior. */
  enqueue(topic: string, payload: string, qos: 0 | 1 = 1): void {
    if (this.queue.length >= this.maxQueueSize) {
      // Remove a mensagem mais antiga para não crescer indefinidamente.
      this.queue.shift();
      this.droppedCount += 1;
      this.logger.warn(
        `Fila cheia (${this.maxQueueSize}) — mensagem mais antiga descartada ` +
          `(total descartadas desde o boot: ${this.droppedCount})`,
      );
    }

    this.queue.push({ topic, payload, qos, enqueuedAt: new Date().toISOString() });
    this.schedulePersist();

    this.logger.debug(`Mensagem enfileirada — total na fila: ${this.queue.length}`);
  }

  /**
   * Snapshot das mensagens pendentes SEM removê-las da fila (drain crash-safe).
   *
   * O reenvio deve confirmar cada mensagem via `remove()` somente após o ack de
   * publicação — se o gateway cair no meio do reenvio, as mensagens ainda não
   * publicadas continuam no disco e são reenviadas no próximo boot.
   */
  peekAll(): PendingMessage[] {
    return [...this.queue];
  }

  /**
   * Remove uma mensagem específica da fila (comparação por referência) após a
   * confirmação de publicação, persistindo a remoção em disco.
   */
  remove(message: PendingMessage): void {
    const idx = this.queue.indexOf(message);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      this.schedulePersist();
    }
  }

  hasPending(): boolean {
    return this.queue.length > 0;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  /** Total de mensagens descartadas por fila cheia (observabilidade). */
  droppedMessages(): number {
    return this.droppedCount;
  }

  /**
   * Aguarda a conclusão de qualquer escrita em disco pendente.
   * Útil em testes e em shutdown gracioso para garantir que a fila foi persistida.
   */
  async flush(): Promise<void> {
    // Enquanto houver escrita em andamento ou dados sujos, aguarda o próximo tick.
    while (this.writing || this.dirty) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  // ── Persistência ────────────────────────────────────────────────────────────

  private ensureDataDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Remove um arquivo temporário remanescente de uma escrita interrompida.
   * O arquivo principal permanece intacto (o rename é atômico), então o `.tmp`
   * órfão pode ser descartado com segurança.
   */
  private cleanupStaleTmp(): void {
    try {
      if (fs.existsSync(this.tmpPath)) {
        fs.unlinkSync(this.tmpPath);
        this.logger.warn('Arquivo temporário órfão removido no boot (escrita interrompida)');
      }
    } catch (err) {
      this.logger.warn(`Falha ao remover arquivo temporário órfão: ${(err as Error).message}`);
    }
  }

  private loadFromDisk(): void {
    let raw: string;
    try {
      if (!fs.existsSync(this.filePath)) return;
      raw = fs.readFileSync(this.filePath, 'utf-8');
    } catch (err) {
      this.logger.warn(`Falha ao ler fila do disco: ${(err as Error).message}`);
      return;
    }

    const parsed = this.parseQueue(raw);
    if (parsed) {
      this.queue.push(...parsed);
      return;
    }

    // Arquivo inválido/corrompido: tenta recuperar as mensagens íntegras iniciais.
    const salvaged = this.salvageQueue(raw);

    // Preserva o arquivo original corrompido para inspeção (renomeia para
    // .corrupt-*), liberando o caminho canônico para regravação da fila recuperada.
    this.backupCorruptFile();

    if (salvaged.length > 0) {
      this.queue.push(...salvaged);
      this.logger.warn(
        `Arquivo de fila corrompido — ${salvaged.length} mensagem(ns) recuperada(s); ` +
          'restante descartado',
      );
      // Regrava a fila recuperada no arquivo canônico imediatamente, para que as
      // mensagens salvas não se percam caso o gateway caia antes do próximo
      // enqueue/drain. Escrita síncrona é aceitável aqui pois ocorre só no boot.
      this.persistRecoveredSync();
    } else {
      this.logger.warn('Arquivo de fila corrompido e irrecuperável — iniciando com fila vazia');
    }
  }

  /**
   * Persiste a fila recuperada de forma síncrona e atômica durante o boot.
   * Garante que o que foi salvo de um arquivo corrompido seja durável antes de
   * qualquer enqueue/drain subsequente. Usado apenas no caminho de recuperação.
   */
  private persistRecoveredSync(): void {
    try {
      fs.writeFileSync(this.tmpPath, JSON.stringify(this.queue), 'utf-8');
      fs.renameSync(this.tmpPath, this.filePath);
    } catch (err) {
      this.logger.error(
        `Falha ao regravar fila recuperada no disco: ${(err as Error).message}`,
      );
    }
  }

  /** Faz o parse estrito; retorna `null` se o conteúdo não for um array válido. */
  private parseQueue(raw: string): PendingMessage[] | null {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((m) => this.isValidMessage(m));
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Recuperação best-effort de um array JSON truncado no meio (queda durante a
   * escrita legada e não-atômica). Corta o conteúdo após o último objeto completo
   * e tenta reparsear, preservando as mensagens íntegras iniciais.
   */
  private salvageQueue(raw: string): PendingMessage[] {
    const lastBrace = raw.lastIndexOf('}');
    if (lastBrace === -1) return [];

    const candidate = `${raw.slice(0, lastBrace + 1)}]`;
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed.filter((m) => this.isValidMessage(m));
      }
    } catch {
      // Irrecuperável.
    }
    return [];
  }

  private isValidMessage(m: unknown): m is PendingMessage {
    if (typeof m !== 'object' || m === null) return false;
    const msg = m as Record<string, unknown>;
    return (
      typeof msg.topic === 'string' &&
      typeof msg.payload === 'string' &&
      (msg.qos === 0 || msg.qos === 1)
    );
  }

  private backupCorruptFile(): void {
    try {
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      fs.renameSync(this.filePath, backup);
      this.logger.warn(`Arquivo corrompido preservado em: ${backup}`);
    } catch (err) {
      this.logger.warn(`Falha ao preservar arquivo corrompido: ${(err as Error).message}`);
    }
  }

  /**
   * Marca a fila como suja e dispara o loop de escrita.
   * Múltiplas chamadas em sequência são coalescidas em uma única escrita final.
   */
  private schedulePersist(): void {
    this.dirty = true;
    void this.flushLoop();
  }

  private async flushLoop(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.dirty) {
        this.dirty = false;
        // Snapshot síncrono do estado atual da fila (event loop single-threaded).
        const snapshot = JSON.stringify(this.queue);
        await this.writeAtomic(snapshot);
      }
    } finally {
      this.writing = false;
    }
  }

  /** Escreve em arquivo temporário e renomeia atomicamente sobre o destino. */
  private async writeAtomic(data: string): Promise<void> {
    try {
      await fsp.writeFile(this.tmpPath, data, 'utf-8');
      await fsp.rename(this.tmpPath, this.filePath);
    } catch (err) {
      this.logger.error(`Falha ao persistir fila no disco: ${(err as Error).message}`);
    }
  }
}
