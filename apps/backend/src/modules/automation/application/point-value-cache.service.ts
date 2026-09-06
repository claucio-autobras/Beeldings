import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MqttService } from '../../mqtt/mqtt.service.js';
import type { BacnetTelemetryPayload } from '../../mqtt/telemetry.gateway.js';

/** Idade máxima (ms) de um valor para ser considerado "fresco". */
const FRESHNESS_MS = 120_000;

interface CachedValue {
  value: number | boolean | string;
  at: number;
}

/** Identidade de ponto para consulta ao cache. */
interface PointLookup {
  /** Número de objeto BACnet, quando aplicável (undefined em Modbus/MQTT). */
  objectType?: number;
  /** Instância BACnet / registrador Modbus / índice MQTT. */
  instance: number;
  /** Tag canônica do ponto (sempre presente). */
  tag: string;
}

/**
 * Mantém em memória o ÚLTIMO valor de cada ponto, alimentado pelo stream de
 * telemetria MQTT. A telemetria NÃO é persistida — flui em memória; este cache
 * serve à avaliação de condições do runner de automação.
 *
 * Chaveamento DUPLO (mesmo valor indexado por duas chaves):
 * - `deviceId:objectType:objectInstance` — identidade BACnet canônica (spec);
 *   usada quando o ponto tem um objectType BACnet numérico.
 * - `deviceId::tag` — fallback cross-protocolo, pois Modbus/MQTT não expõem
 *   objectType BACnet; a `tag` sempre acompanha a telemetria (mesmo casamento
 *   do motor de alarmes).
 *
 * A consulta tenta primeiro a chave BACnet e, na ausência, cai para a `tag`.
 *
 * Auto-contido: assina o tópico de telemetria por conta própria e não toca no
 * MqttModule/subscriber existente.
 */
@Injectable()
export class PointValueCacheService implements OnModuleInit {
  private readonly logger = new Logger(PointValueCacheService.name);
  private readonly cache = new Map<string, CachedValue>();

  constructor(private readonly mqtt: MqttService) {}

  onModuleInit(): void {
    this.mqtt.subscribe('bluebee/+/gateway/+/telemetry', 0);
    this.mqtt.onMessage((topic, payload) => {
      if (!topic.endsWith('/telemetry')) return;
      this.ingest(payload);
    });
    this.logger.log('PointValueCacheService inicializado — cacheando telemetria em memória');
  }

  private keyByObject(deviceId: string, objectType: number, instance: number): string {
    return `${deviceId}:${objectType}:${instance}`;
  }

  private keyByTag(deviceId: string, tag: string): string {
    return `${deviceId}::${tag}`;
  }

  private ingest(rawPayload: Buffer): void {
    let data: BacnetTelemetryPayload;
    try {
      data = JSON.parse(rawPayload.toString()) as BacnetTelemetryPayload;
    } catch {
      return;
    }
    if (!data.deviceId || !Array.isArray(data.points)) return;
    const now = Date.now();
    for (const p of data.points) {
      if (p.value === undefined || p.value === null) continue;
      const entry: CachedValue = { value: p.value, at: now };
      // Chave BACnet canônica (spec) quando há objectType/objectInstance numéricos.
      if (typeof p.objectType === 'number' && typeof p.objectInstance === 'number') {
        this.cache.set(this.keyByObject(data.deviceId, p.objectType, p.objectInstance), entry);
      }
      // Chave por tag (fallback cross-protocolo).
      if (typeof p.tag === 'string' && p.tag) {
        this.cache.set(this.keyByTag(data.deviceId, p.tag), entry);
      }
    }
  }

  /**
   * Retorna o último valor conhecido do ponto se recente (idade < 120s); senão
   * `undefined` (telemetria ausente/velha — o runner faz skip gracioso).
   * Tenta a identidade BACnet (`objectType:instance`) e cai para a `tag`.
   */
  get(deviceId: string, lookup: PointLookup): number | boolean | string | undefined {
    let hit: CachedValue | undefined;
    if (lookup.objectType !== undefined) {
      hit = this.cache.get(this.keyByObject(deviceId, lookup.objectType, lookup.instance));
    }
    if (!hit) {
      hit = this.cache.get(this.keyByTag(deviceId, lookup.tag));
    }
    if (!hit) return undefined;
    if (Date.now() - hit.at > FRESHNESS_MS) return undefined;
    return hit.value;
  }
}
