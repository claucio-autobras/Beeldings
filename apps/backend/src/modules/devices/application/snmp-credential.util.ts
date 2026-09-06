import { BadRequestException } from '@nestjs/common';
import {
  decryptCameraSecret,
  encryptCameraSecret,
} from './camera-credentials.util.js';
import type { DiagnoseSnmpV3 } from './snmp-diagnose.service.js';

/**
 * Credenciais SNMP (fase 2 da descoberta): fonte da verdade na tabela
 * snmp_credential, com retrocompatibilidade com Device.config
 * (snmpVersion/community) enquanto ambas as fontes coexistirem.
 *
 * Chaves SNMPv3 (authKey/privKey) são cifradas em repouso (AES-256-GCM,
 * mesmo padrão das senhas ONVIF) e NUNCA retornadas pela API — as respostas
 * expõem apenas hasAuthKey/hasPrivKey.
 */

export const SNMP_VERSIONS = ['1', '2c', '3'] as const;
export type SnmpVersion = (typeof SNMP_VERSIONS)[number];

const AUTH_PROTOCOLS = ['md5', 'sha', 'sha256', 'sha512'] as const;
const PRIV_PROTOCOLS = ['des', 'aes', 'aes256'] as const;

/** Corpo aceito nos formulários de cadastro/edição (campos v3 opcionais). */
export interface SnmpCredentialBody {
  snmpVersion?: string;
  community?: string;
  securityName?: string;
  authProtocol?: string;
  authKey?: string;
  privProtocol?: string;
  privKey?: string;
  contextName?: string;
}

/** Campos v3 validados e normalizados, prontos para persistir. */
export interface SanitizedSnmpV3 {
  securityName: string;
  securityLevel: 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';
  authProtocol: string | null;
  /** Chave em texto puro (cifrar antes de persistir); null = não alterar. */
  authKey: string | null;
  privProtocol: string | null;
  privKey: string | null;
  contextName: string | null;
}

/**
 * Valida os campos SNMPv3 do corpo. `allowEmptyKeys` (edição): chave vazia
 * significa "manter a atual" — na criação, authPriv/authNoPriv exigem chave.
 */
export function sanitizeSnmpV3Body(
  body: SnmpCredentialBody,
  options: { allowEmptyKeys?: boolean } = {},
): SanitizedSnmpV3 {
  const securityName = String(body.securityName ?? '').trim();
  if (!securityName) {
    throw new BadRequestException('SNMPv3 requer o campo securityName');
  }
  const authProtocol = String(body.authProtocol ?? '').trim().toLowerCase();
  const privProtocol = String(body.privProtocol ?? '').trim().toLowerCase();
  const authKey = String(body.authKey ?? '');
  const privKey = String(body.privKey ?? '');

  if (authProtocol && !AUTH_PROTOCOLS.includes(authProtocol as never)) {
    throw new BadRequestException(
      `authProtocol inválido: use ${AUTH_PROTOCOLS.join(', ')}`,
    );
  }
  if (privProtocol && !PRIV_PROTOCOLS.includes(privProtocol as never)) {
    throw new BadRequestException(
      `privProtocol inválido: use ${PRIV_PROTOCOLS.join(', ')}`,
    );
  }
  if (privProtocol && !authProtocol) {
    throw new BadRequestException(
      'Privacidade (privProtocol) exige também autenticação (authProtocol)',
    );
  }
  if (!options.allowEmptyKeys) {
    if (authProtocol && !authKey) {
      throw new BadRequestException('authKey é obrigatória quando authProtocol é informado');
    }
    if (privProtocol && !privKey) {
      throw new BadRequestException('privKey é obrigatória quando privProtocol é informado');
    }
  }
  if (authKey && authKey.length < 8) {
    throw new BadRequestException('authKey deve ter pelo menos 8 caracteres');
  }
  if (privKey && privKey.length < 8) {
    throw new BadRequestException('privKey deve ter pelo menos 8 caracteres');
  }

  const securityLevel: SanitizedSnmpV3['securityLevel'] = privProtocol
    ? 'authPriv'
    : authProtocol
      ? 'authNoPriv'
      : 'noAuthNoPriv';

  return {
    securityName,
    securityLevel,
    authProtocol: authProtocol || null,
    authKey: authKey || null,
    privProtocol: privProtocol || null,
    privKey: privKey || null,
    contextName: String(body.contextName ?? '').trim() || null,
  };
}

/** Linha da tabela snmp_credential (shape mínimo usado pelos helpers). */
export interface SnmpCredentialRow {
  version: string;
  community: string | null;
  securityName: string | null;
  securityLevel: string | null;
  authProtocol: string | null;
  authKeyEnc: string | null;
  privProtocol: string | null;
  privKeyEnc: string | null;
  contextName: string | null;
}

/**
 * Dados de upsert da snmp_credential a partir do corpo validado.
 * `existing` (edição): chave vazia preserva a cifrada atual.
 */
export function buildSnmpCredentialData(
  version: SnmpVersion,
  body: SnmpCredentialBody,
  existing?: SnmpCredentialRow | null,
): Omit<SnmpCredentialRow, never> {
  if (version !== '3') {
    return {
      version,
      community: String(body.community ?? '').trim() || 'public',
      securityName: null,
      securityLevel: null,
      authProtocol: null,
      authKeyEnc: null,
      privProtocol: null,
      privKeyEnc: null,
      contextName: null,
    };
  }
  const v3 = sanitizeSnmpV3Body(body, { allowEmptyKeys: Boolean(existing) });
  const authKeyEnc = v3.authKey
    ? encryptCameraSecret(v3.authKey)
    : v3.authProtocol
      ? (existing?.authKeyEnc ?? null)
      : null;
  const privKeyEnc = v3.privKey
    ? encryptCameraSecret(v3.privKey)
    : v3.privProtocol
      ? (existing?.privKeyEnc ?? null)
      : null;
  if (v3.authProtocol && !authKeyEnc) {
    throw new BadRequestException('authKey é obrigatória quando authProtocol é informado');
  }
  if (v3.privProtocol && !privKeyEnc) {
    throw new BadRequestException('privKey é obrigatória quando privProtocol é informado');
  }
  return {
    version: '3',
    community: null,
    securityName: v3.securityName,
    securityLevel: v3.securityLevel,
    authProtocol: v3.authProtocol,
    authKeyEnc,
    privProtocol: v3.privProtocol,
    privKeyEnc,
    contextName: v3.contextName,
  };
}

/**
 * Visão pública da credencial (respostas da API): NUNCA inclui chaves —
 * apenas flags hasAuthKey/hasPrivKey.
 */
export function snmpCredentialPublicView(row: SnmpCredentialRow | null | undefined): {
  version: string;
  community: string | null;
  securityName: string | null;
  securityLevel: string | null;
  authProtocol: string | null;
  privProtocol: string | null;
  contextName: string | null;
  hasAuthKey: boolean;
  hasPrivKey: boolean;
} | null {
  if (!row) return null;
  return {
    version: row.version,
    community: row.version === '3' ? null : (row.community ?? null),
    securityName: row.securityName,
    securityLevel: row.securityLevel,
    authProtocol: row.authProtocol,
    privProtocol: row.privProtocol,
    contextName: row.contextName,
    hasAuthKey: Boolean(row.authKeyEnc),
    hasPrivKey: Boolean(row.privKeyEnc),
  };
}

/** Credenciais em runtime (decifradas) — só para publicar ao gateway. */
export interface ResolvedSnmpCredentials {
  snmpVersion: SnmpVersion;
  community: string;
  v3: DiagnoseSnmpV3 | null;
}

/**
 * Resolve as credenciais efetivas de um device SNMP: tabela snmp_credential
 * quando existe; senão, retrocompat com Device.config (snmpVersion/community).
 * As chaves v3 saem DECIFRADAS — usar exclusivamente em payloads MQTT ao
 * gateway, nunca em respostas HTTP.
 */
export function resolveSnmpRuntimeCredentials(
  credential: SnmpCredentialRow | null | undefined,
  config: { snmpVersion?: string; community?: string } | null | undefined,
): ResolvedSnmpCredentials {
  if (credential) {
    if (credential.version === '3' && credential.securityName) {
      return {
        snmpVersion: '3',
        community: '',
        v3: {
          securityName: credential.securityName,
          securityLevel:
            (credential.securityLevel as DiagnoseSnmpV3['securityLevel']) ?? undefined,
          authProtocol: credential.authProtocol ?? undefined,
          authKey: decryptCameraSecret(credential.authKeyEnc) ?? undefined,
          privProtocol: credential.privProtocol ?? undefined,
          privKey: decryptCameraSecret(credential.privKeyEnc) ?? undefined,
          contextName: credential.contextName ?? undefined,
        },
      };
    }
    return {
      snmpVersion: credential.version === '1' ? '1' : '2c',
      community: credential.community || 'public',
      v3: null,
    };
  }
  const version = config?.snmpVersion === '1' ? '1' : '2c';
  return { snmpVersion: version, community: config?.community || 'public', v3: null };
}
