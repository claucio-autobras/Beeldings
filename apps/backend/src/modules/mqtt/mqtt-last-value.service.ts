import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { BacnetTelemetryPayload } from './telemetry.gateway.js';

/** TTL do cache deviceId → é MQTT comum? (evita query por ciclo de telemetria). */
const PROTOCOL_CACHE_TTL_MS = 5 * 60_000;

/**
 * Intervalo mínimo entre escritas do MESMO valor por ponto. Mudança de valor
 * grava imediatamente (equipamentos publish-on-change publicam pouco); valor
 * repetido só atualiza o timestamp de tempos em tempos — coalescência que
 * mantém a ingestão leve mesmo com sensores tagarelas.
 */
const SAME_VALUE_MIN_INTERVAL_MS = 60_000;

/**
 * MqttLastValueService
 *
 * Persiste o último valor lido de cada ponto de dispositivo MQTT comum em
 * DevicePoint.lastValue/lastValueAt — mesmo padrão do CameraLastValueService,
 * mas para equipamentos MQTT (ex.: controladoras em modo raiz que publicam só
 * na mudança). Assim a tela do dispositivo mostra o último valor conhecido
 * imediatamente, em vez de "Aguardando leitura…" até a próxima publicação.
 *
 * Escopo intencional: SÓ protocol='mqtt' (câmeras têm serviço próprio;
 * dispositivos virtuais/bancada ficam de fora; BACnet/Modbus têm polling).
 * Gravação fire-and-forget: falha de banco nunca afeta o fluxo de telemetria.
 * Escritas são idempotentes — em cluster, instâncias duplicadas apenas
 * regravam o mesmo valor (sem efeito colateral).
 */
@Injectable()
export class MqttLastValueService {
  private readonly logger = new Logger(MqttLastValueService.name);

  /** deviceId → { isMqtt, expiresAt } */
  private readonly protocolCache = new Map<string, { isMqtt: boolean; expiresAt: number }>();

  /** `${deviceId}|${tag}` → última escrita (coalescência de valores repetidos). */
  private readonly lastWrite = new Map<string, { value: number | null; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Consome um payload de telemetria (chamado pelo BacnetMqttSubscriber). */
  consume(data: BacnetTelemetryPayload): void {
    if (!data.deviceId || !Array.isArray(data.points) || data.points.length === 0) {
      return;
    }
    void this.persist(data).catch((err: Error) => {
      this.logger.warn(
        `Falha ao persistir últimos valores do dispositivo MQTT ${data.deviceId}: ${err.message}`,
      );
    });
  }

  private async persist(data: BacnetTelemetryPayload): Promise<void> {
    const deviceId = data.deviceId as string;
    if (!(await this.isMqttDevice(deviceId))) {
      return;
    }

    const at = data.timestamp ? new Date(data.timestamp) : new Date();
    const validAt = Number.isNaN(at.getTime()) ? new Date() : at;
    const now = Date.now();

    for (const p of data.points) {
      if (!p?.tag) continue;
      // lastValue é Float — booleanos chegam como 1/0 do gateway; strings não
      // numéricas viram null (o campo não as representa; a UI mantém o live).
      const value =
        p.value === null || p.value === undefined || !Number.isFinite(Number(p.value))
          ? null
          : Number(p.value);

      // Coalescência: valor repetido dentro da janela só atualiza em memória.
      const key = `${deviceId}|${p.tag}`;
      const prev = this.lastWrite.get(key);
      if (prev && prev.value === value && now - prev.at < SAME_VALUE_MIN_INTERVAL_MS) {
        continue;
      }
      this.lastWrite.set(key, { value, at: now });

      await this.prisma.devicePoint.updateMany({
        where: { deviceId, tag: p.tag },
        data: {
          lastValue: value,
          lastValueAt: validAt,
          lastValueState: p.state ?? null,
        },
      });
    }
  }

  private async isMqttDevice(deviceId: string): Promise<boolean> {
    const cached = this.protocolCache.get(deviceId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.isMqtt;
    }
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { protocol: true },
    });
    // Exclui virtuais (bancada), câmeras (snmp/onvif) e demais protocolos.
    const isMqtt = device?.protocol === 'mqtt';
    this.protocolCache.set(deviceId, {
      isMqtt,
      expiresAt: Date.now() + PROTOCOL_CACHE_TTL_MS,
    });
    return isMqtt;
  }
}
