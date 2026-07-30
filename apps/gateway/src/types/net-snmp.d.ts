/**
 * Tipos mínimos para a lib `net-snmp` (não publica tipos próprios).
 * Cobre apenas a superfície usada pelo gateway: sessão v1/v2c + GET.
 */
declare module 'net-snmp' {
  export const Version1: number;
  export const Version2c: number;

  export interface VarBind {
    oid: string;
    type: number;
    value: unknown;
  }

  export interface SessionOptions {
    port?: number;
    retries?: number;
    timeout?: number;
    version?: number;
  }

  export interface Session {
    get(
      oids: string[],
      callback: (error: Error | null, varbinds: VarBind[]) => void,
    ): void;
    close(): void;
    on(event: 'error', listener: (error: Error) => void): void;
  }

  export function createSession(
    target: string,
    community: string,
    options?: SessionOptions,
  ): Session;

  export function isVarbindError(varbind: VarBind): boolean;
}
