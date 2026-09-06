import { Injectable, Logger } from '@nestjs/common';
import { TrendMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TrendRecorderService } from './trend-recorder.service.js';

/** Ponto candidato (shape mínimo do DevicePoint). */
interface CandidatePoint {
  id: string;
  tag: string;
  objectName: string;
  objectType: string;
  unit: string | null;
  binding: unknown;
}

const ANALOG_BACNET = new Set(['AI', 'AV', 'AO']);
const DIGITAL_BACNET = new Set(['BI', 'BV', 'BO']);

/**
 * Cobertura automática de trends (padrão por tenant, desligável): ao cadastrar/
 * sincronizar pontos, cria trends padrão para pontos relevantes — analógicos de
 * medição (INTERVAL 5 min) e estados digitais principais (ON_CHANGE) — evitando
 * lacunas de histórico para a IA. NUNCA altera trends já configuradas: pontos
 * que já têm qualquer trend são pulados. Falha de forma silenciosa (log) para
 * nunca quebrar o cadastro do equipamento.
 */
@Injectable()
export class DefaultTrendsService {
  private readonly logger = new Logger(DefaultTrendsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recorder: TrendRecorderService,
  ) {}

  /** Classifica o ponto: 'analog' | 'digital' | null (sem trend padrão). */
  classify(point: CandidatePoint): 'analog' | 'digital' | null {
    const type = (point.objectType ?? '').toUpperCase();
    if (ANALOG_BACNET.has(type)) return 'analog';
    if (DIGITAL_BACNET.has(type)) return 'digital';
    if (type === 'MODBUS') {
      const b = (point.binding ?? {}) as { registerType?: string };
      return b.registerType === 'coil' || b.registerType === 'discrete' ? 'digital' : 'analog';
    }
    if (type === 'MQTT') {
      const b = (point.binding ?? {}) as { valueType?: string };
      return b.valueType === 'boolean' ? 'digital' : 'analog';
    }
    return null; // MSI/MSO/CharacterString/etc — sem padrão automático
  }

  /**
   * Aplica trends padrão aos pontos de um device que ainda não têm nenhuma.
   * Chamado após criação de device/pontos e após sync BACnet. Retorna quantas
   * trends foram criadas.
   */
  async applyDefaultsForDevice(deviceId: string): Promise<number> {
    try {
      const device = await this.prisma.device.findUnique({
        where: { id: deviceId },
        select: {
          tenantId: true,
          protocol: true,
          tenant: { select: { autoTrendEnabled: true } },
          points: {
            select: { id: true, tag: true, objectName: true, objectType: true, unit: true, binding: true, trends: { select: { id: true }, take: 1 } },
          },
        },
      });
      if (!device) return 0;
      if (!device.tenant.autoTrendEnabled) return 0;
      // Nunca em pontos virtuais (bancada) nem câmeras (onvif/snmp).
      if (!['bacnet', 'modbus', 'mqtt'].includes(device.protocol)) return 0;

      const toCreate: { pointId: string; kind: 'analog' | 'digital'; name: string }[] = [];
      for (const p of device.points) {
        if (p.trends.length > 0) continue; // já tem trend configurada — não mexe
        const kind = this.classify(p);
        if (!kind) continue;
        toCreate.push({ pointId: p.id, kind, name: `${p.objectName || p.tag} (auto)` });
      }
      if (toCreate.length === 0) return 0;

      await this.prisma.trend.createMany({
        data: toCreate.map((t) => ({
          tenantId: device.tenantId,
          pointId: t.pointId,
          name: t.name,
          mode: t.kind === 'analog' ? TrendMode.INTERVAL : TrendMode.ON_CHANGE,
          intervalSeconds: t.kind === 'analog' ? 300 : null,
          covThreshold: null,
          // Digital ON_CHANGE com heartbeat de 1h — garante amostras mesmo estável.
          maxIntervalSeconds: t.kind === 'digital' ? 3600 : null,
          retentionDays: 365,
        })),
      });
      await this.recorder.reload();
      this.logger.log(`Trends padrão: ${toCreate.length} criada(s) para o device ${deviceId}`);
      return toCreate.length;
    } catch (err) {
      this.logger.error(`Falha ao aplicar trends padrão em ${deviceId}: ${(err as Error).message}`);
      return 0;
    }
  }
}
