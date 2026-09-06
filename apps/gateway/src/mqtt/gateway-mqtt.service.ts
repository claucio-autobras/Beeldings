import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as mqtt from 'mqtt';
import { StoreAndForwardService } from './store-and-forward.service';

/**
 * GatewayMqttService
 *
 * Gerencia a conexão MQTT do gateway com o broker EMQX.
 * Responsabilidades:
 *   - Conectar ao broker ao inicializar o módulo
 *   - Subscrever ao tópico de comandos do gateway
 *   - Emitir eventos NestJS para cada mensagem recebida
 *   - Publicar resultados de volta ao backend
 *
 * Tópico de comandos (entrada):
 *   bluebee/{tenantId}/gateway/{gatewayId}/commands
 *
 * Tópicos de resultado (saída):
 *   bluebee/{tenantId}/gateway/{gatewayId}/discovery/result
 *   bluebee/{tenantId}/gateway/{gatewayId}/telemetry
 */
/** Intervalo do heartbeat de liveness do gateway (prova de vida periódica). */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** Tamanho do lote confirmado no reenvio da fila store-and-forward. */
const DRAIN_BATCH_SIZE = 100;

/** Snapshot da saúde da conexão MQTT do gateway (read-only, sem segredos). */
export interface GatewayMqttStatus {
  /** Conectado ao broker neste instante. */
  connected: boolean;
  /** URL do broker com credenciais removidas (host:porta). */
  broker: string;
  /** Total de vezes que a conexão foi (re)estabelecida desde o boot. */
  connectCount: number;
  /** Total de tentativas de reconexão emitidas desde o boot. */
  reconnectCount: number;
  /** Último instante em que conectou (ISO), ou null. */
  lastConnectedAt: string | null;
  /** Último instante em que a conexão caiu (ISO), ou null. */
  lastDisconnectedAt: string | null;
  /** Mensagem do último erro MQTT, ou null. */
  lastError: string | null;
}

@Injectable()
export class GatewayMqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayMqttService.name);
  private client: mqtt.MqttClient;
  private statusTopic!: string;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  /** Guarda de reentrância do drain (reconexões em sequência não sobrepõem reenvios). */
  private draining = false;

  // ── Métricas de conexão (observabilidade) ──────────────────────────────────
  private connectCount = 0;
  private reconnectCount = 0;
  private lastConnectedAt: string | null = null;
  private lastDisconnectedAt: string | null = null;
  private lastError: string | null = null;
  private sanitizedBroker = '';

  constructor(
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly storeAndForward: StoreAndForwardService,
  ) {}

  onModuleInit(): void {
    const brokerUrl = this.config.get<string>('MQTT_BROKER_URL', 'mqtt://localhost:1883');
    const tenantId = this.config.get<string>('TENANT_ID', 'default');
    const gatewayId = this.config.get<string>('GATEWAY_ID', 'gw-01');
    const username = this.config.get<string>('MQTT_USERNAME');
    const password = this.config.get<string>('MQTT_PASSWORD');

    // Tópico de status de liveness do gateway. O LWT (retido) é publicado
    // AUTOMATICAMENTE pelo broker quando a conexão do gateway cai sem um
    // disconnect limpo; o heartbeat (retido) reafirma "online" periodicamente.
    this.statusTopic = `bluebee/${tenantId}/gateway/${gatewayId}/status`;

    this.sanitizedBroker = this.sanitizeBrokerUrl(brokerUrl);

    this.client = mqtt.connect(brokerUrl, {
      clientId: `gateway-${gatewayId}-${Date.now()}`,
      username,
      password,
      clean: true,
      reconnectPeriod: 5000,
      // Last Will and Testament: entregue pelo broker se o gateway sumir sem
      // encerrar a conexão de forma limpa (queda súbita, perda de rede, kill).
      // Retido para que o backend receba o último estado ao (re)subscrever.
      will: {
        topic: this.statusTopic,
        payload: JSON.stringify({ status: 'offline', gatewayId, reason: 'lwt' }),
        qos: 1,
        retain: true,
      },
    });

    this.client.on('connect', () => {
      this.connectCount += 1;
      this.lastConnectedAt = new Date().toISOString();
      this.logger.log(`Conectado ao broker MQTT: ${this.sanitizedBroker}`);

      // Prova de vida imediata ao (re)conectar + heartbeat periódico.
      this.publishStatus('online');
      this.startHeartbeat();

      const commandTopic = `bluebee/${tenantId}/gateway/${gatewayId}/commands`;
      this.client.subscribe(commandTopic, { qos: 1 }, (err) => {
        if (err) {
          this.logger.error(`Falha ao subscrever tópico ${commandTopic}: ${err.message}`);
        } else {
          this.logger.log(`Subscrito em: ${commandTopic}`);
        }
      });

      // Config de polling (retido) — entregue ao conectar e a cada alteração de pontos
      const configTopic = `bluebee/${tenantId}/gateway/${gatewayId}/config`;
      this.client.subscribe(configTopic, { qos: 1 }, (err) => {
        if (err) {
          this.logger.error(`Falha ao subscrever tópico ${configTopic}: ${err.message}`);
        } else {
          this.logger.log(`Subscrito em: ${configTopic}`);
        }
      });

      // Store-and-forward: drena mensagens pendentes acumuladas enquanto offline.
      // Nunca rejeita (erros são tratados internamente).
      void this.drainPendingMessages();
    });

    this.client.on('message', (topic: string, payload: Buffer) => {
      this.handleIncomingMessage(topic, payload);
    });

    this.client.on('error', (err: Error) => {
      this.lastError = err.message;
      this.logger.error(`Erro MQTT: ${err.message}`);
    });

    this.client.on('reconnect', () => {
      this.reconnectCount += 1;
      this.logger.warn('Reconectando ao broker MQTT...');
    });

    this.client.on('close', () => {
      if (this.lastConnectedAt) {
        this.lastDisconnectedAt = new Date().toISOString();
      }
    });
  }

  /**
   * Estado da conexão MQTT do gateway legível por HTTP (observabilidade).
   * Não expõe credenciais: a URL do broker é sanitizada (userinfo removido).
   */
  getConnectionStatus(): GatewayMqttStatus {
    return {
      connected: Boolean(this.client?.connected),
      broker: this.sanitizedBroker,
      connectCount: this.connectCount,
      reconnectCount: this.reconnectCount,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      lastError: this.lastError,
    };
  }

  /** Remove credenciais (user:pass@) da URL do broker antes de expô-la. */
  private sanitizeBrokerUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const port = parsed.port ? `:${parsed.port}` : '';
      return `${parsed.protocol}//${parsed.hostname}${port}`;
    } catch {
      return url.replace(/\/\/[^@/]*@/, '//');
    }
  }

  onModuleDestroy(): void {
    this.stopHeartbeat();
    if (this.client) {
      // Shutdown limpo: publica offline (retido) ANTES de encerrar, para que o
      // backend saiba que a queda foi intencional e não fique aguardando o LWT.
      if (this.client.connected) {
        this.client.publish(
          this.statusTopic,
          JSON.stringify({ status: 'offline', gatewayId: this.gatewayIdOf(), reason: 'shutdown' }),
          { qos: 1, retain: true },
        );
      }
      this.client.end();
      this.logger.log('Conexão MQTT encerrada');
    }
  }

  private gatewayIdOf(): string {
    return this.config.get<string>('GATEWAY_ID', 'gw-01');
  }

  /**
   * Publica o status de liveness do gateway (retido) no tópico de status.
   * Retido garante que o backend receba o último estado ao (re)subscrever,
   * mesmo tendo se conectado ao broker depois do gateway.
   */
  private publishStatus(status: 'online' | 'offline'): void {
    if (!this.client?.connected) return;
    this.client.publish(
      this.statusTopic,
      JSON.stringify({ status, gatewayId: this.gatewayIdOf(), ts: new Date().toISOString() }),
      { qos: 1, retain: true },
      (err) => {
        if (err) {
          this.logger.error(`Falha ao publicar status ${status}: ${err.message}`);
        }
      },
    );
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.publishStatus('online');
    }, HEARTBEAT_INTERVAL_MS);
    // Não segura o process vivo só por causa do heartbeat.
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Publica uma mensagem JSON em um tópico MQTT.
   */
  publish(topic: string, payload: unknown): void {
    const message = JSON.stringify(payload);

    // Sem conexão com o broker: enfileira para reenvio posterior (store-and-forward)
    // e evita logs de erro repetidos enquanto offline.
    if (!this.client?.connected) {
      this.storeAndForward.enqueue(topic, message, 1);
      return;
    }

    this.publishRaw(topic, message, 1, true);
  }

  /**
   * Publica um resumo efêmero (ex.: saúde do gateway) SEM store-and-forward.
   * Diferente de `publish`, quando offline a mensagem é simplesmente descartada
   * — não faz sentido acumular resumos de saúde antigos para reenviar depois.
   * Retido para que o backend receba o último resumo ao (re)subscrever.
   * Isolado: nunca lança; falhas são apenas logadas.
   */
  publishEphemeral(topic: string, payload: unknown): void {
    try {
      if (!this.client?.connected) return;
      this.client.publish(topic, JSON.stringify(payload), { qos: 0, retain: true }, (err) => {
        if (err) {
          this.logger.warn(`Falha ao publicar resumo em ${topic}: ${err.message}`);
        }
      });
    } catch (err) {
      this.logger.warn(`Falha ao publicar resumo em ${topic}: ${(err as Error).message}`);
    }
  }

  /**
   * Publica uma mensagem volátil (ex.: frame de visualização ao vivo):
   * QoS0, SEM retain e SEM store-and-forward — se estiver offline ou a
   * publicação falhar, a mensagem é simplesmente descartada (o próximo frame
   * a substitui). Nunca lança.
   */
  publishVolatile(topic: string, payload: unknown): void {
    try {
      if (!this.client?.connected) return;
      this.client.publish(topic, JSON.stringify(payload), { qos: 0, retain: false }, (err) => {
        if (err) {
          this.logger.debug(`Falha ao publicar mensagem volátil em ${topic}: ${err.message}`);
        }
      });
    } catch (err) {
      this.logger.debug(
        `Falha ao publicar mensagem volátil em ${topic}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Publica uma mensagem já serializada diretamente no broker.
   * Se a publicação falhar e `enqueueOnError` estiver ativo, a mensagem é
   * enfileirada como fallback (store-and-forward).
   */
  private publishRaw(
    topic: string,
    message: string,
    qos: 0 | 1,
    enqueueOnError: boolean,
  ): void {
    this.client.publish(topic, message, { qos }, (err) => {
      if (err) {
        this.logger.error(`Falha ao publicar em ${topic}: ${err.message}`);
        if (enqueueOnError) {
          this.storeAndForward.enqueue(topic, message, qos);
        }
      } else {
        this.logger.debug(`Publicado em ${topic} (${message.length} bytes)`);
      }
    });
  }

  /**
   * Drena a fila do store-and-forward de forma crash-safe: cada mensagem só é
   * REMOVIDA da fila persistida após a confirmação de publicação (callback sem
   * erro). Se o gateway cair no meio do reenvio, as mensagens ainda não
   * publicadas continuam no disco e são reenviadas no próximo boot/reconexão.
   *
   * O reenvio é feito em pequenos lotes confirmados para não segurar a fila
   * inteira em voo (10.000 mensagens) nem serializar um ack por vez.
   */
  private async drainPendingMessages(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const pending = this.storeAndForward.peekAll();
      if (pending.length === 0) return;

      this.logger.log(`Republicando ${pending.length} mensagem(ns) pendente(s)`);

      for (let i = 0; i < pending.length; i += DRAIN_BATCH_SIZE) {
        if (!this.client?.connected) {
          this.logger.warn(
            'Conexão caiu durante o reenvio — mensagens restantes permanecem na fila',
          );
          return;
        }
        const batch = pending.slice(i, i + DRAIN_BATCH_SIZE);
        const results = await Promise.all(
          batch.map((msg) => this.publishConfirmed(msg.topic, msg.payload, msg.qos)),
        );
        batch.forEach((msg, j) => {
          if (results[j]) {
            // Confirmado pelo broker — só agora sai da fila persistida.
            this.storeAndForward.remove(msg);
          }
        });
        if (results.some((ok) => !ok)) {
          // Falha de publicação: a mensagem permanece na fila (nada a reenfileirar);
          // interrompe o drain — a próxima reconexão tenta de novo.
          this.logger.warn(
            'Falha ao republicar mensagem pendente — reenvio interrompido; ' +
              'mensagens não confirmadas permanecem na fila',
          );
          return;
        }
      }
    } catch (err) {
      this.logger.error(
        `Erro inesperado no reenvio da fila: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      this.draining = false;
    }
  }

  /** Publica e resolve true somente quando o broker confirma (callback sem erro). */
  private publishConfirmed(topic: string, message: string, qos: 0 | 1): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.client.publish(topic, message, { qos }, (err) => resolve(!err));
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Processa mensagens recebidas e emite eventos NestJS para os handlers.
   * O CommandDispatcherService escuta esses eventos e faz o roteamento.
   */
  private handleIncomingMessage(topic: string, payload: Buffer): void {
    try {
      const message = JSON.parse(payload.toString()) as Record<string, unknown>;
      this.logger.debug(`Mensagem recebida em ${topic}`);
      this.eventEmitter.emit('mqtt.message', { topic, message });
    } catch (err) {
      this.logger.error(
        `Payload inválido recebido em ${topic}: ${(err as Error).message}`,
      );
    }
  }
}
