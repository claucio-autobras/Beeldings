import { useMemo } from 'react';
import { useBacnetTelemetry } from '@/hooks/useBacnetTelemetry';
import { useCameras } from '@/modules/cftv/hooks/useCameras';
import {
  cameraHealth,
  estimatedUptimeSeconds,
  formatPointLiveValue,
  formatUptime,
  liveOrSeed,
  type CameraHealth,
} from '@/modules/cftv/utils/telemetry-format';

/** Leituras rápidas de uma câmera exibidas no card do dashboard. */
export interface CftvCameraEntry {
  id: string;
  name: string;
  /** Nome do site — exibido quando o escopo tem mais de um site. */
  site: string;
  health: CameraHealth;
  /** Latência formatada ("12 ms") — null quando sem dado/não confiável. */
  latency: string | null;
  /** Uptime formatado ("3d 4h") — real ou estimado; null quando sem dado. */
  uptime: string | null;
  /** true quando o uptime exibido é a estimativa do backend. */
  uptimeEstimated: boolean;
  /** Uso de CPU formatado ("45%") — null quando sem dado/não confiável. */
  cpu: string | null;
  /** Uso de CPU em % (0–100) para mini-barras — null quando não é percentual. */
  cpuPct: number | null;
  /** Uso de memória formatado ("62%") — null quando sem dado/não confiável. */
  memory: string | null;
  /** Uso de memória em % (0–100) para mini-barras — null quando não é percentual. */
  memoryPct: number | null;
}

/** Contagem de câmeras do card "Dispositivos CFTV" do dashboard. */
export interface CftvKpi {
  total: number;
  online: number;
  /** Câmeras com STATUS reportando offline. */
  offline: number;
  /** Câmeras sem dados de saúde (nunca reportaram STATUS). */
  unknown: number;
  /** Câmeras do escopo com saúde individual — problemas primeiro. */
  cameras: CftvCameraEntry[];
  /** true quando o escopo cobre mais de um site (exibe o site por câmera). */
  multiSite: boolean;
}

const HEALTH_ORDER: Record<CameraHealth, number> = { offline: 0, unknown: 1, online: 2 };

/**
 * KPI de câmeras CFTV: usa o MESMO critério de online/offline da tela CFTV
 * (ponto STATUS via telemetria + último valor persistido), para os números
 * baterem entre o dashboard e a área CFTV. Retorna null quando o tenant não
 * tem nenhuma câmera — o card não é exibido.
 */
export function useCftvKpi(tenantId?: string, siteId?: string | null): CftvKpi | null {
  const { data: cameras = [] } = useCameras(tenantId);
  const { byDevice } = useBacnetTelemetry({ enabled: cameras.length > 0 });

  return useMemo(() => {
    // Tenant sem NENHUMA câmera cadastrada → card oculto (retorna null).
    // Escopo (site) sem câmeras, mas tenant com câmeras → KPI vazio (total 0),
    // para o card exibir o estado vazio em vez de sumir.
    if (cameras.length === 0) return null;
    const scoped = siteId ? cameras.filter((c) => c.siteId === siteId) : cameras;
    if (scoped.length === 0) {
      return { total: 0, online: 0, offline: 0, unknown: 0, cameras: [], multiSite: false };
    }
    let online = 0;
    let offline = 0;
    let unknown = 0;
    const entries: CftvCameraEntry[] = [];
    for (const c of scoped) {
      const health = cameraHealth(c, byDevice);
      if (health === 'online') online += 1;
      else if (health === 'offline') offline += 1;
      else unknown += 1;

      // Latência: leitura ao vivo com fallback persistido; valor sentinela
      // ("não confiável") ou ausente vira null — nunca número inventado.
      let latency: string | null = null;
      const lat = liveOrSeed(c, 'LATENCIA', byDevice);
      if (lat && !lat.unreliable && lat.value !== null) {
        const point = c.points.find((p) => p.tag === 'LATENCIA');
        if (point) latency = formatPointLiveValue(point, lat.value);
      }

      // Uptime: dado real tem prioridade; sem real, usa estimativa do backend.
      let uptime: string | null = null;
      let uptimeEstimated = false;
      const up = liveOrSeed(c, 'UPTIME', byDevice);
      const upNum = up && !up.unreliable && up.value !== null ? Number(up.value) : NaN;
      if (Number.isFinite(upNum) && up?.state !== 'estimated') {
        uptime = formatUptime(upNum);
      } else {
        const est = estimatedUptimeSeconds(c.estimatedOnlineSince, health === 'online');
        if (est !== null) {
          uptime = formatUptime(est);
          uptimeEstimated = true;
        } else if (Number.isFinite(upNum)) {
          // Leitura persistida marcada como estimada pelo backend.
          uptime = formatUptime(upNum);
          uptimeEstimated = true;
        }
      }

      // CPU/memória: mesma regra da latência — leitura ao vivo com fallback
      // persistido; sem dado ou não confiável vira null (nunca 0 inventado).
      // O ponto costuma ser percentual ("%"): expomos também o número 0–100
      // para as mini-barras do card; unidades não percentuais ficam só texto.
      const readPct = (tag: string): { text: string | null; pct: number | null } => {
        if (health !== 'online') return { text: null, pct: null };
        const r = liveOrSeed(c, tag, byDevice);
        if (!r || r.unreliable || r.value === null) return { text: null, pct: null };
        const point = c.points.find((p) => p.tag === tag);
        if (!point) return { text: null, pct: null };
        const text = formatPointLiveValue(point, r.value);
        const n = Number(r.value);
        const isPct = (point.unit || '').trim() === '%';
        const pct = isPct && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
        return { text, pct };
      };
      const cpuRead = readPct('CPU');
      const memRead = readPct('MEMORIA');

      entries.push({
        id: c.id,
        name: c.name,
        site: c.site,
        health,
        latency,
        uptime,
        uptimeEstimated,
        cpu: cpuRead.text,
        cpuPct: cpuRead.pct,
        memory: memRead.text,
        memoryPct: memRead.pct,
      });
    }
    entries.sort(
      (a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || a.name.localeCompare(b.name),
    );
    const multiSite = new Set(scoped.map((c) => c.siteId ?? c.site)).size > 1;
    return { total: scoped.length, online, offline, unknown, cameras: entries, multiSite };
  }, [cameras, byDevice, siteId]);
}
