import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

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
 * Intervalo mínimo entre escritas duráveis por dispositivo. Heartbeats chegam
 * a cada ~15–90s; a cópia durável só existe para sobreviver a restart/cluster,
 * então uma escrita por minuto é suficiente e não pesa na ingestão.
 */
const PERSIST_MIN_INTERVAL_MS = 60_000;

/**
 * DeviceHeartbeatService
 *
 * Guarda o diagnóstico do ÚLTIMO heartbeat de cada dispositivo MQTT:
 * memória (rápido, por instância) + cópia durável em devices.last_heartbeat
 * (sobrevive a restart e vale em qualquer instância do cluster).
 * Aditivo: não afeta presença (DeviceStatusService continua sendo a fonte
 * de online/offline).
 */
@Injectable()
export class DeviceHeartbeatService {
  private readonly logger = new Logger(DeviceHeartbeatService.name);
  private readonly last = new Map<string, DeviceHeartbeatDiag>();
  /** Última escrita durável por device (coalescência: no máx. 1/min). */
  private readonly lastPersistAt = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  /** Aplica o payload do heartbeat recebido (qualquer shape; extrai o que der). */
  apply(deviceId: string, payload: unknown, timeoutSeconds: number | null): void {
    if (!deviceId) return;
    const flat = this.flatten(payload);
    const diag: DeviceHeartbeatDiag = {
      receivedAt: new Date().toISOString(),
      timeoutSeconds,
      rssi: this.pickNumber(flat, RSSI_KEYS),
      ip: this.pickIp(flat),
      uptimeSeconds: this.pickNumber(flat, UPTIME_KEYS),
    };
    const prev = this.last.get(deviceId);
    this.last.set(deviceId, diag);

    // Cópia durável coalescida: grava logo no primeiro heartbeat ou quando os
    // valores mudaram; senão, no máximo a cada PERSIST_MIN_INTERVAL_MS.
    const now = Date.now();
    const lastAt = this.lastPersistAt.get(deviceId) ?? 0;
    const changed =
      !prev || prev.rssi !== diag.rssi || prev.ip !== diag.ip;
    if (!changed && now - lastAt < PERSIST_MIN_INTERVAL_MS) return;
    this.lastPersistAt.set(deviceId, now);
    void this.prisma.device
      .update({
        where: { id: deviceId },
        data: { lastHeartbeat: diag as unknown as Prisma.InputJsonValue },
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `Falha ao persistir heartbeat do device ${deviceId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  /**
   * Último diagnóstico conhecido de um dispositivo, ou null.
   * Fallback durável: sem valor em memória (restart/outra instância), lê a
   * cópia persistida em devices.last_heartbeat.
   */
  async get(deviceId: string): Promise<DeviceHeartbeatDiag | null> {
    const mem = this.last.get(deviceId);
    if (mem) return mem;
    const row = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { lastHeartbeat: true },
    });
    return this.parseStored(row?.lastHeartbeat ?? null);
  }

  /** Valida o JSON persistido (defensivo: nunca retorna shape inválido). */
  private parseStored(raw: unknown): DeviceHeartbeatDiag | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.receivedAt !== 'string' || !o.receivedAt) return null;
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    return {
      receivedAt: o.receivedAt,
      timeoutSeconds: num(o.timeoutSeconds),
      rssi: num(o.rssi),
      ip: typeof o.ip === 'string' && o.ip ? o.ip : null,
      uptimeSeconds: num(o.uptimeSeconds),
    };
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
