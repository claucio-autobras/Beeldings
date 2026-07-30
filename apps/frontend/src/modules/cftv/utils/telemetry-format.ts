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

/**
 * Critério canônico de online/offline de câmera: o ponto STATUS via telemetria
 * (com fallback para o último valor persistido). A recência do device não
 * serve — o gateway publica STATUS=0 mesmo com a câmera offline. É o MESMO
 * critério da tela CFTV; o card do dashboard reutiliza para os números baterem.
 */
export function cameraHealth(camera: Camera, live: TelemetryMap): CameraHealth {
  if (!camera.points.some((p) => p.tag === 'STATUS')) return 'unknown';
  const entry = liveOrSeed(camera, 'STATUS', live);
  if (!entry || entry.value === null) return 'unknown';
  return Number(entry.value) >= 1 ? 'online' : 'offline';
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
