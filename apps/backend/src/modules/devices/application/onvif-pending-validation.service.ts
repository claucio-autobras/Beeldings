import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DeviceStatusService } from '../../mqtt/device-status.service.js';
import { DeviceConfigPublisherService } from './device-config-publisher.service.js';
import { OnvifProbeService } from './onvif-probe.service.js';
import { decryptCameraSecret } from './camera-credentials.util.js';
import { ONVIF_PROTOCOL } from '../../prisma/device-filters.js';

/** Intervalo entre rodadas de re-tentativa do probe pendente. */
const RETRY_INTERVAL_MS = 2 * 60_000;

/**
 * OnvifPendingValidationService
 *
 * Câmeras ONVIF cadastradas com "validação pendente" (probe falhou no cadastro
 * e o usuário escolheu salvar mesmo assim) são re-validadas automaticamente em
 * segundo plano: a cada rodada, o serviço tenta o probe via gateway e, quando
 * ele finalmente funciona, preenche fabricante/modelo/firmware/série, persiste
 * a porta efetiva e limpa a marcação — o aviso some da UI sem ação do usuário.
 *
 * Gateways comprovadamente offline (LWT/heartbeat) são pulados na rodada.
 * Rodadas são serializadas (nunca duas em paralelo na mesma instância).
 */
@Injectable()
export class OnvifPendingValidationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OnvifPendingValidationService.name);
  private handle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly onvifProbe: OnvifProbeService,
    private readonly configPublisher: DeviceConfigPublisherService,
    private readonly deviceStatus: DeviceStatusService,
  ) {}

  onModuleInit(): void {
    this.handle = setInterval(() => {
      void this.runOnce();
    }, RETRY_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.handle) clearInterval(this.handle);
  }

  /** Uma rodada: re-tenta o probe de todas as câmeras pendentes. */
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const pending = await this.prisma.device.findMany({
        where: {
          protocol: ONVIF_PROTOCOL,
          config: { path: ['pendingValidation'], equals: true },
        },
      });
      for (const camera of pending) {
        await this.retryCamera(camera.id).catch((err) => {
          this.logger.warn(
            `Re-validação ONVIF da câmera ${camera.id} falhou: ${(err as Error).message}`,
          );
        });
      }
    } catch (err) {
      this.logger.error(`Rodada de re-validação ONVIF falhou: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Re-tenta o probe de UMA câmera pendente. Retorna true quando a validação
   * finalmente funcionou (deviceInfo preenchido e marcação limpa).
   */
  async retryCamera(deviceId: string): Promise<boolean> {
    const camera = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!camera || camera.protocol !== ONVIF_PROTOCOL || !camera.gatewayId) {
      return false;
    }
    const cfg = (camera.config ?? {}) as Record<string, unknown>;
    if (cfg.pendingValidation !== true) return false;

    // Gateway comprovadamente offline: não vale a pena esperar o timeout.
    if (this.deviceStatus.getStatus(camera.gatewayId) === 'offline') {
      return false;
    }

    const username = cfg.onvifUsername as string | undefined;
    const password = decryptCameraSecret(cfg.onvifPasswordEnc as string | undefined);
    if (!username || !password) return false;

    const probe = await this.onvifProbe.probe({
      tenantId: camera.tenantId,
      gatewayId: camera.gatewayId,
      ip: camera.ip as string,
      port: camera.port ?? 80,
      username,
      password,
    });
    if (!probe.success) {
      this.logger.debug(
        `Câmera ${deviceId} segue com validação ONVIF pendente (${probe.errorCode})`,
      );
      return false;
    }

    const effectivePort = probe.port || camera.port || 80;
    const { pendingValidation: _pending, ...rest } = cfg;
    await this.prisma.device.update({
      where: { id: deviceId },
      data: {
        port: effectivePort,
        config: {
          ...rest,
          deviceInfo: probe.deviceInfo,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.configPublisher.publishForDevice(deviceId);
    this.logger.log(
      `Validação ONVIF pendente concluída para a câmera ${deviceId} ` +
        `(porta ${effectivePort}, ${probe.deviceInfo.manufacturer ?? '?'} ` +
        `${probe.deviceInfo.model ?? '?'})`,
    );
    return true;
  }
}
