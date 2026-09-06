import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import { GatewayHealthService } from './gateway-health.service';

/** Intervalo padrão de publicação do resumo de saúde (folgado). */
const DEFAULT_HEALTH_INTERVAL_MS = 20_000;

/**
 * GatewayHealthPublisherService — publica periodicamente o resumo de saúde do
 * gateway (o MESMO payload exposto em `GET /health`) num tópico MQTT novo e
 * dedicado, para o backend consumir e exibir por gateway na tela de Gateway.
 *
 * Tópico (novo, aditivo): bluebee/{tenant}/gateway/{id}/health
 *
 * Garantias:
 *   - Isolado (try/catch) e efêmero: NÃO usa store-and-forward nem interfere no
 *     loop de telemetria. Quando offline, apenas não publica.
 *   - Intervalo configurável (GATEWAY_HEALTH_INTERVAL_MS) e desligável por
 *     configuração (GATEWAY_HEALTH_ENABLED=false).
 *   - Não altera o tópico/payload de telemetria nem o de status/liveness.
 */
@Injectable()
export class GatewayHealthPublisherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(GatewayHealthPublisherService.name);
  private timer: NodeJS.Timeout | null = null;
  private topic = '';

  constructor(
    private readonly config: ConfigService,
    private readonly mqtt: GatewayMqttService,
    private readonly health: GatewayHealthService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<string>('GATEWAY_HEALTH_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('Publicação de saúde do gateway desativada (GATEWAY_HEALTH_ENABLED=false)');
      return;
    }

    const intervalMs = this.resolveInterval();
    const tenantId = this.config.get<string>('TENANT_ID', 'default');
    const gatewayId = this.config.get<string>('GATEWAY_ID', 'gw-01');
    this.topic = `bluebee/${tenantId}/gateway/${gatewayId}/health`;

    this.timer = setInterval(() => this.publishHealth(), intervalMs);
    // Não segura o processo vivo só por causa do resumo de saúde.
    this.timer.unref?.();

    this.logger.log(
      `Publicando resumo de saúde em ${this.topic} a cada ${Math.round(intervalMs / 1000)}s`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Monta e publica o resumo de saúde. Nunca lança — falhas são só logadas. */
  private publishHealth(): void {
    try {
      const snapshot = this.health.buildSnapshot();
      this.mqtt.publishEphemeral(this.topic, snapshot);
    } catch (err) {
      this.logger.warn(`Falha ao montar/publicar resumo de saúde: ${(err as Error).message}`);
    }
  }

  /** Intervalo configurável, com piso de segurança de 5s. */
  private resolveInterval(): number {
    const raw = this.config.get<string>('GATEWAY_HEALTH_INTERVAL_MS');
    const parsed = raw ? Number(raw) : DEFAULT_HEALTH_INTERVAL_MS;
    if (!Number.isFinite(parsed) || parsed < 5_000) return DEFAULT_HEALTH_INTERVAL_MS;
    return parsed;
  }
}
