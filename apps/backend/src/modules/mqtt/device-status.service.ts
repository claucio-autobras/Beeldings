import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export type DeviceLiveStatus = 'online' | 'offline';

/**
 * DeviceStatusService
 *
 * Mantém, em memória, o instante da última telemetria recebida por dispositivo
 * (via MQTT). O status é DERIVADO desse instante — nunca um valor fixo:
 *   - online   → telemetria recebida dentro do limiar (default 45s)
 *   - offline  → telemetria obsoleta (> limiar) OU nunca recebida
 *
 * Importante: o status persistido no banco (`device.status`) NÃO é usado como
 * fonte de liveness — ele desatualiza (é gravado na criação e não reflete a
 * realidade). Um dispositivo sem telemetria nesta sessão é considerado OFFLINE.
 */
@Injectable()
export class DeviceStatusService {
  private readonly lastSeen = new Map<string, number>();

  /**
   * Status EXPLÍCITO de liveness do gateway, vindo do tópico de status
   * (LWT/heartbeat) — não derivado de recência de telemetria. Diferente do
   * `lastSeen`, um LWT `offline` é um sinal ativo de queda do gateway, entregue
   * pelo próprio broker; o heartbeat `online` reafirma vida periodicamente.
   */
  private readonly gatewayStatus = new Map<
    string,
    { status: DeviceLiveStatus; at: number }
  >();

  /**
   * Cache do "visto por último" DURÁVEL (banco), usado só quando o mapa em
   * memória está vazio (pós-boot, antes de chegar telemetria). Guarda `null`
   * quando não há nenhum dado real — nunca inventamos data de cadastro.
   */
  private readonly durableLastSeen = new Map<string, number | null>();

  /**
   * Heartbeat de PRESENÇA de dispositivos MQTT (tópico de presença declarado no
   * cadastro): mantém o device online pela janela configurada mesmo sem mudança
   * de valor nos pontos (muitos firmwares publicam só na mudança). A janela é
   * por dispositivo (vem da config), independente do limiar de telemetria.
   */
  private readonly deviceHeartbeat = new Map<string, { at: number; windowMs: number }>();

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** Janela para considerar o dispositivo online (3× o polling padrão de 15s). */
  private readonly ONLINE_THRESHOLD_MS = 45_000;

  /** Janela do heartbeat do gateway (3× o intervalo de 15s). */
  private readonly HEARTBEAT_THRESHOLD_MS = 45_000;

  /** Registra que o dispositivo enviou telemetria agora. */
  markSeen(deviceId: string): void {
    if (deviceId) {
      this.lastSeen.set(deviceId, Date.now());
    }
  }

  /**
   * Aplica o status EXPLÍCITO de um gateway a partir do LWT/heartbeat.
   *   - 'online'  → heartbeat/prova de vida (também conta como "visto agora")
   *   - 'offline' → LWT ou shutdown limpo (queda ativa e confiável)
   */
  markGatewayStatus(gatewayId: string, status: DeviceLiveStatus): void {
    if (!gatewayId) return;
    this.gatewayStatus.set(gatewayId, { status, at: Date.now() });
    if (status === 'online') {
      this.lastSeen.set(gatewayId, Date.now());
    }
  }

  /**
   * Registra um heartbeat de presença de um dispositivo MQTT. Também conta
   * como "visto agora" (lastCommunication acompanha a presença real).
   */
  markDeviceHeartbeat(deviceId: string, windowMs?: number): void {
    if (!deviceId) return;
    const win = windowMs && windowMs > 0 ? windowMs : this.ONLINE_THRESHOLD_MS;
    this.deviceHeartbeat.set(deviceId, { at: Date.now(), windowMs: win });
    this.lastSeen.set(deviceId, Date.now());
  }

  /**
   * Status atual. Para gateways com sinal explícito (LWT/heartbeat) esse sinal
   * tem prioridade sobre a recência de telemetria:
   *   - offline explícito vence, exceto se chegou telemetria DEPOIS do offline
   *     (o gateway voltou e já publica dados antes do próximo heartbeat);
   *   - online explícito vale enquanto o heartbeat estiver recente.
   * Sem sinal explícito, cai no comportamento derivado da telemetria.
   */
  getStatus(deviceId: string): DeviceLiveStatus {
    const ts = this.lastSeen.get(deviceId);
    const explicit = this.gatewayStatus.get(deviceId);

    if (explicit) {
      if (explicit.status === 'offline') {
        const recoveredByTelemetry =
          ts !== undefined &&
          ts > explicit.at &&
          Date.now() - ts <= this.ONLINE_THRESHOLD_MS;
        return recoveredByTelemetry ? 'online' : 'offline';
      }
      if (Date.now() - explicit.at <= this.HEARTBEAT_THRESHOLD_MS) return 'online';
    }

    // Presença via heartbeat de dispositivo MQTT: online enquanto o último
    // heartbeat estiver dentro da JANELA CONFIGURADA do dispositivo (pode ser
    // maior que o limiar de telemetria — firmwares que publicam só na mudança).
    const hb = this.deviceHeartbeat.get(deviceId);
    if (hb && Date.now() - hb.at <= hb.windowMs) return 'online';

    if (ts === undefined) return 'offline';
    return Date.now() - ts <= this.ONLINE_THRESHOLD_MS ? 'online' : 'offline';
  }

  /** ISO da última telemetria/heartbeat recebido, ou null se nunca recebeu. */
  getLastSeen(deviceId: string): string | null {
    const ts = this.lastSeen.get(deviceId);
    return ts !== undefined ? new Date(ts).toISOString() : null;
  }

  /**
   * "Visto por último" com fallback DURÁVEL: memória primeiro; se vazia
   * (pós-boot), busca no banco a última transição em `status_events` e o
   * último `lastValueAt` dos pontos, usando o mais recente. Sem nenhum dado
   * real retorna `null` — nunca datas de cadastro (`createdAt`/`updatedAt`).
   */
  async resolveLastSeen(deviceId: string): Promise<string | null> {
    const map = await this.resolveLastSeenMany([deviceId]);
    return map.get(deviceId) ?? null;
  }

  /** Versão em lote de {@link resolveLastSeen} (2 queries agrupadas no total). */
  async resolveLastSeenMany(deviceIds: string[]): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    const missing: string[] = [];

    for (const id of deviceIds) {
      const ts = this.lastSeen.get(id);
      if (ts !== undefined) {
        result.set(id, new Date(ts).toISOString());
        continue;
      }
      const cached = this.durableLastSeen.get(id);
      if (cached !== undefined) {
        result.set(id, cached !== null ? new Date(cached).toISOString() : null);
        continue;
      }
      missing.push(id);
    }

    if (missing.length > 0 && this.prisma) {
      const [events, points] = await Promise.all([
        this.prisma.statusEvent.groupBy({
          by: ['entityId'],
          where: { entityId: { in: missing } },
          _max: { at: true },
        }),
        this.prisma.devicePoint.groupBy({
          by: ['deviceId'],
          where: { deviceId: { in: missing }, lastValueAt: { not: null } },
          _max: { lastValueAt: true },
        }),
      ]);

      const best = new Map<string, number>();
      for (const e of events) {
        if (e._max.at) {
          best.set(e.entityId, Math.max(best.get(e.entityId) ?? 0, e._max.at.getTime()));
        }
      }
      for (const p of points) {
        if (p._max.lastValueAt) {
          best.set(p.deviceId, Math.max(best.get(p.deviceId) ?? 0, p._max.lastValueAt.getTime()));
        }
      }

      for (const id of missing) {
        const ts = best.get(id) ?? null;
        this.durableLastSeen.set(id, ts);
        result.set(id, ts !== null ? new Date(ts).toISOString() : null);
      }
    } else {
      for (const id of missing) result.set(id, null);
    }

    return result;
  }
}
