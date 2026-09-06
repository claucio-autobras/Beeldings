/**
 * Registro de perfis e motor de resolução.
 *
 * resolveProfile() funde camadas (base → vendor → override) num ResolvedProfile:
 *   • Perfil base: OIDs genéricos MIB-II/UCD/HOST-RESOURCES.
 *   • Perfil vendor: OIDs proprietários do fabricante (se identificado).
 *   • Override por device: mapeamentos que o operador definiu em Device.config.
 *
 * A identificação usa (em ordem de prioridade):
 *   1. profileId explícito em Device.config → seleciona o perfil por ID.
 *   2. manufacturer em Device.config (nome de fabricante manual) → substring match.
 *   3. sysDescr lido do equipamento → substring match.
 *   4. Enterprise number (do sysObjectId ou dos OIDs dos pontos).
 *   5. Caso ambíguo (enterprise 1004849 = Dahua/Intelbras sem label manual)
 *      → Intelbras (bestEffort conservador) por ser padrão no mercado BR.
 *   6. Nenhum match → perfil base.
 */

import { BASE_CAMERA_PROFILE } from './base/camera.profile';
import { BASE_ACCESS_CONTROLLER_PROFILE } from './base/access-controller.profile';
import { BASE_SWITCH_PROFILE } from './base/switch.profile';
import { BASE_NVR_PROFILE } from './base/nvr.profile';
import { HIKVISION_PROFILE } from './vendors/hikvision.profile';
import { DAHUA_PROFILE } from './vendors/dahua.profile';
import { INTELBRAS_PROFILE } from './vendors/intelbras.profile';
import { AXIS_PROFILE } from './vendors/axis.profile';
import { CONTROL_ID_PROFILE } from './vendors/control-id.profile';
import { INTELBRAS_AC_PROFILE } from './vendors/intelbras-ac.profile';
import { HIKVISION_NVR_PROFILE } from './vendors/hikvision-nvr.profile';
import { DAHUA_NVR_PROFILE } from './vendors/dahua-nvr.profile';
import { INTELBRAS_NVR_PROFILE } from './vendors/intelbras-nvr.profile';
import type {
  DeviceKind,
  DeviceProfile,
  MetricMapping,
  ResolvedProfile,
  ResolvedMapping,
} from './types';

/** Todos os perfis registrados. Adicionar aqui novos fabricantes/tipos. */
export const ALL_PROFILES: DeviceProfile[] = [
  // ── CAMERA vendor profiles ───────────────────────────────────────────────
  HIKVISION_PROFILE,
  DAHUA_PROFILE,
  INTELBRAS_PROFILE,
  AXIS_PROFILE,
  // ── ACCESS_CONTROLLER vendor profiles ────────────────────────────────────
  CONTROL_ID_PROFILE,
  INTELBRAS_AC_PROFILE,
  // ── NVR vendor profiles ──────────────────────────────────────────────────
  // INTELBRAS_NVR_PROFILE tem priority=11 para ganhar de DAHUA_NVR (priority=10)
  // quando o enterprise 1004849 é detectado sem fabricante manual (fallback
  // conservador — análogo ao comportamento da câmera Intelbras).
  HIKVISION_NVR_PROFILE,
  INTELBRAS_NVR_PROFILE,
  DAHUA_NVR_PROFILE,
  // ── Base profiles (priority=0, always-fallback) ──────────────────────────
  BASE_CAMERA_PROFILE,
  BASE_ACCESS_CONTROLLER_PROFILE,
  BASE_SWITCH_PROFILE,
  BASE_NVR_PROFILE,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extrai o número enterprise de um OID do formato `1.3.6.1.4.1.N…`.
 * Retorna null quando o OID não segue o formato ou é nulo/vazio.
 */
export function enterpriseNumberOf(oid: string | null | undefined): number | null {
  if (!oid) return null;
  const m = /^1\.3\.6\.1\.4\.1\.(\d+)/.exec(oid.trim());
  return m ? Number(m[1]) : null;
}

// ─── Motor de resolução ───────────────────────────────────────────────────────

export interface ResolveProfileInput {
  /** Tipo do dispositivo monitorado. Padrão: 'CAMERA'. */
  deviceType?: DeviceKind | string | null;
  /** Fabricante manual cadastrado em Device.config.manufacturer. */
  manufacturer?: string | null;
  /** sysDescr lido do equipamento via SNMP (1.3.6.1.2.1.1.1.0). */
  sysDescr?: string | null;
  /** sysObjectId lido do equipamento via SNMP (1.3.6.1.2.1.1.2.0). */
  sysObjectId?: string | null;
  /** OIDs dos pontos do device — usados para inferir enterprise number. */
  pointOids?: Array<string | null | undefined>;
  /** ID de perfil forçado via Device.config.profileId (sobrepõe auto-detect). */
  profileIdOverride?: string | null;
  /** Overrides de mapeamento por métrica definidos em Device.config.profileOverrides. */
  metricOverrides?: Record<string, MetricMapping> | null;
}

/**
 * Resolve o perfil efetivo para um device específico, fundindo camadas.
 *
 * O resultado é determinístico dado o mesmo input — pode ser chamado a cada
 * ciclo de coleta ou cacheado na instância do driver entre ciclos.
 */
export function resolveProfile(input: ResolveProfileInput): ResolvedProfile {
  const kind = (input.deviceType as DeviceKind | undefined | null) ?? 'CAMERA';

  // Perfis candidatos para este deviceType, mais prioritário primeiro.
  const candidates = ALL_PROFILES.filter((p) => p.deviceTypes.includes(kind)).sort(
    (a, b) => b.priority - a.priority,
  );

  const selectedVendor = selectVendorProfile(candidates, input, kind);

  // ── 2. Perfil base (fallback garantido) ────────────────────────────────────
  const baseProfile =
    candidates.find((p) => p.priority === 0) ?? BASE_CAMERA_PROFILE;

  // ── 3. Fusão de camadas: base → vendor → override ─────────────────────────
  const merged = new Map<string, ResolvedMapping>();

  // Camada base.
  for (const m of baseProfile.mappings) {
    merged.set(m.metricKey, { ...m, profileLayer: 'base', profileId: baseProfile.id });
  }

  // Camada vendor (sobrescreve base por metricKey).
  if (selectedVendor) {
    for (const m of selectedVendor.mappings) {
      merged.set(m.metricKey, { ...m, profileLayer: 'vendor', profileId: selectedVendor.id });
    }
  }

  // Camada override por device (máxima prioridade).
  if (input.metricOverrides) {
    for (const [key, m] of Object.entries(input.metricOverrides)) {
      merged.set(key, { ...m, metricKey: key, profileLayer: 'override', profileId: 'override' });
    }
  }

  const dominant = selectedVendor ?? baseProfile;
  return {
    id: dominant.id,
    label: dominant.label,
    bestEffort: dominant.bestEffort ?? false,
    mappings: merged,
  };
}

/**
 * Raízes de walk de DESCOBERTA declaradas pelos perfis aplicáveis ao device.
 *
 * Conhecimento aditivo dos perfis (spec de descoberta genérica): o motor de
 * walk permanece independente de fabricante — o perfil só informa quais
 * subárvores proprietárias valem a pena percorrer. Quando nenhum perfil
 * casa (ou o perfil não declara raízes), o chamador cai no fallback da
 * enterprise do sysObjectID.
 *
 * Sem deviceType conhecido (ex.: diagnóstico avulso), considera os perfis de
 * TODOS os tipos — o match por sysDescr/enterprise continua discriminante.
 */
export function resolveDiscoveryWalkRoots(input: ResolveProfileInput): string[] {
  const kind = (input.deviceType as DeviceKind | undefined | null) ?? null;
  const pool = kind
    ? ALL_PROFILES.filter((p) => p.deviceTypes.includes(kind))
    : ALL_PROFILES;
  const candidates = [...pool].sort((a, b) => b.priority - a.priority);
  const vendor = selectVendorProfile(candidates, input, kind ?? 'CAMERA');
  return vendor?.discovery?.walkRoots ?? [];
}

/**
 * Seleção do perfil vendor (compartilhada entre resolução de mapeamentos e
 * resolução de raízes de descoberta — um único ponto de matching).
 */
function selectVendorProfile(
  candidates: DeviceProfile[],
  input: ResolveProfileInput,
  kind: DeviceKind | string,
): DeviceProfile | null {
  let selectedVendor: DeviceProfile | null = null;

  // 1a. Perfil forçado por ID.
  if (input.profileIdOverride) {
    selectedVendor =
      candidates.find((p) => p.id === input.profileIdOverride) ?? null;
  }

  if (!selectedVendor) {
    const mfr = (input.manufacturer ?? '').toLowerCase();
    const sys = (input.sysDescr ?? '').toLowerCase();

    // 1b. Match por fabricante manual (substring).
    if (mfr) {
      for (const p of candidates) {
        if (!p.match || p.priority === 0) continue;
        if (p.match.manufacturerContains?.some((s) => mfr.includes(s))) {
          selectedVendor = p;
          break;
        }
      }
    }

    // 1c. Match por sysDescr (substring).
    if (!selectedVendor && sys) {
      for (const p of candidates) {
        if (!p.match || p.priority === 0) continue;
        if (p.match.sysDescrContains?.some((s) => sys.includes(s))) {
          selectedVendor = p;
          break;
        }
      }
    }

    // 1d. Match por enterprise number.
    if (!selectedVendor) {
      const enterprises = new Set<number>();
      const sysEnt = enterpriseNumberOf(input.sysObjectId);
      if (sysEnt !== null) enterprises.add(sysEnt);
      for (const oid of input.pointOids ?? []) {
        const n = enterpriseNumberOf(oid);
        if (n !== null) enterprises.add(n);
      }

      for (const n of enterprises) {
        // Enterprise 1004849 = Dahua/Intelbras: ambíguo sem cadastro manual.
        // Preferir Intelbras (bestEffort) para comportamento conservador.
        // O perfil escolhido depende do deviceType — câmera usa 'intelbras',
        // NVR usa 'intelbras-nvr' (mesma lógica, perfil correto por tipo).
        if (n === 1004849) {
          const fallbackId = kind === 'NVR' ? 'intelbras-nvr' : 'intelbras';
          selectedVendor = candidates.find((p) => p.id === fallbackId) ?? null;
          if (selectedVendor) break;
        }
        const match = candidates.find(
          (p) => p.match?.enterpriseNumbers?.includes(n) && p.priority > 0,
        );
        if (match) {
          selectedVendor = match;
          break;
        }
      }
    }
  }

  return selectedVendor;
}
