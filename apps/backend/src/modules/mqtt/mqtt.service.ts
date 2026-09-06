import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';

type MessageHandler = (topic: string, payload: Buffer) => void;

/** Snapshot da saúde da conexão MQTT do backend (read-only, sem segredos). */
export interface MqttConnectionStatus {
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
  /**
   * O broker RECUSOU a credencial do backend (CONNACK de autenticação) e a
   * conexão segue caída — estado que exige ação do admin (re-provisionar as
   * credenciais no EMQX ou corrigir MQTT_USERNAME/MQTT_PASSWORD).
   */
  authRefused: boolean;
  /** Último instante em que o broker recusou a autenticação (ISO), ou null. */
  lastAuthRefusedAt: string | null;
}

/** Período normal de reconexão do cliente MQTT. */
const RECONNECT_PERIOD_MS = 5_000;
/**
 * Período de reconexão APÓS recusa de autenticação. Reconectar a cada 5s com
 * credencial inválida dispara o flapping_detect do EMQX (15 (des)conexões/min
 * → ban de 5 min), o que atrasaria a recuperação mesmo depois de corrigir a
 * credencial. 60s fica bem abaixo do limiar e ainda recupera sozinho.
 */
const AUTH_REFUSED_RECONNECT_PERIOD_MS = 60_000;

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client!: MqttClient;
  private readonly handlers: MessageHandler[] = [];

  // ── Métricas de conexão (observabilidade) ──────────────────────────────────
  private connected = false;
  private connectCount = 0;
  private reconnectCount = 0;
  private lastConnectedAt: string | null = null;
  private lastDisconnectedAt: string | null = null;
  private lastError: string | null = null;
  private authRefused = false;
  private lastAuthRefusedAt: string | null = null;
  private sanitizedBroker = '';
  private authUsername: string | undefined;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const brokerUrl = this.config.get<string>('MQTT_BROKER_URL', 'mqtt://localhost:1883');
    const clientId = this.config.get<string>('MQTT_CLIENT_ID', `backend-${Date.now()}`);
    const username = this.config.get<string | undefined>('MQTT_USERNAME');
    const password = this.config.get<string | undefined>('MQTT_PASSWORD');

    this.sanitizedBroker = this.sanitizeBrokerUrl(brokerUrl);
    this.authUsername = username;

    this.client = mqtt.connect(brokerUrl, {
      clientId,
      username,
      password,
      reconnectPeriod: RECONNECT_PERIOD_MS,
      connectTimeout: 10000,
    });

    this.client.on('connect', () => {
      this.connected = true;
      this.connectCount += 1;
      this.lastConnectedAt = new Date().toISOString();
      if (this.authRefused) {
        // Credencial voltou a ser aceita — limpa o estado e restaura o ritmo
        // normal de reconexão.
        this.authRefused = false;
        this.client.options.reconnectPeriod = RECONNECT_PERIOD_MS;
        this.logger.log('MQTT: autenticação restabelecida no broker');
      }
      this.logger.log(`Connected to MQTT broker: ${this.sanitizedBroker}`);
    });

    this.client.on('error', (err) => {
      this.lastError = err.message;
      // CONNACK de recusa de autenticação: 4/5 (MQTT 3.1.1 — bad user/pass,
      // not authorized) e 134/135 (MQTT 5). Sem este log explícito, a recusa
      // fica indistinguível de instabilidade de rede e passa despercebida —
      // o backend fica SEM telemetria, status e saúde de gateways.
      const reasonCode = (err as Partial<mqtt.ErrorWithReasonCode>).code;
      if (
        reasonCode === 4 ||
        reasonCode === 5 ||
        reasonCode === 134 ||
        reasonCode === 135
      ) {
        this.authRefused = true;
        this.lastAuthRefusedAt = new Date().toISOString();
        // Anti-flapping: reconectar a cada 5s com credencial recusada ativa o
        // ban temporário do EMQX (flapping_detect) — recua para 60s.
        this.client.options.reconnectPeriod = AUTH_REFUSED_RECONNECT_PERIOD_MS;
        this.logger.error(
          `MQTT: AUTENTICAÇÃO RECUSADA pelo broker ${this.sanitizedBroker} ` +
            `(username: ${this.authUsername ?? '(não definido)'}): ${err.message}. ` +
            'Verifique se o usuário existe no EMQX e se MQTT_USERNAME/MQTT_PASSWORD ' +
            'estão corretos — o backend segue SEM conexão MQTT (sem telemetria, ' +
            'status ou saúde de gateways) até corrigir.',
        );
      } else {
        this.logger.error(`MQTT error: ${err.message}`);
      }
    });

    this.client.on('reconnect', () => {
      this.reconnectCount += 1;
      this.logger.warn('Reconnecting to MQTT broker...');
    });

    this.client.on('close', () => {
      if (this.connected) {
        this.lastDisconnectedAt = new Date().toISOString();
      }
      this.connected = false;
    });

    this.client.on('offline', () => {
      this.connected = false;
    });

    this.client.on('message', (topic: string, payload: Buffer) => {
      for (const handler of this.handlers) {
        handler(topic, payload);
      }
    });
  }

  /**
   * Estado da conexão MQTT legível por HTTP (observabilidade). Não expõe
   * credenciais: a URL do broker é sanitizada (userinfo removido).
   */
  getConnectionStatus(): MqttConnectionStatus {
    return {
      connected: this.connected,
      broker: this.sanitizedBroker,
      connectCount: this.connectCount,
      reconnectCount: this.reconnectCount,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      lastError: this.lastError,
      authRefused: this.authRefused,
      lastAuthRefusedAt: this.lastAuthRefusedAt,
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
    if (this.client) {
      this.client.end();
    }
  }

  subscribe(topicPattern: string, qos: 0 | 1 | 2 = 0): void {
    this.client.subscribe(topicPattern, { qos }, (err) => {
      if (err) {
        this.logger.error(`Failed to subscribe to ${topicPattern}: ${err.message}`);
      } else {
        this.logger.debug(`Subscribed to ${topicPattern}`);
      }
    });
  }

  publish(topic: string, payload: object, qos: 0 | 1 | 2 = 1, retain = false): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.publish(
        topic,
        JSON.stringify(payload),
        { qos, retain },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      );
    });
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }
}
