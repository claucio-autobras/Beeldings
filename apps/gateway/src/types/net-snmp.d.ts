/**
 * Tipos mínimos para a lib `net-snmp` (não publica tipos próprios).
 * Cobre apenas a superfície usada pelo gateway: sessão v1/v2c + GET.
 */
declare module 'net-snmp' {
  export const Version1: number;
  export const Version2c: number;
  export const Version3: number;

  /** Níveis de segurança USM (SNMPv3). */
  export const SecurityLevel: {
    readonly noAuthNoPriv: number;
    readonly authNoPriv: number;
    readonly authPriv: number;
  };

  /** Protocolos de autenticação USM (md5, sha, sha224, sha256, sha384, sha512). */
  export const AuthProtocols: { readonly [key: string]: unknown };

  /** Protocolos de privacidade USM (des, aes, aes256b, aes256r). */
  export const PrivProtocols: { readonly [key: string]: unknown };

  /** Usuário USM para createV3Session. */
  export interface V3User {
    name: string;
    level: number;
    authProtocol?: unknown;
    authKey?: string;
    privProtocol?: unknown;
    privKey?: string;
  }

  /**
   * Subconjunto de ObjectType usado pelo gateway para classificar varbinds de
   * contador. Valores ASN.1 conforme RFC 1902 / net-snmp ObjectType enum.
   */
  export const ObjectType: {
    readonly Counter: 65;   // Counter32 (0x41)
    readonly Counter64: 70; // Counter64 (0x46)
    readonly [key: string]: number;
  };

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
    /** contextName SNMPv3 (createV3Session). */
    context?: string;
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

  export function createV3Session(
    target: string,
    user: V3User,
    options?: SessionOptions,
  ): Session;

  export function isVarbindError(varbind: VarBind): boolean;
}
