import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import * as mqtt from 'mqtt';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import { PollingMetricsService } from '../observability/polling-metrics.service';

/** Binding de um ponto MQTT-nativo (vem do mapa de bridge publicado pelo backend). */
interface MqttBridgeBinding {
  deviceId: string;
  tag: string;
  jsonPath: string | null;
  valueType: 'number' | 'boolean';
  unit: string | null;
}

/** Bloco de config de um device MQTT dentro do payload de config do gateway. */
interface MqttDeviceBlock {
  deviceId: string;
  name: string;
  protocol?: string;
  /**
   * Tópico raiz próprio do equipamento (modo sem prefixo). Quando presente, o
   * guard de namespace aceita sourceTopics sob `{rootTopic}/` além do
   * namespace de sensores do gateway.
   */
  rootTopic?: string | null;
  /** Tópico de presença/heartbeat declarado no cadastro (opcional). */
  heartbeat?: { topic: string; timeoutSeconds: number } | null;
  bridge: Array<{
    tag: string;
    sourceTopic: string;
    jsonPath: string | null;
    valueType: 'number' | 'boolean';
    unit: string | null;
  }>;
}

interface GatewayConfigPayload {
  tenantId: string;
  gatewayId: string;
  devices: MqttDeviceBlock[];
}

/** Comando de amostra emitido pelo CommandDispatcher. */
export interface MqttSampleCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  topic: string;
}

/** Sessão de captura de amostra em andamento. */
interface SampleSession {
  topic: string;
  samples: Array<{ topic: string; payload: string; receivedAt: string }>;
}

/** Comando de escrita MQTT emitido pelo CommandDispatcher. */
export interface MqttWriteCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  /** Tópico completo onde o comando é publicado (ex.: .../sensors/shelly1/rpc). */
  commandTopic: string;
  /** Payload pronto (já renderizado pelo backend). */
  payload: string;
  /** Tópico completo onde a confirmação chega (opcional). */
  responseTopic: string | null;
  /** Id RPC para casar a resposta (campo `id` do JSON), quando aplicável. */
  matchId: number | null;
  /**
   * Contexto do ponto comandado para publicar a telemetria confirmada
   * pós-escrita (mesmo formato do bridge). Ausente em comandos antigos.
   */
  confirm: {
    deviceId: string;
    tag: string;
    value: number;
    unit: string | null;
  } | null;
}

/** Sessão de escrita aguardando confirmação RPC. */
interface WriteSession {
  responseTopic: string;
  matchId: number | null;
  wasSubscribed: boolean;
  timer: NodeJS.Timeout;
  command: MqttWriteCommand;
  /**
   * true quando o próprio dispositivo já publicou o novo estado no sourceTopic
   * e o bridge o republicou como telemetria — evita duplicar a publicação
   * confirmada pós-escrita.
   */
  bridgePublished: boolean;
}

/** Janela de captura de amostra (ms) e nº máximo de mensagens. */
const SAMPLE_WINDOW_MS = 6_000;
const SAMPLE_MAX = 5;
/** Tempo máximo aguardando a confirmação RPC do dispositivo (ms). */
const WRITE_CONFIRM_TIMEOUT_MS = 10_000;

/**
 * MqttBridgeService
 *
 * Faz o "bridge" de equipamentos MQTT-nativos: numa CONEXÃO DEDICADA (separada
 * da conexão cloud do gateway), assina os tópicos nativos dos equipamentos,
 * extrai o valor (jsonPath) e republica no MESMO tópico canônico de telemetria
 * usado por BACnet/Modbus — via GatewayMqttService (conexão principal):
 *
 *   bluebee/{tenantId}/gateway/{gatewayId}/telemetry
 *
 * Assim todo o pipeline downstream funciona sem distinção de protocolo.
 *
 * Isolamento: a conexão dedicada garante que um problema no bridge não afete a
 * conexão principal (telemetria/config/comandos). Guard anti-loop: nunca assina
 * tópicos dentro de `bluebee/` (senão republicaria o próprio output).
 */
@Injectable()
export class MqttBridgeService implements OnModuleDestroy {
  private readonly logger = new Logger(MqttBridgeService.name);
  private readonly tenantId: string;
  private readonly gatewayId: string;
  /**
   * Namespace onde os sensores MQTT deste gateway publicam. Fica dentro do
   * escopo do tenant que a ACL do gateway já libera — por isso o bridge usa a
   * própria credencial do gateway (sem usuário amplo) e o isolamento é mantido.
   */
  private readonly sensorPrefix: string;

  private client: mqtt.MqttClient | null = null;

  /** sourceTopic → bindings que dependem desse tópico. */
  private readonly bindings = new Map<string, MqttBridgeBinding[]>();
  /** Tópicos atualmente assinados pelo bridge (persistentes). */
  private subscribed = new Set<string>();
  /** Sessões de amostra em andamento, keyed por command_id. */
  private readonly sampleSessions = new Map<string, SampleSession>();
  /** Sessões de escrita aguardando confirmação RPC, keyed por command_id. */
  private readonly writeSessions = new Map<string, WriteSession>();
  /** Tópico de heartbeat → device que declara presença por ele. */
  private readonly heartbeats = new Map<string, { deviceId: string; timeoutSeconds: number }>();

  constructor(
    private readonly mqttService: GatewayMqttService,
    private readonly configService: ConfigService,
    private readonly pollingMetrics: PollingMetricsService,
  ) {
    this.tenantId = this.configService.get<string>('TENANT_ID', 'default');
    this.gatewayId = this.configService.get<string>('GATEWAY_ID', 'gw-01');
    this.sensorPrefix = `bluebee/${this.tenantId}/gateway/${this.gatewayId}/sensors/`;
  }

  onModuleDestroy(): void {
    this.client?.end();
  }

  /**
   * Abre a conexão dedicada do bridge SOB DEMANDA. Idempotente: se já existe um
   * client ativo, não faz nada. A conexão só é aberta quando há pelo menos um
   * device MQTT-nativo na config (ou durante uma captura de amostra), evitando
   * um 2º cliente "fantasma" no broker em sites que só usam BACnet/Modbus.
   */
  private openConnection(): void {
    if (this.client) return;

    // Default = mesmo EMQX da plataforma; BRIDGE_BROKER_URL permite um broker
    // local do cliente no futuro sem tocar no resto.
    const brokerUrl =
      this.configService.get<string>('BRIDGE_BROKER_URL') ||
      this.configService.get<string>('MQTT_BROKER_URL', 'mqtt://localhost:1883');
    const username =
      this.configService.get<string>('BRIDGE_MQTT_USERNAME') ||
      this.configService.get<string>('MQTT_USERNAME');
    const password =
      this.configService.get<string>('BRIDGE_MQTT_PASSWORD') ||
      this.configService.get<string>('MQTT_PASSWORD');

    this.client = mqtt.connect(brokerUrl, {
      clientId: `gateway-bridge-${this.gatewayId}-${Date.now()}`,
      username,
      password,
      clean: true,
      reconnectPeriod: 5000,
    });

    this.client.on('connect', () => {
      this.logger.log(`Bridge MQTT conectado ao broker: ${brokerUrl}`);
      // Re-assina os tópicos conhecidos (após reconexão)
      for (const topic of this.subscribed) {
        this.client?.subscribe(topic, { qos: 0 });
      }
    });

    this.client.on('message', (topic: string, payload: Buffer) => {
      this.handleSourceMessage(topic, payload);
    });

    this.client.on('error', (err: Error) => {
      this.logger.error(`Erro no bridge MQTT: ${err.message}`);
    });
  }

  /**
   * Fecha a conexão do bridge SE estiver ociosa: sem bindings (nenhum device
   * MQTT na config) e sem captura de amostra em andamento. Zera o estado de
   * assinaturas para que uma futura reabertura comece limpa.
   */
  private closeConnectionIfIdle(): void {
    if (!this.client) return;
    if (this.bindings.size > 0) return;
    if (this.sampleSessions.size > 0) return;
    if (this.writeSessions.size > 0) return;
    if (this.heartbeats.size > 0) return;

    this.client.end(true);
    this.client = null;
    this.subscribed.clear();
    this.logger.log('Bridge MQTT desconectado (sem device MQTT nem amostra ativa)');
  }

  /** Recebe a config publicada pelo backend e (re)configura as assinaturas MQTT. */
  @OnEvent('mqtt.message')
  handleConfigMessage(event: { topic: string; message: Record<string, unknown> }): void {
    if (!event.topic.endsWith('/config')) {
      return;
    }
    const payload = event.message as unknown as GatewayConfigPayload;
    if (!Array.isArray(payload.devices)) {
      return;
    }
    this.applyConfig(payload.devices.filter((d) => d.protocol === 'mqtt'));
  }

  /** Reconstrói o mapa de bindings e ajusta as assinaturas (assina novos, remove os que sumiram). */
  private applyConfig(devices: MqttDeviceBlock[]): void {
    const next = new Map<string, MqttBridgeBinding[]>();
    const nextHeartbeats = new Map<string, { deviceId: string; timeoutSeconds: number }>();

    for (const d of devices) {
      // Escopo permitido deste device: namespace de sensores do gateway OU o
      // tópico raiz próprio declarado (modo sem prefixo). O raiz NUNCA pode
      // estar dentro de bluebee/ (anti-loop — o backend também valida).
      const rootTopic = (d.rootTopic ?? '').trim();
      // Mesma regra do backend: só o namespace interno exato ('bluebee' ou
      // 'bluebee/…') é proibido — 'bluebeex' é um raiz válido.
      const rootScope = rootTopic && rootTopic !== 'bluebee' && !rootTopic.startsWith('bluebee/')
        ? `${rootTopic}/`
        : null;
      const inScope = (topic: string): boolean =>
        topic.startsWith(this.sensorPrefix) ||
        (!!rootScope && (topic === rootTopic || topic.startsWith(rootScope)));

      for (const b of d.bridge ?? []) {
        const topic = (b.sourceTopic ?? '').trim();
        if (!topic) continue;
        // Guard: só faz bridge de tópicos no escopo do device (namespace de
        // sensores ou raiz próprio). Garante isolamento por tenant e mantém o
        // bridge fora dos tópicos de telemetria/config/comandos (evita loop).
        if (!inScope(topic)) {
          this.logger.warn(`sourceTopic ignorado (fora do escopo do device ${d.deviceId}): ${topic}`);
          continue;
        }
        const list = next.get(topic) ?? [];
        list.push({
          deviceId: d.deviceId,
          tag: b.tag,
          jsonPath: b.jsonPath ?? null,
          valueType: b.valueType ?? 'number',
          unit: b.unit ?? null,
        });
        next.set(topic, list);
      }

      // Heartbeat de presença: assina o tópico declarado e reencaminha ao
      // backend (device fica online mesmo publicando só na mudança de valor).
      const hbTopic = (d.heartbeat?.topic ?? '').trim();
      if (hbTopic && inScope(hbTopic)) {
        nextHeartbeats.set(hbTopic, {
          deviceId: d.deviceId,
          timeoutSeconds: d.heartbeat?.timeoutSeconds ?? 90,
        });
      } else if (hbTopic) {
        this.logger.warn(`Heartbeat ignorado (fora do escopo do device ${d.deviceId}): ${hbTopic}`);
      }
    }

    const hasMqtt = devices.length > 0;
    // Abre a conexão sob demanda ANTES de assinar, se há device MQTT na config.
    if (hasMqtt) {
      this.openConnection();
    }

    // Assina os novos tópicos (bindings + heartbeats)
    const wanted = new Set<string>([...next.keys(), ...nextHeartbeats.keys()]);
    for (const topic of wanted) {
      if (!this.subscribed.has(topic)) {
        this.client?.subscribe(topic, { qos: 0 }, (err) => {
          if (err) this.logger.error(`Falha ao assinar ${topic}: ${err.message}`);
          else this.logger.log(`Bridge assinando tópico: ${topic}`);
        });
        this.subscribed.add(topic);
      }
    }
    // Remove assinaturas que não são mais usadas (e não estão em amostra)
    for (const topic of [...this.subscribed]) {
      if (!wanted.has(topic) && !this.isSampling(topic)) {
        this.client?.unsubscribe(topic);
        this.subscribed.delete(topic);
        this.logger.log(`Bridge parou de assinar: ${topic}`);
      }
    }

    this.bindings.clear();
    for (const [topic, list] of next) this.bindings.set(topic, list);
    this.heartbeats.clear();
    for (const [topic, hb] of nextHeartbeats) this.heartbeats.set(topic, hb);

    // Sem device MQTT na config: fecha a conexão (se não houver amostra ativa)
    // para o 2º cliente sumir do broker.
    if (!hasMqtt) {
      this.closeConnectionIfIdle();
    }

    const totalPoints = devices.reduce((acc, d) => acc + (d.bridge?.length ?? 0), 0);
    this.logger.log(
      `Config MQTT bridge aplicada — ${devices.length} device(s), ${totalPoints} ponto(s)`,
    );
  }

  /** Mensagem recebida num tópico nativo: alimenta amostras e republica telemetria. */
  private handleSourceMessage(topic: string, payload: Buffer): void {
    // 0) Heartbeat de presença de um device: reencaminha ao backend no canal
    // canônico (o backend mantém o device online pela janela configurada).
    const hb = this.heartbeats.get(topic);
    if (hb) {
      // Payload do heartbeat: além da presença, muitos firmwares (ex.: Aeris)
      // publicam diagnóstico (RSSI, IP, uptime). Encaminha o payload cru
      // (JSON quando parseável, string truncada caso contrário) para o backend
      // exibir na tela do dispositivo. Falha de parse NUNCA bloqueia a presença.
      let hbPayload: unknown = null;
      const raw = payload.toString().slice(0, 2000);
      if (raw) {
        try {
          hbPayload = JSON.parse(raw);
        } catch {
          hbPayload = raw;
        }
      }
      this.mqttService.publish(
        `bluebee/${this.tenantId}/gateway/${this.gatewayId}/device-heartbeat`,
        {
          deviceId: hb.deviceId,
          timeoutSeconds: hb.timeoutSeconds,
          timestamp: new Date().toISOString(),
          payload: hbPayload,
        },
      );
    }

    // 0.5) Sessões de escrita aguardando confirmação RPC
    this.feedWriteSessions(topic, payload);

    // 1) Sessões de amostra ativas
    for (const session of this.sampleSessions.values()) {
      if (this.topicMatches(session.topic, topic) && session.samples.length < SAMPLE_MAX) {
        session.samples.push({
          topic,
          payload: payload.toString().slice(0, 2000),
          receivedAt: new Date().toISOString(),
        });
      }
    }

    // 2) Bridge: encontra bindings cujo padrão casa com o tópico recebido
    const matched: MqttBridgeBinding[] = [];
    for (const [pattern, list] of this.bindings) {
      if (this.topicMatches(pattern, topic)) matched.push(...list);
    }
    if (matched.length === 0) return;

    // Agrupa por deviceId e republica no tópico canônico
    const byDevice = new Map<string, Array<{ tag: string; value: number | null; unit: string | null }>>();
    for (const b of matched) {
      const value = this.extractValue(payload, b.jsonPath, b.valueType);
      const points = byDevice.get(b.deviceId) ?? [];
      points.push({ tag: b.tag, value, unit: b.unit });
      byDevice.set(b.deviceId, points);
    }

    const canonicalTopic = `bluebee/${this.tenantId}/gateway/${this.gatewayId}/telemetry`;
    for (const [deviceId, points] of byDevice) {
      // Métricas passivas do resumo de saúde (mensagens recebidas / pontos extraídos)
      this.pollingMetrics.recordBridgeMessage(
        deviceId,
        points.filter((p) => p.value !== null).length,
        points.length,
      );
      this.mqttService.publish(canonicalTopic, {
        timestamp: new Date().toISOString(),
        deviceId,
        points,
      });

      // Anti-duplicidade: se o próprio dispositivo publicou o NOVO estado do
      // ponto comandado enquanto a escrita aguardava confirmação, o bridge já
      // republicou o valor — a telemetria confirmada pós-escrita fica dispensada.
      // O valor precisa CASAR com o comandado (valor stale/antigo do mesmo tag
      // NÃO conta — senão suprimiríamos a publicação confirmada indevidamente).
      for (const session of this.writeSessions.values()) {
        const c = session.command.confirm;
        if (
          c &&
          c.deviceId === deviceId &&
          points.some((p) => p.tag === c.tag && p.value !== null && this.valuesMatch(p.value, c.value))
        ) {
          session.bridgePublished = true;
        }
      }
    }
  }

  /** Captura de amostra: assina o tópico, coleta por SAMPLE_WINDOW_MS e publica o resultado. */
  @OnEvent('command.mqtt.sample')
  handleSampleCommand(command: MqttSampleCommand): void {
    const topic = (command.topic ?? '').trim();
    // Aceita o namespace de sensores do gateway OU um namespace raiz próprio
    // de equipamento (fora de bluebee/ — anti-loop; o backend valida o escopo
    // exato do device). Nunca amostra tópicos internos bluebee/.
    const allowed =
      topic.startsWith(this.sensorPrefix) || (!!topic && !topic.startsWith('bluebee/'));
    if (!topic || !allowed) {
      this.publishSampleResult(command, false, [], `Tópico fora do escopo permitido (${this.sensorPrefix} ou raiz próprio do equipamento)`);
      return;
    }

    this.logger.log(`Amostra MQTT — escutando "${topic}" por ${SAMPLE_WINDOW_MS / 1000}s`);

    // Abre a conexão sob demanda se estiver fechada (site sem device MQTT).
    this.openConnection();

    const wasSubscribed = this.subscribed.has(topic);
    if (!wasSubscribed) {
      this.client?.subscribe(topic, { qos: 0 });
    }

    this.sampleSessions.set(command.command_id, { topic, samples: [] });

    setTimeout(() => {
      const session = this.sampleSessions.get(command.command_id);
      this.sampleSessions.delete(command.command_id);

      // Desassina se foi assinado só para a amostra (não é bridge persistente)
      if (!wasSubscribed && !this.bindings.has(topic) && !this.isSampling(topic)) {
        this.client?.unsubscribe(topic);
        this.subscribed.delete(topic);
      }

      const samples = session?.samples ?? [];
      this.publishSampleResult(command, true, samples);

      // Se a amostra abriu a conexão e não restou nenhum binding/amostra ativa,
      // fecha de novo para não deixar o 2º cliente pendurado no broker.
      this.closeConnectionIfIdle();
    }, SAMPLE_WINDOW_MS);
  }

  /**
   * Escrita num equipamento MQTT-nativo (ex.: relé Shelly Gen4 via RPC).
   *
   * Fluxo com confirmação (responseTopic presente): registra a sessão ANTES de
   * assinar/publicar (evita a corrida em que a resposta chega antes do registro),
   * assina o tópico de resposta, publica o comando e aguarda a resposta RPC
   * (casada por `id` quando matchId presente). Timeout → falha explícita.
   *
   * Fluxo sem confirmação: publica e reporta sucesso com confirmed=false
   * ("enviado") — o dispositivo não oferece canal de confirmação.
   */
  @OnEvent('command.mqtt.write')
  handleWriteCommand(command: MqttWriteCommand): void {
    const commandTopic = (command.commandTopic ?? '').trim();
    const responseTopic = (command.responseTopic ?? '')?.trim() || null;

    // Guard de namespace: comando e resposta vivem em .../sensors/ deste
    // gateway OU no namespace raiz próprio do equipamento (fora de bluebee/ —
    // anti-loop; o backend valida o escopo exato do device antes de despachar).
    const topicAllowed = (t: string): boolean =>
      t.startsWith(this.sensorPrefix) || !t.startsWith('bluebee/');
    if (!topicAllowed(commandTopic)) {
      this.publishWriteResult(command, false, `Tópico de comando fora do escopo permitido (${this.sensorPrefix} ou raiz próprio)`);
      return;
    }
    if (responseTopic && !topicAllowed(responseTopic)) {
      this.publishWriteResult(command, false, `Tópico de resposta fora do escopo permitido (${this.sensorPrefix} ou raiz próprio)`);
      return;
    }

    this.logger.log(
      `Escrita MQTT ${command.command_id} → ${commandTopic}` +
        (responseTopic ? ` (aguardando confirmação em ${responseTopic})` : ' (sem confirmação)'),
    );

    // Abre a conexão do bridge sob demanda (site pode não ter bridge ativo).
    this.openConnection();

    if (!responseTopic) {
      // Sem canal de confirmação: publica e reporta "enviado".
      this.client?.publish(commandTopic, command.payload, { qos: 1 }, (err) => {
        if (err) {
          this.publishWriteResult(command, false, `Falha ao publicar o comando: ${err.message}`);
        } else {
          this.publishWriteResult(command, true, undefined, false);
        }
        this.closeConnectionIfIdle();
      });
      return;
    }

    // Com confirmação: registra a sessão ANTES de assinar/publicar.
    const wasSubscribed = this.subscribed.has(responseTopic);
    const timer = setTimeout(() => {
      this.finishWriteSession(
        command.command_id,
        false,
        `Timeout - dispositivo não confirmou em ${WRITE_CONFIRM_TIMEOUT_MS / 1000}s`,
      );
    }, WRITE_CONFIRM_TIMEOUT_MS);

    this.writeSessions.set(command.command_id, {
      responseTopic,
      matchId: command.matchId ?? null,
      wasSubscribed,
      timer,
      command,
      bridgePublished: false,
    });

    if (!wasSubscribed) {
      this.client?.subscribe(responseTopic, { qos: 0 });
      this.subscribed.add(responseTopic);
    }

    this.client?.publish(commandTopic, command.payload, { qos: 1 }, (err) => {
      if (err) {
        this.finishWriteSession(command.command_id, false, `Falha ao publicar o comando: ${err.message}`);
      }
    });
  }

  /** Alimenta as sessões de escrita com uma mensagem recebida (confirmação RPC). */
  private feedWriteSessions(topic: string, payload: Buffer): void {
    if (this.writeSessions.size === 0) return;

    for (const [commandId, session] of this.writeSessions) {
      if (!this.topicMatches(session.responseTopic, topic)) continue;

      let parsed: Record<string, unknown> | null = null;
      try {
        const obj = JSON.parse(payload.toString()) as unknown;
        parsed = obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
      } catch {
        parsed = null;
      }

      // Com matchId, só aceita a resposta cujo `id` casa (RPC concorrente).
      if (session.matchId !== null) {
        if (!parsed || Number(parsed.id) !== session.matchId) continue;
      }

      // Resposta RPC com campo `error` = dispositivo recusou o comando.
      const rpcError = parsed?.error as { message?: unknown; code?: unknown } | undefined;
      if (rpcError) {
        const msg = typeof rpcError.message === 'string'
          ? rpcError.message
          : `Dispositivo recusou o comando (código ${String(rpcError.code ?? '?')})`;
        this.finishWriteSession(commandId, false, msg);
      } else {
        this.finishWriteSession(commandId, true, undefined, true);
      }
    }
  }

  /** Encerra uma sessão de escrita: limpa timer/assinatura e publica o resultado. */
  private finishWriteSession(
    commandId: string,
    success: boolean,
    error?: string,
    confirmed?: boolean,
  ): void {
    const session = this.writeSessions.get(commandId);
    if (!session) return; // já encerrada (timeout/resposta duplicada)

    this.writeSessions.delete(commandId);
    clearTimeout(session.timer);

    // Desassina o tópico de resposta se foi assinado só para esta escrita.
    const stillNeeded =
      session.wasSubscribed ||
      this.bindings.has(session.responseTopic) ||
      this.isSampling(session.responseTopic) ||
      [...this.writeSessions.values()].some((s) => s.responseTopic === session.responseTopic);
    if (!stillNeeded) {
      this.client?.unsubscribe(session.responseTopic);
      this.subscribed.delete(session.responseTopic);
    }

    this.publishWriteResult(session.command, success, error, confirmed);

    // Escrita confirmada pela resposta RPC: publica o valor comandado no tópico
    // canônico de telemetria (mesmo formato do bridge/polling) — os widgets
    // refletem o novo valor em ~1s, sem esperar a próxima publicação espontânea
    // do dispositivo. Espelha o publishConfirmedTelemetry do fluxo BACnet.
    // Pula quando o próprio dispositivo já publicou o novo estado (bridge já
    // republicou — sem duplicidade).
    if (success && confirmed === true && session.command.confirm && !session.bridgePublished) {
      this.publishConfirmedTelemetry(session.command);
    }

    this.closeConnectionIfIdle();
  }

  /**
   * Compara o valor republicado pelo bridge com o valor comandado. Tolerância
   * pequena para analógicos (ruído de float IEEE 754), igualdade exata para o
   * resto — mesmo racional do confirmByReadback do fluxo BACnet.
   */
  private valuesMatch(published: number, commanded: number): boolean {
    if (published === commanded) return true;
    const tolerance = Math.max(1e-6, Math.abs(commanded) * 0.001);
    return Math.abs(published - commanded) <= tolerance;
  }

  /** Publica o valor confirmado pós-escrita no tópico canônico de telemetria. */
  private publishConfirmedTelemetry(command: MqttWriteCommand): void {
    const c = command.confirm;
    if (!c) return;

    const topic = `bluebee/${command.tenant_id}/gateway/${command.gateway_id}/telemetry`;
    this.mqttService.publish(topic, {
      timestamp: new Date().toISOString(),
      deviceId: c.deviceId,
      points: [{ tag: c.tag, value: c.value, unit: c.unit }],
    });
    this.logger.log(
      `Telemetria imediata pós-escrita MQTT publicada — device=${c.deviceId} ${c.tag}=${c.value}`,
    );
  }

  /** Publica o resultado da escrita no tópico canônico de resultados de comando. */
  private publishWriteResult(
    command: MqttWriteCommand,
    success: boolean,
    error?: string,
    confirmed?: boolean,
  ): void {
    const topic = `bluebee/${command.tenant_id}/gateway/${command.gateway_id}/commands/result`;
    this.mqttService.publish(topic, {
      command_id: command.command_id,
      success,
      confirmed: confirmed === true,
      ...(error ? { error } : {}),
    });
    this.logger.log(
      `Escrita MQTT ${command.command_id} concluída — ` +
        (success ? `sucesso (${confirmed ? 'confirmada' : 'enviada'})` : `falhou: ${error}`),
    );
  }

  private publishSampleResult(
    command: MqttSampleCommand,
    success: boolean,
    samples: SampleSession['samples'],
    error?: string,
  ): void {
    const topic = `bluebee/${command.tenant_id}/gateway/${command.gateway_id}/mqtt/sample-result`;
    this.mqttService.publish(topic, {
      command_id: command.command_id,
      success,
      samples,
      ...(error ? { error } : {}),
    });
    this.logger.log(
      `Amostra MQTT concluída — ${success ? `${samples.length} mensagem(ns)` : `falhou: ${error}`}`,
    );
  }

  /** Há alguma sessão de amostra escutando este tópico? */
  private isSampling(topic: string): boolean {
    for (const s of this.sampleSessions.values()) {
      if (s.topic === topic) return true;
    }
    return false;
  }

  /** Casa um tópico recebido contra um padrão MQTT (suporta + e #). */
  private topicMatches(pattern: string, topic: string): boolean {
    if (pattern === topic) return true;
    const pp = pattern.split('/');
    const tp = topic.split('/');
    for (let i = 0; i < pp.length; i++) {
      if (pp[i] === '#') return true;
      if (pp[i] === '+') {
        if (tp[i] === undefined) return false;
        continue;
      }
      if (pp[i] !== tp[i]) return false;
    }
    return pp.length === tp.length;
  }

  /**
   * Extrai o valor do payload. Sem jsonPath → o payload é o valor cru. Com
   * jsonPath → navega o JSON (notação por ponto, com índices: "a.b[0].c").
   * Coage para number|boolean conforme valueType. Retorna null se indisponível.
   */
  private extractValue(
    payload: Buffer,
    jsonPath: string | null,
    valueType: 'number' | 'boolean',
  ): number | null {
    const text = payload.toString().trim();
    let raw: unknown;

    if (!jsonPath) {
      // Payload cru: tenta JSON (number/boolean), senão usa o texto
      try {
        raw = JSON.parse(text);
      } catch {
        raw = text;
      }
    } else {
      let obj: unknown;
      try {
        obj = JSON.parse(text);
      } catch {
        return null;
      }
      raw = this.resolvePath(obj, jsonPath);
    }

    return this.coerce(raw, valueType);
  }

  /** Navega um caminho tipo "a.b[0].c" (com "$." opcional) dentro do objeto. */
  private resolvePath(obj: unknown, path: string): unknown {
    const clean = path.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1');
    const parts = clean.split('.').filter((s) => s.length > 0);
    let cur: unknown = obj;
    for (const part of parts) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }

  /** Coage o valor bruto para number (0/1 no caso boolean). */
  private coerce(raw: unknown, valueType: 'number' | 'boolean'): number | null {
    if (raw === null || raw === undefined) return null;

    if (valueType === 'boolean') {
      if (typeof raw === 'boolean') return raw ? 1 : 0;
      const s = String(raw).trim().toLowerCase();
      if (['true', '1', 'on', 'ativo', 'yes'].includes(s)) return 1;
      if (['false', '0', 'off', 'inativo', 'no'].includes(s)) return 0;
      return null;
    }

    // Payloads booleanos (ex.: {"rele": true}) em pontos configurados como
    // 'number' (o default): coage para 0/1 em vez de Number("true") = NaN →
    // null — senão o ponto nunca resolve valor e os widgets ficam sem estado.
    if (typeof raw === 'boolean') return raw ? 1 : 0;
    const s = String(raw).trim().toLowerCase();
    if (s === 'true') return 1;
    if (s === 'false') return 0;
    const n = typeof raw === 'number' ? raw : Number(s);
    return Number.isFinite(n) ? n : null;
  }
}
