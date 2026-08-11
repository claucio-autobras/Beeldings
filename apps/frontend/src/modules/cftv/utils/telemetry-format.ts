import { deviceTagKey, type TelemetryMap } from '@/hooks/useBacnetTelemetry';
import type { Camera, CameraPoint } from '../services/cftv.service';

/** Formata segundos como "3d 4h" / "2h 15m" / "45m". */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Tags digitais dos pontos de câmera (0/1). */
export const DIGITAL_TAGS = ['STATUS', 'STREAM', 'MOVIMENTO', 'TAMPER', 'PERDA_VIDEO'];

/** Ordem de exibição dos pontos de telemetria de câmera (demais vão ao final). */
export const TELEMETRY_TAG_ORDER = [
  'STATUS',
  'STREAM',
  'LATENCIA',
  'UPTIME',
  'MOVIMENTO',
  'ULTIMO_MOVIMENTO',
  'TAMPER',
  'PERDA_VIDEO',
  'CPU',
  'MEMORIA',
  'RAM_TOTAL',
  'ARMAZENAMENTO',
  'TEMPERATURA',
  'PACOTES_PERDIDOS',
  'PERDA_PING',
];

/**
 * Formata o valor ao vivo de um ponto de câmera para exibição amigável.
 * Retorna null quando não há leitura.
 */
export function formatPointLiveValue(
  point: Pick<CameraPoint, 'tag' | 'metric' | 'unit'>,
  value: number | string | boolean | null,
): string | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return typeof value === 'string' && value ? value : null;
  if (point.tag === 'STATUS') return n >= 1 ? 'Online' : 'Offline';
  if (point.tag === 'STREAM') return n >= 1 ? 'OK' : 'Falha';
  if (DIGITAL_TAGS.includes(point.tag)) return n >= 1 ? 'Ativo' : 'Normal';
  if (point.tag === 'UPTIME') return formatUptime(n);
  if (point.tag === 'LATENCIA') return `${Math.round(n)} ms`;
  if (point.tag === 'ULTIMO_MOVIMENTO') return `há ${formatUptime(n)}`;
  const v = point.metric === 'temperature' ? n.toFixed(1) : String(Math.round(n));
  const u = (point.unit || '').trim();
  if (!u) return v;
  return u === '%' || u.startsWith('°') ? `${v}${u}` : `${v} ${u}`;
}

/**
 * Leitura de um ponto: telemetria ao vivo (socket) com fallback para o último
 * valor persistido no backend — mostra o status imediatamente ao abrir a
 * página, antes do primeiro pacote de telemetria chegar.
 */
export function liveOrSeed(
  camera: Camera,
  tag: string,
  live: TelemetryMap,
): {
  value: number | string | null;
  timestamp: string | null;
  /** Estado da leitura: waiting_event/unsupported/error/estimated. */
  state?: string | null;
  /** Valor sentinela do firmware — "dado não confiável". */
  unreliable?: boolean;
} | undefined {
  const entry = live.get(deviceTagKey(camera.id, tag));
  if (entry) {
    return {
      value: entry.value,
      timestamp: entry.timestamp,
      state: entry.state ?? null,
      unreliable: entry.unreliable,
    };
  }
  const point = camera.points.find((p) => p.tag === tag);
  if (point && point.lastValueAt) {
    return {
      value: point.lastValue,
      timestamp: point.lastValueAt,
      state: point.lastValueState ?? null,
    };
  }
  return undefined;
}

/** Saúde da câmera derivada do ponto STATUS (não da recência do device). */
export type CameraHealth = 'online' | 'offline' | 'unknown';

/** Motivo opcional quando health = 'offline'. */
export type CameraOfflineReason = 'gateway_offline';

/** Resultado detalhado de saúde da câmera — inclui razão quando relevante. */
export interface CameraHealthInfo {
  health: CameraHealth;
  /**
   * Preenchido quando health='offline' e o motivo é o gateway fora do ar
   * (STATUS congelado em 1, dado velho, gateway=false). Usado pela UI para
   * exibir tooltip diferenciado "Gateway offline".
   */
  reason?: CameraOfflineReason;
}

/**
 * Limiar de "dado velho" para câmeras — espelha CAMERA_SILENCE_MS do backend
 * (apps/backend/src/modules/mqtt/availability-recorder.service.ts).
 * Alterando aqui, altere lá também.
 */
const CAMERA_STALE_MS = 5 * 60 * 1000; // 5 min

/**
 * Implementação canônica da regra de saúde de câmera.
 *
 * Aceita um callback `getReading` genérico para que o mesmo critério possa ser
 * reutilizado em contextos sem TelemetryMap (ex.: widget SCADA DeviceCounter).
 * O callback deve devolver a leitura ao vivo do ponto quando disponível; a
 * função cai no seed persistido em `camera.points` quando o live retorna null
 * — mesma prioridade de `liveOrSeed`.
 *
 * Regras (em ordem de prioridade):
 *  1. Sem ponto STATUS cadastrado → unknown.
 *  2. Sem dado (nunca recebeu STATUS) → unknown.
 *  3. STATUS = 0 → offline (sem reason: é o STATUS real da câmera).
 *  4. STATUS ≥ 1 E dado recente (<5min) → online (dado recente vence qualquer LWT;
 *     cobre o caso do gateway acabou de cair antes do próximo heartbeat).
 *  5. STATUS ≥ 1, dado velho, gatewayOnline=true → online (gateway confirma vida
 *     e pode publicar só na mudança; dado velho mas confiável).
 *  6. STATUS ≥ 1, dado velho, gatewayOnline=false → offline, reason='gateway_offline'
 *     (STATUS congelado — gateway offline impossibilita nova publicação).
 *  7. STATUS ≥ 1, dado velho, gatewayOnline=null → unknown ("Dados desatualizados";
 *     sem dado de gateway não inventamos offline).
 *
 * TODO(follow-up): receber gatewayOnline atualizado em tempo real via socket
 * 'gateway:status'; hoje vem do snapshot REST (refetch a cada 30s no useCameras).
 */
export function cameraHealthFromReader(
  camera: Camera,
  getReading: (deviceId: string, tag: string) => { value: number | boolean | string | null; timestamp: string | null } | null,
): CameraHealthInfo {
  if (!camera.points.some((p) => p.tag === 'STATUS')) return { health: 'unknown' };

  // Live first, then persisted seed (mirrors liveOrSeed priority).
  const liveEntry = getReading(camera.id, 'STATUS');
  const point = camera.points.find((p) => p.tag === 'STATUS');
  const seedTimestamp = point?.lastValueAt ?? null;
  const seedValue = seedTimestamp ? (point?.lastValue ?? null) : null;
  const entry = liveEntry ?? (seedTimestamp ? { value: seedValue, timestamp: seedTimestamp } : null);

  if (!entry || entry.value === null) return { health: 'unknown' };

  const statusValue = Number(entry.value);
  if (statusValue < 1) return { health: 'offline' };

  const age = entry.timestamp ? Date.now() - Date.parse(entry.timestamp) : Infinity;
  const dataRecent = age < CAMERA_STALE_MS;
  if (dataRecent) return { health: 'online' };

  const gwOnline = camera.gatewayOnline;
  if (gwOnline === true) return { health: 'online' };
  if (gwOnline === false) return { health: 'offline', reason: 'gateway_offline' };
  return { health: 'unknown' };
}

/**
 * Adaptador sobre `cameraHealthFromReader` para contextos com TelemetryMap
 * disponível (área CFTV). Constrói o reader a partir de `liveOrSeed`.
 *
 * TODO(follow-up): receber gatewayOnline atualizado em tempo real via socket
 * 'gateway:status'; hoje vem do snapshot REST (refetch a cada 30s no useCameras).
 */
export function cameraHealthInfo(camera: Camera, live: TelemetryMap): CameraHealthInfo {
  return cameraHealthFromReader(camera, (_deviceId, tag) => {
    const entry = liveOrSeed(camera, tag, live);
    if (!entry) return null;
    return { value: entry.value, timestamp: entry.timestamp };
  });
}

/**
 * Critério canônico de online/offline de câmera (wrapper simplificado).
 * Usa cameraHealthInfo() internamente — preferir cameraHealthInfo() quando
 * o motivo for necessário (ex.: badge/tooltip do CFTV).
 * É o MESMO critério da tela CFTV; o card do dashboard reutiliza para os
 * números baterem.
 */
export function cameraHealth(camera: Camera, live: TelemetryMap): CameraHealth {
  return cameraHealthInfo(camera, live).health;
}

/**
 * Tooltip do "tempo ligada estimado" — mesma explicação do card da área CFTV.
 */
export const ESTIMATED_UPTIME_HINT =
  'A câmera não expõe o uptime real — tempo estimado desde que voltou a responder ao monitoramento.';

/**
 * Segundos do "tempo online estimado": desde que o backend viu a câmera voltar
 * a responder (transição do ponto STATUS). Só vale quando a câmera está online
 * e não há uptime real — o dado real sempre tem prioridade sobre a estimativa.
 */
export function estimatedUptimeSeconds(
  estimatedOnlineSince: string | null | undefined,
  online: boolean,
): number | null {
  if (!estimatedOnlineSince || !online) return null;
  const since = new Date(estimatedOnlineSince).getTime();
  if (Number.isNaN(since)) return null;
  const s = Math.floor((Date.now() - since) / 1000);
  return s >= 0 ? s : null;
}

/**
 * Tooltip do estado `waiting_event`: assinatura de eventos ativa e nenhum
 * evento detectado até agora — estado saudável, exibido como "Normal" na UI
 * (a distinção técnica continua nos dados via state='waiting_event').
 */
export const WAITING_EVENT_HINT =
  'Monitoramento de eventos ativo — nenhum evento foi detectado até agora.';

/** Rótulos curtos dos estados de leitura (badges na UI). */
export const POINT_STATE_LABELS: Record<string, string> = {
  // "aguardando evento" é saudável (assinatura ativa, nada ocorreu) — exibe
  // como Normal para não parecer pendência; hover explica via WAITING_EVENT_HINT.
  waiting_event: 'Normal',
  unsupported: 'não suportado',
  error: 'erro na assinatura',
  estimated: 'estimado',
};

/** Formata um ISO timestamp como hora local curta ("14:32" ou "12/07 14:32"). */
export function formatReadTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return hm;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hm}`;
}
