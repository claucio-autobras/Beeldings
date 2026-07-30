import { Injectable } from '@nestjs/common';

/**
 * Diagnóstico extraído do último heartbeat de um dispositivo MQTT.
 * Campos ausentes no payload ficam null — a UI mostra "sem dados".
 */
export interface DeviceHeartbeatDiag {
  /** Instante em que o backend recebeu este heartbeat (ISO). */
  receivedAt: string;
  /** Janela de presença configurada (s) — usada pela UI para staleness. */
  timeoutSeconds: number | null;
  /** Intensidade do sinal Wi-Fi (dBm), quando reportada. */
  rssi: number | null;
  /** Endereço IP local do equipamento, quando reportado. */
  ip: string | null;
  /** Uptime do equipamento em segundos, quando reportado. */
  uptimeSeconds: number | null;
}

/** Chaves comuns de firmware para cada campo de diagnóstico (case-insensitive). */
const RSSI_KEYS = ['rssi', 'wifi_rssi', 'wifirssi', 'signal', 'signal_strength'];
const IP_KEYS = ['ip', 'ip_address', 'ipaddress', 'local_ip', 'localip', 'ipaddr'];
const UPTIME_KEYS = ['uptime', 'uptime_s', 'uptime_sec', 'uptime_seconds', 'uptimeseconds'];

/**
 * DeviceHeartbeatService
 *
 * Guarda, EM MEMÓRIA, o diagnóstico do ÚLTIMO heartbeat de cada dispositivo
 * MQTT (mesmo padrão do GatewayHealthService). Aditivo: não afeta presença
 * (DeviceStatusService continua sendo a fonte de online/offline).
 */
@Injectable()
export class DeviceHeartbeatService {
  private readonly last = new Map<string, DeviceHeartbeatDiag>();

  /** Aplica o payload do heartbeat recebido (qualquer shape; extrai o que der). */
  apply(deviceId: string, payload: unknown, timeoutSeconds: number | null): void {
    if (!deviceId) return;
    const flat = this.flatten(payload);
    this.last.set(deviceId, {
      receivedAt: new Date().toISOString(),
      timeoutSeconds,
      rssi: this.pickNumber(flat, RSSI_KEYS),
      ip: this.pickIp(flat),
      uptimeSeconds: this.pickNumber(flat, UPTIME_KEYS),
    });
  }

  /** Último diagnóstico conhecido de um dispositivo, ou null. */
  get(deviceId: string): DeviceHeartbeatDiag | null {
    return this.last.get(deviceId) ?? null;
  }

  /** Achata o payload (até 2 níveis) em chaves lower-case → valor primitivo. */
  private flatten(payload: unknown, depth = 0): Map<string, unknown> {
    const out = new Map<string, unknown>();
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return out;
    }
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (typeof v === 'object' && v !== null && !Array.isArray(v) && depth < 2) {
        for (const [nk, nv] of this.flatten(v, depth + 1)) {
          if (!out.has(nk)) out.set(nk, nv);
        }
      } else if (!out.has(key)) {
        out.set(key, v);
      }
    }
    return out;
  }

  private pickNumber(flat: Map<string, unknown>, keys: string[]): number | null {
    for (const k of keys) {
      const v = flat.get(k);
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
        return Number(v);
      }
    }
    return null;
  }

  private pickIp(flat: Map<string, unknown>): string | null {
    for (const k of IP_KEYS) {
      const v = flat.get(k);
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 64);
    }
    return null;
  }
}
