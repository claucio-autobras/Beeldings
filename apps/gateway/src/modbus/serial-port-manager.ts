import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import ModbusRTU from 'modbus-serial';

/** Parâmetros da porta serial RS485 (Modbus RTU). */
export interface SerialSettings {
  /** Caminho da porta: COM3 (Windows) ou /dev/ttyUSB0 (Linux). */
  path: string;
  baudRate: number;
  parity: 'none' | 'even' | 'odd';
  dataBits: 7 | 8;
  stopBits: 1 | 2;
}

/** Timeout padrão de uma operação Modbus RTU (abrir + request + resposta). */
const DEFAULT_OP_TIMEOUT_MS = 5_000;

/** Estado de uma porta serial gerenciada. */
interface PortState {
  client: ModbusRTU;
  settings: SerialSettings;
  /** Cadeia de promessas que serializa TODAS as operações da porta. */
  queue: Promise<unknown>;
  /** Referências ativas (deviceIds em polling) — porta fecha quando esvazia. */
  refs: Set<string>;
}

/**
 * SerialPortManager
 *
 * RS485 é um barramento half-duplex compartilhado por vários escravos: NUNCA
 * pode haver duas conexões abertas para a mesma porta nem duas requisições em
 * voo ao mesmo tempo. Este serviço mantém UMA instância de cliente Modbus por
 * caminho de porta serial e serializa todas as operações (polling de todos os
 * Unit IDs, testes de conexão, escritas) numa fila única por porta, fazendo
 * `setID` imediatamente antes de cada operação.
 *
 * Uso:
 *   - `acquire(path, refKey)` / `release(path, refKey)` — refcount de devices
 *     em polling; a porta é fechada quando ninguém mais a usa.
 *   - `run(settings, unitId, op)` — enfileira uma operação; abre a porta sob
 *     demanda com os parâmetros informados.
 */
@Injectable()
export class SerialPortManager implements OnModuleDestroy {
  private readonly logger = new Logger(SerialPortManager.name);
  private readonly ports = new Map<string, PortState>();

  onModuleDestroy(): void {
    for (const path of [...this.ports.keys()]) {
      this.closePort(path);
    }
  }

  /** Registra um consumidor contínuo (device em polling) da porta. */
  acquire(path: string, refKey: string): void {
    const state = this.ports.get(this.key(path));
    if (state) {
      state.refs.add(refKey);
    } else {
      // Porta ainda não aberta — cria estado vazio só com a referência;
      // a abertura real acontece na primeira operação (settings do run()).
      this.pendingRefs.set(this.key(path), (this.pendingRefs.get(this.key(path)) ?? new Set()).add(refKey));
    }
  }

  /** Referências registradas antes da primeira operação abrir a porta. */
  private readonly pendingRefs = new Map<string, Set<string>>();

  /** Remove a referência; fecha a porta quando não sobra nenhum consumidor. */
  release(path: string, refKey: string): void {
    const k = this.key(path);
    this.pendingRefs.get(k)?.delete(refKey);
    const state = this.ports.get(k);
    if (!state) {
      return;
    }
    state.refs.delete(refKey);
    if (state.refs.size === 0) {
      // Fecha após a fila esvaziar — nunca no meio de uma operação.
      state.queue = state.queue.then(
        () => this.maybeClose(k),
        () => this.maybeClose(k),
      );
    }
  }

  /**
   * Enfileira uma operação Modbus na fila única da porta. Garante:
   *   1. porta aberta com os parâmetros corretos (abre sob demanda);
   *   2. `setID(unitId)` imediatamente antes da operação;
   *   3. timeout por operação (a fila nunca trava num escravo mudo);
   *   4. erro de um escravo não derruba as operações seguintes da fila.
   */
  run<T>(
    settings: SerialSettings,
    unitId: number,
    op: (client: ModbusRTU) => Promise<T>,
    timeoutMs: number = DEFAULT_OP_TIMEOUT_MS,
  ): Promise<T> {
    const k = this.key(settings.path);
    let state = this.ports.get(k);
    if (!state) {
      state = {
        client: new ModbusRTU(),
        settings,
        queue: Promise.resolve(),
        refs: this.pendingRefs.get(k) ?? new Set(),
      };
      this.pendingRefs.delete(k);
      this.ports.set(k, state);
    }

    if (!this.sameSettings(state.settings, settings) && state.client.isOpen) {
      return Promise.reject(
        new Error(
          `A porta serial ${settings.path} já está em uso com outros parâmetros ` +
            `(${state.settings.baudRate} bps). Use os mesmos parâmetros do barramento.`,
        ),
      );
    }

    const exec = async (): Promise<T> => {
      const s = this.ports.get(k);
      if (!s) {
        throw new Error(`Porta serial ${settings.path} foi fechada`);
      }
      await this.ensureOpen(s, settings);
      s.client.setID(unitId);
      try {
        return await this.withTimeout(op(s.client), timeoutMs, settings.path);
      } catch (err) {
        // Erros de porta (desconexão física do conversor USB) invalidam a
        // conexão — a próxima operação reabre. Timeouts de escravo não.
        if (this.isPortLevelError(err)) {
          this.forceClose(s);
        }
        throw err;
      }
    };

    // Encadeia na fila: a operação só roda quando a anterior terminar
    // (sucesso OU falha) — nunca duas requisições concorrentes no barramento.
    const result = state.queue.then(exec, exec);
    state.queue = result.catch(() => undefined);
    // Sem consumidores contínuos (ex.: teste de conexão avulso): fecha ao final.
    state.queue = state.queue.then(() => {
      if (state && state.refs.size === 0) {
        this.maybeClose(k);
      }
    });
    return result;
  }

  /** Abre a porta se necessário (connectRTUBuffered) com erros traduzidos. */
  private async ensureOpen(state: PortState, settings: SerialSettings): Promise<void> {
    if (state.client.isOpen) {
      return;
    }
    state.settings = settings;
    try {
      await this.withTimeout(
        state.client.connectRTUBuffered(settings.path, {
          baudRate: settings.baudRate,
          parity: settings.parity,
          dataBits: settings.dataBits,
          stopBits: settings.stopBits,
        }),
        DEFAULT_OP_TIMEOUT_MS,
        settings.path,
      );
      this.logger.log(
        `Porta serial ${settings.path} aberta — ${settings.baudRate} bps, ` +
          `${settings.dataBits}${settings.parity[0].toUpperCase()}${settings.stopBits}`,
      );
    } catch (err) {
      // Cliente pode ficar num estado zumbi após falha de open — recria.
      state.client = new ModbusRTU();
      throw new Error(this.describeOpenError(err, settings.path));
    }
  }

  /** Corrida com timeout — nenhuma operação pode travar a fila da porta. */
  private withTimeout<T>(promise: Promise<T>, ms: number, path: string): Promise<T> {
    let handle: ReturnType<typeof setTimeout>;
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        handle = setTimeout(
          () => reject(new Error(`timeout na porta serial ${path}`)),
          ms,
        );
      }),
    ]).finally(() => clearTimeout(handle));
  }

  /** Erros que indicam problema na PORTA (não no escravo). */
  private isPortLevelError(err: unknown): boolean {
    const msg = ((err as Error)?.message ?? '').toLowerCase();
    return (
      msg.includes('enoent') ||
      msg.includes('eacces') ||
      msg.includes('ebusy') ||
      msg.includes('port is not open') ||
      msg.includes('port not open') ||
      msg.includes('file not found') ||
      msg.includes('device disconnected') ||
      msg.includes('bad file descriptor')
    );
  }

  /** Traduz erros de abertura de porta para mensagens acionáveis. */
  private describeOpenError(err: unknown, path: string): string {
    const msg = (err as Error)?.message ?? String(err);
    const lower = msg.toLowerCase();
    if (lower.includes('enoent') || lower.includes('file not found') || lower.includes('no such file')) {
      return `Porta serial ${path} não encontrada — verifique se o conversor USB→RS485 está conectado e o nome da porta está correto.`;
    }
    if (lower.includes('eacces') || lower.includes('access denied') || lower.includes('eperm') || lower.includes('permission')) {
      return `Sem permissão para acessar a porta serial ${path} — no Linux, adicione o usuário ao grupo dialout; no Windows, verifique se outro programa não bloqueou a porta.`;
    }
    if (lower.includes('ebusy') || lower.includes('resource busy') || lower.includes('lock') || lower.includes('in use') || lower.includes('cannot open')) {
      return `A porta serial ${path} está em uso por outro processo — feche outros programas que usam a porta e tente novamente.`;
    }
    if (lower.includes('timeout')) {
      return `Tempo esgotado ao abrir a porta serial ${path}.`;
    }
    return `Falha ao abrir a porta serial ${path}: ${msg}`;
  }

  private maybeClose(key: string): void {
    const state = this.ports.get(key);
    if (state && state.refs.size === 0) {
      this.closePort(key);
    }
  }

  private closePort(key: string): void {
    const state = this.ports.get(key);
    if (!state) {
      return;
    }
    this.forceClose(state);
    this.ports.delete(key);
    this.logger.log(`Porta serial ${state.settings.path} fechada (sem consumidores)`);
  }

  private forceClose(state: PortState): void {
    try {
      if (state.client.isOpen) {
        state.client.close(() => undefined);
      }
    } catch {
      // fechar é best-effort
    }
  }

  /** Windows é case-insensitive (COM3 == com3). */
  private key(path: string): string {
    return path.trim().toLowerCase();
  }

  private sameSettings(a: SerialSettings, b: SerialSettings): boolean {
    return (
      a.baudRate === b.baudRate &&
      a.parity === b.parity &&
      a.dataBits === b.dataBits &&
      a.stopBits === b.stopBits
    );
  }
}
