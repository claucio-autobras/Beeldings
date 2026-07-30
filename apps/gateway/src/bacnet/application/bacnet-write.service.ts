import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { NodeBacnetClient, BacnetTarget } from '../infrastructure/node-bacnet.client';
import { GatewayMqttService } from '../../mqtt/gateway-mqtt.service';

/**
 * Tipos BACnet com valor numérico contínuo — comparação de releitura usa
 * tolerância de float. AI=0, AO=1, AV=2, PC=24, LAV=46.
 */
const ANALOG_OBJECT_TYPES = new Set([0, 1, 2, 24, 46]);

/** BACnet application tags (ASHRAE 135 — Clause 20.2). */
const BACNET_TAG_UNSIGNED = 2;
const BACNET_TAG_SIGNED = 3;
const BACNET_TAG_REAL = 4;
const BACNET_TAG_DOUBLE = 5;
const BACNET_TAG_NULL = 0;
const BACNET_TAG_CHARACTER_STRING = 7;
const BACNET_TAG_ENUMERATED = 9;

/**
 * Application tag do presentValue por tipo de objeto (para WriteProperty):
 *   AI/AO/AV (0,1,2) → Real(4)
 *   ACC=23, PIV=48   → Unsigned(2)
 *   PC=24            → Real(4)
 *   CSV=40           → CharacterString(7)
 *   IV=45            → Signed(3)
 *   LAV=46           → Double(5)
 *   demais (BI/BO/BV/MSI/MSO/MSV) → Enumerated(9)
 */
const WRITE_TAG_BY_TYPE: Record<number, number> = {
  0: BACNET_TAG_REAL,
  1: BACNET_TAG_REAL,
  2: BACNET_TAG_REAL,
  23: BACNET_TAG_UNSIGNED,
  24: BACNET_TAG_REAL,
  40: BACNET_TAG_CHARACTER_STRING,
  45: BACNET_TAG_SIGNED,
  46: BACNET_TAG_DOUBLE,
  48: BACNET_TAG_UNSIGNED,
};

/**
 * Prioridade padrão para comandos de automação quando não especificada.
 * Nível 8 = Manual_Operator (ASHRAE Priority Array).
 */
const DEFAULT_PRIORITY = 8;

/**
 * Timeout por tentativa de WriteProperty (env BACNET_WRITE_TIMEOUT_MS).
 *
 * Um device "frio" (logo após o gateway subir, ou após ficar ocioso) costuma
 * perder o primeiro SimpleACK durante o ARP/address-binding inicial. O
 * node-bacnet NÃO retransmite nesse caso: o callback do write nunca dispara
 * mesmo que o controlador já tenha executado a escrita (a saída atua). Sem um
 * teto por tentativa o callback ficaria pendurado para sempre — por isso
 * rejeitamos após este prazo para liberar a próxima tentativa.
 */
const DEFAULT_WRITE_TIMEOUT_MS = 4000;

/**
 * Número máximo de tentativas de WriteProperty (env BACNET_WRITE_RETRIES).
 *
 * Como o WriteProperty é idempotente (reenviar o mesmo objeto/valor não causa
 * efeito colateral), reenviamos a mesma escrita quando o ACK se perde. O
 * padrão de 2 tentativas resolve o caso comum (1ª aquece o device, 2ª recebe
 * o ACK). Mínimo de 1.
 */
const DEFAULT_WRITE_RETRIES = 2;

/**
 * Payload do evento 'command.bacnet.write'.
 * Emitido pelo CommandDispatcherService ao receber um comando BACnet via MQTT.
 */
export interface BacnetWriteCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  /** IP do dispositivo BACnet de destino — ou do ROTEADOR quando net/adr presentes */
  ip: string;
  /** Porta UDP — normalmente 47808 */
  port: number;
  /** Rede BACnet remota (device MS/TP atrás de roteador) — null para BACnet/IP direto */
  net?: number | null;
  /** MAC do device na rede remota (ex: [12] em MS/TP) */
  adr?: number[] | null;
  /**
   * Tipo do objeto BACnet.
   * 0=AI, 1=AO, 2=AV, 3=BI, 4=BO, 5=BV, 13=MSI, 14=MSO, 19=MSV,
   * 23=ACC, 24=PC, 40=CSV, 45=IV, 46=LAV, 48=PIV
   */
  objectType: number;
  objectInstance: number;
  /**
   * Valor a escrever.
   * Digitais: 0 (inactive) ou 1 (active).
   * Analógicos: valor numérico no range do objeto.
   * `null` = relinquish (liberar o override na prioridade informada).
   */
  value: number | null;
  /**
   * Nível do Priority Array (1–16).
   * Padrão: 8 (Manual_Operator).
   * Não usar 1–3 (reservados para Life Safety).
   */
  priority?: number;
}

/**
 * Payload publicado no tópico de resultado do comando.
 *
 * Tópico: bluebee/{tenantId}/gateway/{gatewayId}/commands/result
 */
interface CommandResult {
  command_id: string;
  success: boolean;
  error: string | null;
}

/**
 * Ponto cadastrado de um device BACnet, conforme a config dinâmica do backend
 * (tópico .../config). Usado para resolver deviceId/tag/unit ao publicar a
 * telemetria imediata pós-escrita — payload idêntico ao do polling.
 */
interface KnownObject {
  tag: string;
  unit: string | null;
}

interface KnownDevice {
  deviceId: string;
  /** `objectType:objectInstance` → tag/unit do ponto cadastrado. */
  objects: Map<string, KnownObject>;
}

/**
 * Payload de telemetria — MESMO formato publicado pelo polling
 * (BacnetPollingService.pollDevice), para o backend/socket processarem igual.
 */
interface TelemetryPoint {
  tag: string;
  objectType: number;
  objectInstance: number;
  value: number | string | null;
  unit: string | null;
}

interface TelemetryPayload {
  timestamp: string;
  deviceId: string;
  points: TelemetryPoint[];
}

/**
 * BacnetWriteService
 *
 * Escuta eventos 'command.bacnet.write' emitidos pelo CommandDispatcherService
 * e executa a escrita via WriteProperty no dispositivo BACnet alvo.
 *
 * Seleção do application tag:
 *   - Analógicos (AI=0, AO=1, AV=2): tag=4 (Real)
 *   - Digitais/Enum (BI=3, BO=4, BV=5, MSI=13, MSO=14): tag=9 (Enumerated)
 *
 * Publica o resultado (sucesso ou falha) no tópico de retorno MQTT.
 */
@Injectable()
export class BacnetWriteService {
  private readonly logger = new Logger(BacnetWriteService.name);

  /**
   * Devices BACnet conhecidos (da config dinâmica do backend), keyed pela
   * mesma chave de rota do polling: `ip:porta[#net/adr]`. Usado apenas para
   * resolver deviceId/tag/unit ao publicar a telemetria imediata pós-escrita.
   */
  private readonly knownDevices = new Map<string, KnownDevice>();

  constructor(
    private readonly bacnetClient: NodeBacnetClient,
    private readonly mqttService: GatewayMqttService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Espelha a config dinâmica do backend (mesma mensagem consumida pelo
   * BacnetPollingService) para resolver o ponto cadastrado de uma escrita.
   */
  @OnEvent('mqtt.message')
  handleConfigMessage(event: { topic: string; message: Record<string, unknown> }): void {
    if (!event.topic.endsWith('/config')) {
      return;
    }
    const payload = event.message as unknown as {
      devices?: Array<{
        deviceId: string;
        protocol?: string;
        ip: string;
        port: number;
        net?: number | null;
        adr?: number[] | null;
        objects?: Array<{
          tag: string;
          objectType: number;
          objectInstance: number;
          unit?: string | null;
        }>;
      }>;
    };
    if (!Array.isArray(payload.devices)) {
      return;
    }

    this.knownDevices.clear();
    for (const d of payload.devices) {
      if (d.protocol && d.protocol !== 'bacnet') continue;
      const objects = new Map<string, KnownObject>();
      for (const obj of d.objects ?? []) {
        objects.set(`${obj.objectType}:${obj.objectInstance}`, {
          tag: obj.tag,
          unit: obj.unit ?? null,
        });
      }
      this.knownDevices.set(
        this.routeKey(d.ip, d.port, d.net ?? null, d.adr ?? null),
        { deviceId: d.deviceId, objects },
      );
    }
  }

  /** Chave de rota — mesma convenção do polling: `ip:porta[#net/adr]`. */
  private routeKey(
    ip: string,
    port: number,
    net: number | null,
    adr: number[] | null,
  ): string {
    const route =
      typeof net === 'number' && net > 0 ? `#${net}/${(adr ?? []).join('.')}` : '';
    return `${ip}:${port}${route}`;
  }

  @OnEvent('command.bacnet.write')
  async handleWriteCommand(command: BacnetWriteCommand): Promise<void> {
    this.logger.log(
      `Comando write recebido — command_id=${command.command_id} ` +
        `ip=${command.ip} objectType=${command.objectType} ` +
        `objectInstance=${command.objectInstance} value=${command.value}`,
    );

    const tenantId = command.tenant_id;
    const gatewayId =
      command.gateway_id ||
      this.configService.get<string>('GATEWAY_ID', 'gw-01');

    const resultTopic = `bluebee/${tenantId}/gateway/${gatewayId}/commands/result`;

    // Relinquish: value=null libera o override na prioridade informada. Envia-se
    // o application tag Null (0) sem valor — o presentValue volta ao controle de
    // prioridade mais baixa (ou ao Relinquish_Default).
    const isRelinquish = command.value === null;

    const applicationTag = isRelinquish
      ? BACNET_TAG_NULL
      : WRITE_TAG_BY_TYPE[command.objectType] ?? BACNET_TAG_ENUMERATED;
    // CharacterStringValue (40) recebe o valor como string. Relinquish envia null.
    const writeValue: number | string | null = isRelinquish
      ? null
      : applicationTag === BACNET_TAG_CHARACTER_STRING
        ? String(command.value)
        : command.value;

    const priority = command.priority ?? DEFAULT_PRIORITY;

    const writeTimeoutMs = this.configService.get<number>(
      'BACNET_WRITE_TIMEOUT_MS',
      DEFAULT_WRITE_TIMEOUT_MS,
    );
    const maxAttempts = Math.max(
      1,
      this.configService.get<number>(
        'BACNET_WRITE_RETRIES',
        DEFAULT_WRITE_RETRIES,
      ),
    );

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // WriteProperty é idempotente: reenviamos o mesmo objeto/valor a cada
        // tentativa. Se o 1º SimpleACK se perdeu (device frio), a 2ª tentativa
        // atinge o device já "aquecido" e recebe o ACK.
        await this.bacnetClient.writeProperty(
          this.commandDest(command),
          { type: command.objectType, instance: command.objectInstance },
          85, // presentValue
          [{ type: applicationTag, value: writeValue }],
          priority,
          writeTimeoutMs,
        );

        this.logger.log(
          `Write OK — command_id=${command.command_id} ` +
            `objectType=${command.objectType} instance=${command.objectInstance} ` +
            `value=${command.value} priority=${priority}` +
            (attempt > 1 ? ` (sucesso na tentativa ${attempt}/${maxAttempts})` : ''),
        );

        const result: CommandResult = {
          command_id: command.command_id,
          success: true,
          error: null,
        };

        this.mqttService.publish(resultTopic, result);

        // Escrita confirmada (SimpleACK): relê o presentValue e publica como
        // telemetria imediata — os widgets refletem o novo valor em ~1s, sem
        // esperar o próximo ciclo de polling.
        void this.publishPostWriteTelemetry(command);
        return;
      } catch (err) {
        lastError = err;
        const errorMessage = err instanceof Error ? err.message : String(err);

        this.logger.warn(
          `Write tentativa ${attempt}/${maxAttempts} falhou — ` +
            `command_id=${command.command_id} ip=${command.ip} ` +
            `objectType=${command.objectType} ` +
            `instance=${command.objectInstance}: ${errorMessage}`,
        );

        // O SimpleACK do WriteProperty frequentemente NÃO é recebido/reconhecido
        // pelo node-bacnet mesmo quando o controlador EXECUTA a escrita (a saída
        // atua). Como a LEITURA funciona (é o que alimenta a telemetria),
        // confirmamos relendo o presentValue: se já reflete o valor comandado, o
        // comando teve efeito e reportamos sucesso — eliminando o falso timeout
        // num comando que de fato funcionou. Retry sozinho não resolve quando o
        // ACK nunca chega; a releitura é a confirmação confiável.
        //
        // Relinquish (value=null) NÃO é confirmável por releitura: o presentValue
        // volta ao valor de prioridade mais baixa (desconhecido aqui) — comparar
        // com null daria 0 e casaria por acidente com uma leitura 0. Nesse caso
        // dependemos apenas do SimpleACK; se não veio, seguimos para retry/falha.
        const readback = isRelinquish ? null : await this.confirmByReadback(command);
        if (readback?.confirmed) {
          this.logger.log(
            `Write confirmado por releitura (sem SimpleACK) — ` +
              `command_id=${command.command_id} ` +
              `instance=${command.objectInstance} value=${command.value} ` +
              `(tentativa ${attempt}/${maxAttempts})`,
          );

          const result: CommandResult = {
            command_id: command.command_id,
            success: true,
            error: null,
          };

          this.mqttService.publish(resultTopic, result);

          // O valor já foi confirmado por releitura — publica-o como telemetria
          // imediata, sem esperar o próximo ciclo de polling.
          this.publishConfirmedTelemetry(command, readback.value);
          return;
        }
      }
    }

    const errorMessage =
      lastError instanceof Error ? lastError.message : String(lastError);

    this.logger.error(
      `Write FALHOU após ${maxAttempts} tentativa(s) — ` +
        `command_id=${command.command_id} ip=${command.ip} ` +
        `objectType=${command.objectType} ` +
        `instance=${command.objectInstance}: ${errorMessage}`,
    );

    const result: CommandResult = {
      command_id: command.command_id,
      success: false,
      error: errorMessage,
    };

    this.mqttService.publish(resultTopic, result);
  }

  /**
   * Confirma uma escrita relendo o presentValue do objeto e comparando com o
   * valor comandado. É o fallback quando o SimpleACK do WriteProperty não é
   * recebido (o node-bacnet não retransmite e alguns devices não geram um ACK
   * que a lib reconheça), mas a LEITURA — que alimenta a telemetria — funciona.
   *
   * Digitais (BI/BO/BV/MSI/MSO): igualdade exata (0/1 ou número do estado).
   * Analógicos (AI/AO/AV): tolerância para floats IEEE 754.
   */
  private async confirmByReadback(
    command: BacnetWriteCommand,
  ): Promise<{ confirmed: boolean; value: number } | null> {
    const value = await this.readPresentValue(command);
    if (value === null) {
      return null;
    }

    const target = Number(command.value);

    if (ANALOG_OBJECT_TYPES.has(command.objectType)) {
      // tolerância: 1% do alvo ou 0.5, o que for maior (ruído de float/escala)
      const tolerance = Math.max(0.5, Math.abs(target) * 0.01);
      return { confirmed: Math.abs(value - target) <= tolerance, value };
    }

    return { confirmed: value === target, value };
  }

  /**
   * Relê o presentValue do objeto comandado (com folga para o device assentar).
   * Retorna o valor numérico lido, ou null se a leitura falhou/não é numérica.
   */
  private async readPresentValue(
    command: BacnetWriteCommand,
  ): Promise<number | null> {
    // pequena folga para o device assentar o presentValue antes da releitura
    await new Promise((resolve) => setTimeout(resolve, 300));

    const response = await this.bacnetClient.readPropertySafe(
      this.commandDest(command),
      { type: command.objectType, instance: command.objectInstance },
      85, // presentValue
      2000,
    );

    if (response === null) {
      return null;
    }

    // Mesma extração usada pelo polling: { values: [{ value }] }
    const rawValue = (response as { values?: Array<{ value: unknown }> })
      ?.values?.[0]?.value;

    if (rawValue === undefined || rawValue === null) {
      return null;
    }

    const readNumber = Number(rawValue);
    return Number.isFinite(readNumber) ? readNumber : null;
  }

  /**
   * Após uma escrita confirmada por SimpleACK: relê o presentValue e publica o
   * valor confirmado como telemetria imediata. Se a releitura falhar, apenas
   * loga — o polling normal atualiza no próximo ciclo.
   */
  private async publishPostWriteTelemetry(
    command: BacnetWriteCommand,
  ): Promise<void> {
    try {
      const value = await this.readPresentValue(command);
      if (value === null) {
        this.logger.debug(
          `Releitura pós-escrita sem valor — telemetria imediata ignorada ` +
            `(command_id=${command.command_id})`,
        );
        return;
      }
      this.publishConfirmedTelemetry(command, value);
    } catch (err) {
      this.logger.warn(
        `Falha na telemetria imediata pós-escrita (command_id=${command.command_id}): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Publica o valor confirmado pelo readback no tópico CANÔNICO de telemetria,
   * com payload idêntico ao do polling — o backend/socket propagam a atualização
   * de imediato e os widgets refletem o novo valor em ~1s.
   *
   * Requer o ponto na config dinâmica (deviceId/tag/unit); sem match, ignora —
   * o polling normal cobre no próximo ciclo.
   */
  private publishConfirmedTelemetry(
    command: BacnetWriteCommand,
    value: number,
  ): void {
    const device = this.knownDevices.get(
      this.routeKey(command.ip, command.port, command.net ?? null, command.adr ?? null),
    );
    const obj = device?.objects.get(
      `${command.objectType}:${command.objectInstance}`,
    );
    if (!device || !obj) {
      this.logger.debug(
        `Ponto comandado fora da config dinâmica — telemetria imediata ignorada ` +
          `(${command.ip}:${command.port} ${command.objectType}:${command.objectInstance})`,
      );
      return;
    }

    const tenantId = command.tenant_id;
    const gatewayId =
      command.gateway_id || this.configService.get<string>('GATEWAY_ID', 'gw-01');
    const topic = `bluebee/${tenantId}/gateway/${gatewayId}/telemetry`;

    const payload: TelemetryPayload = {
      timestamp: new Date().toISOString(),
      deviceId: device.deviceId,
      points: [
        {
          tag: obj.tag,
          objectType: command.objectType,
          objectInstance: command.objectInstance,
          value,
          unit: obj.unit,
        },
      ],
    };

    this.mqttService.publish(topic, payload);
    this.logger.log(
      `Telemetria imediata pós-escrita publicada — device=${device.deviceId} ` +
        `${obj.tag}=${value}`,
    );
  }

  /**
   * Destino BACnet do comando — inclui porta não-padrão e a rota net/adr
   * (NPDU DNET/DADR) quando o device é MS/TP atrás de roteador BACnet.
   */
  private commandDest(command: BacnetWriteCommand): BacnetTarget {
    const address =
      command.port && command.port !== 47808 && !command.ip.includes(':')
        ? `${command.ip}:${command.port}`
        : command.ip;
    return {
      address,
      net: typeof command.net === 'number' && command.net > 0 ? command.net : null,
      adr: Array.isArray(command.adr) && command.adr.length > 0 ? command.adr : null,
    };
  }
}
