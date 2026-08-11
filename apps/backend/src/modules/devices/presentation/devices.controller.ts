import {
  ForbiddenException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EXCLUDE_NON_BMS_DEVICES, ONLY_CFTV_DEVICES } from '../../prisma/device-filters.js';
import { BacnetDiscoveryService } from '../application/bacnet-discovery.service.js';
import { BacnetNetworkDiscoveryService } from '../application/bacnet-network-discovery.service.js';
import { BacnetWriteService } from '../application/bacnet-write.service.js';
import { MqttWriteService } from '../application/mqtt-write.service.js';
import { resolveMqttWriteTarget } from '../application/mqtt-write-target.util.js';
import { ModbusWriteService } from '../application/modbus-write.service.js';
import {
  resolveModbusWriteTarget,
  type ResolvedModbusWriteTarget,
} from '../application/modbus-write-target.util.js';
import { DeviceConfigPublisherService } from '../application/device-config-publisher.service.js';
import { ModbusConnectionService } from '../application/modbus-connection.service.js';
import type { ModbusConnectionResult, ModbusSerialConfig, TestModbusConnectionDto } from '../domain/dtos/test-modbus.dto.js';
import { normalizeModbusSerial } from '../domain/dtos/test-modbus.dto.js';
import { MqttSampleService } from '../application/mqtt-sample.service.js';
import type { MqttSampleResult, SampleMqttTopicDto } from '../domain/dtos/sample-mqtt.dto.js';
import { EmqxProvisioningService } from '../../sites/application/emqx-provisioning.service.js';
import { DeviceStatusService } from '../../mqtt/device-status.service.js';
import { DeviceHeartbeatService } from '../../mqtt/device-heartbeat.service.js';
import { randomBytes } from 'crypto';
import type { BacnetDiscoveryResult, DiscoverBacnetDto } from '../domain/dtos/discover-bacnet.dto.js';
import type { BacnetScanResult, ScanBacnetDto } from '../domain/dtos/scan-bacnet.dto.js';
import type { BacnetWriteResult, WriteBacnetDto } from '../domain/dtos/write-bacnet.dto.js';
import type { MqttWriteBinding, MqttWriteResult, WriteMqttDto } from '../domain/dtos/write-mqtt.dto.js';
import type { ModbusWriteResult, WriteModbusDto } from '../domain/dtos/write-modbus.dto.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DefaultTrendsService } from '../../trends/default-trends.service.js';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { SensitiveActionGuard } from '../../auth/presentation/guards/sensitive-action.guard.js';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard.js';
import { Roles } from '../../auth/presentation/decorators/roles.decorator.js';
import { CurrentUser } from '../../auth/presentation/decorators/current-user.decorator.js';
import { UserRole } from '../../auth/domain/interfaces/auth.interface.js';
import { repairMojibake } from '../../../common/mojibake-repair.util.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import type { Prisma } from '@prisma/client';
import { resolveBodyTenantScope, resolveTenantScope } from '../../auth/presentation/tenant-scope.util.js';

type DeviceWithRelations = Prisma.DeviceGetPayload<{
  include: { points: true; site: true };
}>;

/** Ponto descoberto enviado pelo frontend ao sincronizar. */
interface SyncPointInput {
  objectType: string;
  instance: number;
  objectName: string;
  tag: string;
  unit?: string;
}

/** Registrador Modbus informado manualmente pelo frontend. */
interface ModbusPointInput {
  tag: string;
  displayName?: string;
  register: number;
  registerType?: 'holding' | 'input' | 'coil' | 'discrete';
  dataType?: 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32';
  endianness?: 'big' | 'little';
  scale?: number;
  offset?: number;
  unit?: string;
}

/** Ponto MQTT-nativo informado pelo frontend (bridge). */
interface MqttPointInput {
  tag: string;
  displayName?: string;
  sourceTopic: string;
  jsonPath?: string;
  valueType?: 'number' | 'boolean';
  unit?: string;
  /** Opcional — binding de escrita (ponto comandável, ex.: relé Shelly, Aeris). */
  write?: {
    commandTopic: string;
    payloadTemplate: string;
    responseTopic?: string | null;
    /** Confirmar pelo valor ecoado em vez de campo `id` RPC (ex.: Aeris sp_val1). */
    matchByValue?: boolean;
  } | null;
}

/**
 * Config MQTT do device persistida em Device.config (Json — mesmo padrão do
 * Modbus/SNMP/ONVIF). `topicMode: 'root'` = equipamento sem suporte a prefixo,
 * publicando no próprio namespace raiz (ex.: `008065/...`).
 */
interface MqttDeviceConfigJson {
  topicMode?: 'prefix' | 'root';
  rootTopic?: string;
  heartbeatTopic?: string | null;
  heartbeatTimeoutSeconds?: number | null;
  /** Credencial dedicada provisionada no EMQX (modo raiz). */
  deviceMqttUser?: string;
  deviceMqttPass?: string;
}

/** Janela default do heartbeat (s) quando o usuário não informa. */
const DEFAULT_HEARTBEAT_TIMEOUT_S = 90;

@Controller('devices')
export class DevicesController {
  private readonly logger = new Logger(DevicesController.name);

  constructor(
    private readonly bacnetDiscovery: BacnetDiscoveryService,
    private readonly bacnetNetworkDiscovery: BacnetNetworkDiscoveryService,
    private readonly bacnetWrite: BacnetWriteService,
    private readonly mqttWrite: MqttWriteService,
    private readonly modbusWrite: ModbusWriteService,
    private readonly prisma: PrismaService,
    private readonly configPublisher: DeviceConfigPublisherService,
    private readonly modbusConnection: ModbusConnectionService,
    private readonly mqttSample: MqttSampleService,
    private readonly emqxProvisioning: EmqxProvisioningService,
    private readonly deviceStatus: DeviceStatusService,
    private readonly deviceHeartbeat: DeviceHeartbeatService,
    private readonly defaultTrends: DefaultTrendsService,
  ) {}

  /**
   * GET /devices/:id/heartbeat
   * Diagnóstico do último heartbeat do dispositivo MQTT (RSSI, IP, uptime),
   * memória (esta instância) com fallback durável em devices.last_heartbeat
   * (sobrevive a restart/cluster). `null` só quando nunca recebido.
   */
  @Get(':id/heartbeat')
  @UseGuards(JwtAuthGuard)
  async getDeviceHeartbeat(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Dispositivo não encontrado');
    const scope = resolveTenantScope(user);
    if (scope && device.tenantId !== scope) {
      throw new ForbiddenException('Sem permissão para ver este dispositivo');
    }
    return { heartbeat: await this.deviceHeartbeat.get(id) };
  }

  @Get('/')
  @UseGuards(JwtAuthGuard)
  async getDevices(
    @CurrentUser() user: AuthenticatedUser,
    @Query('tenantId') tenantId?: string,
  ) {
    const effectiveTenantId = resolveTenantScope(user, tenantId);

    const devices = await this.prisma.device.findMany({
      where: {
        ...(effectiveTenantId ? { tenantId: effectiveTenantId } : {}),
        ...EXCLUDE_NON_BMS_DEVICES,
      },
      orderBy: { name: 'asc' },
      include: { points: true, site: true },
    });

    // Mapeia para o formato esperado pelo frontend (mesmo shape do create).
    // "Visto por último" com fallback durável (status_events/telemetria) para
    // sobreviver a reinícios do backend — nunca datas de cadastro.
    const lastSeenMap = await this.deviceStatus.resolveLastSeenMany(
      devices.map((d) => d.id),
    );
    return devices.map((device) =>
      this.mapDevice(device, lastSeenMap.get(device.id) ?? null),
    );
  }

  /** Mapeia um device do Prisma para o shape esperado pelo frontend. */
  private mapDevice(device: DeviceWithRelations, lastCommunication: string | null) {
    // Status REAL derivado da última telemetria recebida (não o status persistido,
    // que desatualiza): online se houve telemetria recente, senão offline.
    const liveStatus = this.deviceStatus.getStatus(device.id);

    return {
      // Config de tópico dos devices MQTT — a tela de detalhe (aberta a partir
      // da lista) precisa dela p/ montar o tópico no modal "Adicionar Ponto"
      // (modo raiz) e p/ o card de credencial/heartbeat.
      ...(device.protocol === 'mqtt'
        ? { mqttConfig: this.buildMqttConfigView(device) }
        : {}),
      id: device.id,
      name: device.name,
      protocol: device.protocol,
      site: device.site?.name ?? '',
      siteId: device.siteId,
      tenantId: device.tenantId,
      gatewayId: device.gatewayId,
      ip: device.ip,
      port: device.port,
      status: liveStatus,
      critical: device.critical,
      lastCommunication,
      points: device.protocol === 'modbus'
        ? device.points.map((p) => this.modbusPointView(p))
        : device.protocol === 'mqtt'
        ? device.points.map((p) => this.mqttPointView(p))
        : device.points.map((p) => ({
            id: p.id,
            tag: p.tag,
            objectName: p.objectName,
            objectType: p.objectType,
            instance: p.instance,
            unit: p.unit ?? '',
            critical: p.critical,
            opRole: p.opRole ?? null,
            value: false,
            status: 'normal',
            lastUpdate: p.createdAt.toISOString(),
          })),
    };
  }

  /** Mapeia um DevicePoint Modbus para o shape de ponto esperado pelo frontend (lê o binding). */
  private modbusPointView(p: {
    id: string;
    tag: string;
    objectName: string;
    instance: number;
    unit: string | null;
    binding: unknown;
    critical: boolean;
    opRole?: string | null;
    createdAt: Date;
  }) {
    const b = (p.binding ?? {}) as {
      register?: number;
      registerType?: string;
      dataType?: string;
      scale?: number;
      offset?: number;
      minExpected?: number;
      maxExpected?: number;
    };
    return {
      id: p.id,
      tag: p.tag,
      displayName: p.objectName,
      register: b.register ?? p.instance,
      registerType: b.registerType ?? 'holding',
      dataType: b.dataType ?? 'float32',
      scale: b.scale ?? 1,
      offset: b.offset ?? 0,
      ...(b.minExpected !== undefined ? { minExpected: b.minExpected } : {}),
      ...(b.maxExpected !== undefined ? { maxExpected: b.maxExpected } : {}),
      unit: p.unit ?? '',
      critical: p.critical,
      opRole: p.opRole ?? null,
      value: 0,
      status: 'normal',
      lastUpdate: p.createdAt.toISOString(),
    };
  }

  /** Carrega um device com relações e o mapeia para o shape do frontend. */
  private async loadDeviceResponse(id: string) {
    const device = await this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: { points: true, site: true },
    });
    return this.mapDevice(device, await this.deviceStatus.resolveLastSeen(device.id));
  }

  /**
   * Converte um registrador Modbus do frontend para o dado de criação do DevicePoint.
   * A config específica de Modbus vive no campo `binding` (Json); `instance` recebe
   * o número do registrador para manter a unicidade [deviceId, objectType, instance].
   */
  private toModbusPointData(p: ModbusPointInput): Prisma.DevicePointCreateManyDeviceInput {
    return {
      tag: p.tag,
      objectName: p.displayName ?? p.tag,
      objectType: 'modbus',
      instance: p.register,
      unit: p.unit ?? '',
      binding: {
        register: p.register,
        registerType: p.registerType ?? 'holding',
        dataType: p.dataType ?? 'float32',
        endianness: p.endianness ?? 'big',
        scale: p.scale ?? 1,
        offset: p.offset ?? 0,
      },
    };
  }

  /**
   * Prefixo onde os sensores MQTT de um gateway devem publicar. Fica DENTRO do
   * namespace do tenant (`bluebee/{tenant}/gateway/{gateway}/sensors/`), que a ACL
   * do gateway já permite ler — garante isolamento por tenant sem usuário amplo.
   */
  private sensorTopicPrefix(tenantId: string, gatewayId: string): string {
    return `bluebee/${tenantId}/gateway/${gatewayId}/sensors/`;
  }

  /**
   * Guard: o tópico de origem de um ponto MQTT precisa estar sob o escopo do
   * dispositivo — o prefixo de sensores do gateway (modo padrão) OU o tópico
   * raiz próprio do equipamento (modo raiz). Isso (a) garante o isolamento por
   * tenant via ACL e (b) evita loop, pois fica fora dos tópicos internos.
   */
  private assertSafeSourceTopic(topic: string, scopePrefix: string): void {
    const t = (topic ?? '').trim();
    if (!t) {
      throw new BadRequestException('sourceTopic é obrigatório para pontos MQTT');
    }
    if (!t.startsWith(scopePrefix)) {
      throw new BadRequestException(
        `sourceTopic deve estar sob "${scopePrefix}" (escopo deste dispositivo): ${t}`,
      );
    }
  }

  /** Lê a config MQTT persistida do device (Json). */
  private mqttDeviceConfig(device: { config: unknown }): MqttDeviceConfigJson {
    return (device.config ?? {}) as MqttDeviceConfigJson;
  }

  /**
   * Prefixo de escopo dos tópicos de um device MQTT: `{rootTopic}/` no modo
   * raiz; senão o namespace de sensores do gateway.
   */
  private mqttTopicScope(tenantId: string, gatewayId: string, cfg: MqttDeviceConfigJson): string {
    if (cfg.topicMode === 'root' && cfg.rootTopic) {
      return `${cfg.rootTopic}/`;
    }
    return this.sensorTopicPrefix(tenantId, gatewayId);
  }

  /**
   * Valida o formato de um tópico raiz próprio: sem wildcards (+/#), sem `$`
   * inicial, sem barras nas pontas/segmentos vazios e fora do namespace
   * interno `bluebee/…`. Retorna o valor normalizado (trim).
   */
  private validateRootTopicFormat(rootTopic: string): string {
    const root = (rootTopic ?? '').trim().replace(/\/+$/, '');
    if (!root) {
      throw new BadRequestException('Informe o tópico raiz do equipamento');
    }
    if (root.includes('+') || root.includes('#')) {
      throw new BadRequestException('O tópico raiz não pode conter wildcards (+ ou #)');
    }
    if (root.startsWith('$')) {
      throw new BadRequestException('O tópico raiz não pode começar com "$" (tópicos de sistema)');
    }
    if (root.startsWith('/') || root.split('/').some((s) => s.length === 0)) {
      throw new BadRequestException('O tópico raiz não pode ter barras no início/fim nem segmentos vazios');
    }
    if (root === 'bluebee' || root.startsWith('bluebee/')) {
      throw new BadRequestException('O tópico raiz não pode usar o namespace interno "bluebee"');
    }
    return root;
  }

  /**
   * Unicidade GLOBAL do tópico raiz (entre todos os tenants/gateways), incluindo
   * sobreposição de namespace: um raiz não pode ser prefixo de outro nem
   * vice-versa (ex.: `008065` × `008065/sala`), senão dois dispositivos
   * disputariam as mesmas mensagens.
   */
  private async assertRootTopicAvailable(rootTopic: string, excludeDeviceId?: string): Promise<void> {
    const others = await this.prisma.device.findMany({
      where: { protocol: 'mqtt', ...(excludeDeviceId ? { NOT: { id: excludeDeviceId } } : {}) },
      select: { id: true, name: true, config: true },
    });
    for (const other of others) {
      const otherRoot = this.mqttDeviceConfig(other).rootTopic?.trim();
      if (!otherRoot) continue;
      if (
        otherRoot === rootTopic ||
        otherRoot.startsWith(`${rootTopic}/`) ||
        rootTopic.startsWith(`${otherRoot}/`)
      ) {
        throw new ConflictException(
          `O tópico raiz "${rootTopic}" conflita com o do dispositivo "${other.name}" ("${otherRoot}") — o raiz precisa ser único na plataforma`,
        );
      }
    }
  }

  /**
   * Autoriza um tópico raiz candidato para CAPTURA DE AMOSTRA: as mesmas
   * regras de conflito de `assertRootTopicAvailable`, exceto que um raiz já
   * pertencente a um device do PRÓPRIO tenant+gateway do chamador é permitido
   * (caso "adicionar ponto a um device raiz existente"). Qualquer conflito com
   * device de outro tenant/gateway é negado — isolamento multi-tenant.
   */
  private async assertRootTopicUsableForSampling(
    rootTopic: string,
    tenantId: string,
    gatewayId: string,
  ): Promise<void> {
    const others = await this.prisma.device.findMany({
      where: { protocol: 'mqtt' },
      select: { id: true, name: true, config: true, tenantId: true, gatewayId: true },
    });
    for (const other of others) {
      const otherRoot = this.mqttDeviceConfig(other).rootTopic?.trim();
      if (!otherRoot) continue;
      const overlaps =
        otherRoot === rootTopic ||
        otherRoot.startsWith(`${rootTopic}/`) ||
        rootTopic.startsWith(`${otherRoot}/`);
      if (!overlaps) continue;
      if (other.tenantId === tenantId && other.gatewayId === gatewayId) continue;
      throw new ConflictException(
        `O tópico raiz "${rootTopic}" conflita com um dispositivo já cadastrado — o raiz precisa ser único na plataforma`,
      );
    }
  }

  /**
   * Valida os campos de heartbeat/presença: tópico dentro do escopo do
   * dispositivo (sem wildcards) e janela em segundos (15–3600). Retorna o par
   * normalizado, ou `{ topic: null }` quando o heartbeat está sendo removido.
   */
  private validateHeartbeat(
    topic: string | null | undefined,
    timeoutSeconds: number | null | undefined,
    scopePrefix: string,
  ): { heartbeatTopic: string | null; heartbeatTimeoutSeconds: number | null } {
    const t = (topic ?? '').trim();
    if (!t) return { heartbeatTopic: null, heartbeatTimeoutSeconds: null };
    if (t.includes('+') || t.includes('#')) {
      throw new BadRequestException('O tópico de presença não pode conter wildcards (+ ou #)');
    }
    if (!t.startsWith(scopePrefix)) {
      throw new BadRequestException(
        `O tópico de presença deve estar sob "${scopePrefix}" (escopo deste dispositivo): ${t}`,
      );
    }
    const window = timeoutSeconds == null ? DEFAULT_HEARTBEAT_TIMEOUT_S : Number(timeoutSeconds);
    if (!Number.isFinite(window) || window < 15 || window > 3600) {
      throw new BadRequestException('A janela do heartbeat deve estar entre 15 e 3600 segundos');
    }
    return { heartbeatTopic: t, heartbeatTimeoutSeconds: Math.round(window) };
  }

  /** Tópicos que o dispositivo em modo raiz precisa ASSINAR (comandos dos pontos). */
  private deviceCommandSubscribeTopics(points: Array<{ binding: unknown }>): string[] {
    const topics: string[] = [];
    for (const p of points) {
      const b = (p.binding ?? {}) as { write?: MqttWriteBinding | null };
      if (b.write?.commandTopic?.trim()) topics.push(b.write.commandTopic.trim());
    }
    return topics;
  }

  /** Todos os tópicos raiz dos devices MQTT de um gateway (p/ ACL de subscribe do gateway). */
  private async collectRootTopicsForGateway(tenantId: string, gatewayId: string): Promise<string[]> {
    const devices = await this.prisma.device.findMany({
      where: { tenantId, gatewayId, protocol: 'mqtt' },
      select: { config: true },
    });
    return devices
      .map((d) => this.mqttDeviceConfig(d).rootTopic?.trim())
      .filter((t): t is string => !!t);
  }

  /**
   * Re-sincroniza as ACLs de um device MQTT em modo raiz: a do usuário dedicado
   * do equipamento (subscribe nos comandos dos pontos) e a do usuário do
   * gateway (subscribe nos namespaces raiz). Best-effort: falha vira warning,
   * nunca quebra o cadastro.
   */
  private async syncRootModeAcls(device: {
    id: string; tenantId: string; gatewayId: string | null; config: unknown;
  }, points: Array<{ binding: unknown }>): Promise<void> {
    const cfg = this.mqttDeviceConfig(device);
    if (cfg.topicMode !== 'root' || !cfg.rootTopic || !device.gatewayId) return;
    try {
      await this.emqxProvisioning.syncRootDeviceAcl(
        device.id,
        cfg.rootTopic,
        this.deviceCommandSubscribeTopics(points),
      );
      const roots = await this.collectRootTopicsForGateway(device.tenantId, device.gatewayId);
      await this.emqxProvisioning.applyGatewayRootAcl(device.gatewayId, device.tenantId, roots);
    } catch (err) {
      this.logger.warn(`Falha ao sincronizar ACLs do modo raiz de ${device.id}: ${(err as Error).message}`);
    }
  }

  /**
   * Converte um ponto MQTT do frontend para o dado de criação do DevicePoint.
   * `instance` recebe um índice incremental só para satisfazer a unicidade
   * [deviceId, objectType, instance] — a chave real do ponto vive no binding.
   */
  private toMqttPointData(
    p: MqttPointInput,
    index: number,
    scopePrefix: string,
  ): Prisma.DevicePointCreateManyDeviceInput {
    this.assertSafeSourceTopic(p.sourceTopic, scopePrefix);
    const write = this.sanitizeWriteBinding(p.write, scopePrefix);
    return {
      tag: p.tag,
      objectName: p.displayName ?? p.tag,
      objectType: 'mqtt',
      instance: index,
      unit: p.unit ?? '',
      binding: {
        sourceTopic: p.sourceTopic.trim(),
        jsonPath: p.jsonPath?.trim() || null,
        valueType: p.valueType ?? 'number',
        ...(write ? { write } : {}),
      } as unknown as Prisma.InputJsonValue,
    };
  }

  /**
   * Valida e normaliza o binding de escrita de um ponto MQTT comandável.
   * Ambos os tópicos (comando e resposta) precisam estar sob o escopo do
   * dispositivo (prefixo de sensores ou tópico raiz) — mesma regra do sourceTopic.
   */
  private sanitizeWriteBinding(
    write: MqttPointInput['write'],
    scopePrefix: string,
  ): MqttWriteBinding | null {
    if (!write) return null;
    const commandTopic = (write.commandTopic ?? '').trim();
    const payloadTemplate = (write.payloadTemplate ?? '').trim();
    const responseTopic = (write.responseTopic ?? '')?.trim() || null;
    if (!commandTopic && !payloadTemplate) return null;

    if (!commandTopic || !payloadTemplate) {
      throw new BadRequestException(
        'Binding de escrita incompleto: commandTopic e payloadTemplate são obrigatórios',
      );
    }
    if (!payloadTemplate.includes('{{value}}')) {
      throw new BadRequestException(
        'payloadTemplate precisa conter o placeholder {{value}}',
      );
    }
    if (!commandTopic.startsWith(scopePrefix)) {
      throw new BadRequestException(
        `commandTopic deve estar sob "${scopePrefix}" (escopo deste dispositivo): ${commandTopic}`,
      );
    }
    if (responseTopic && !responseTopic.startsWith(scopePrefix)) {
      throw new BadRequestException(
        `responseTopic deve estar sob "${scopePrefix}" (escopo deste dispositivo): ${responseTopic}`,
      );
    }
    return {
      commandTopic,
      payloadTemplate,
      responseTopic,
      ...(write.matchByValue === true ? { matchByValue: true } : {}),
    };
  }

  /** Mapeia um DevicePoint MQTT para o shape de ponto esperado pelo frontend (lê o binding). */
  private mqttPointView(p: {
    id: string;
    tag: string;
    objectName: string;
    instance: number;
    unit: string | null;
    binding: unknown;
    critical: boolean;
    opRole?: string | null;
    createdAt: Date;
    lastValue?: number | null;
    lastValueAt?: Date | null;
    lastValueState?: string | null;
  }) {
    const b = (p.binding ?? {}) as {
      sourceTopic?: string;
      jsonPath?: string | null;
      valueType?: string;
      write?: MqttWriteBinding | null;
    };
    const write = b.write?.commandTopic && b.write?.payloadTemplate
      ? {
          commandTopic: b.write.commandTopic,
          payloadTemplate: b.write.payloadTemplate,
          responseTopic: b.write.responseTopic ?? null,
          matchByValue: b.write.matchByValue === true ? true : undefined,
        }
      : null;
    return {
      id: p.id,
      tag: p.tag,
      displayName: p.objectName,
      sourceTopic: b.sourceTopic ?? '',
      jsonPath: b.jsonPath ?? '',
      valueType: b.valueType ?? 'number',
      unit: p.unit ?? '',
      critical: p.critical,
      opRole: p.opRole ?? null,
      write,
      value: 0,
      status: 'normal',
      lastUpdate: p.createdAt.toISOString(),
      // Último valor persistido (seed da UI até a telemetria ao vivo chegar).
      // null = nunca houve leitura → a UI mantém "Aguardando leitura…".
      lastValue: p.lastValue ?? null,
      lastValueAt: p.lastValueAt ? p.lastValueAt.toISOString() : null,
      lastValueState: p.lastValueState ?? null,
    };
  }

  /**
   * Monta o bloco `mqttConfig` (modo de tópico, heartbeat e credencial)
   * exposto ao frontend. Compartilhado entre o create/update (mapMqttDevice)
   * e a listagem GET /devices (mapDevice) — a tela de detalhe depende dele
   * para montar o tópico correto no modal "Adicionar Ponto".
   */
  private buildMqttConfigView(device: { config: unknown }) {
    const cfg = this.mqttDeviceConfig(device);
    const topicMode = cfg.topicMode === 'root' ? 'root' : 'prefix';
    return {
      topicMode,
      rootTopic: topicMode === 'root' ? (cfg.rootTopic ?? null) : null,
      heartbeatTopic: cfg.heartbeatTopic ?? null,
      heartbeatTimeoutSeconds: cfg.heartbeatTopic ? (cfg.heartbeatTimeoutSeconds ?? DEFAULT_HEARTBEAT_TIMEOUT_S) : null,
      // Credencial dedicada do equipamento (modo raiz) — exibida na UI como
      // a credencial de sensores do modo prefixo.
      credential:
        topicMode === 'root' && cfg.deviceMqttUser && cfg.deviceMqttPass
          ? {
              username: cfg.deviceMqttUser,
              password: cfg.deviceMqttPass,
              broker: process.env.MQTT_BROKER_URL ?? null,
              topicPrefix: `${cfg.rootTopic ?? ''}/`,
            }
          : null,
    };
  }

  /** Mapeia um device MQTT (com pontos) para o shape esperado pelo frontend. */
  private async mapMqttDevice(
    device: Prisma.DeviceGetPayload<{ include: { points: true } }>,
    siteName: string,
  ) {
    return {
      mqttConfig: this.buildMqttConfigView(device),
      id: device.id,
      name: device.name,
      protocol: device.protocol,
      site: siteName,
      siteId: device.siteId,
      tenantId: device.tenantId,
      gatewayId: device.gatewayId,
      ip: device.ip,
      port: device.port,
      status: this.deviceStatus.getStatus(device.id),
      lastCommunication: await this.deviceStatus.resolveLastSeen(device.id),
      points: device.points.map((p) => this.mqttPointView(p)),
    };
  }

  /** Mapeia um device Modbus (com pontos) para o shape esperado pelo frontend. */
  private async mapModbusDevice(
    device: Prisma.DeviceGetPayload<{ include: { points: true } }>,
    siteName: string,
    equipmentType?: string,
  ) {
    const cfg = (device.config ?? {}) as {
      connectionType?: 'tcp' | 'rtu';
      serial?: ModbusSerialConfig;
      unitId?: number;
      pollingIntervalMs?: number;
      equipmentType?: string;
    };
    return {
      id: device.id,
      name: device.name,
      protocol: device.protocol,
      site: siteName,
      siteId: device.siteId,
      tenantId: device.tenantId,
      gatewayId: device.gatewayId,
      ip: device.ip,
      port: device.port,
      // Configs antigas sem connectionType são TCP.
      connectionType: cfg.connectionType === 'rtu' ? 'rtu' : 'tcp',
      ...(cfg.serial ? { serial: cfg.serial } : {}),
      unitId: cfg.unitId ?? 1,
      pollingInterval: cfg.pollingIntervalMs ? cfg.pollingIntervalMs / 1000 : 15,
      equipmentType: equipmentType ?? cfg.equipmentType ?? '',
      status: this.deviceStatus.getStatus(device.id),
      lastCommunication: await this.deviceStatus.resolveLastSeen(device.id),
      points: device.points.map((p) => this.modbusPointView(p)),
    };
  }

  /**
   * POST /devices/discover-bacnet
   *
   * Triggers a BACnet discovery via MQTT command to the target gateway.
   * Waits up to 15 seconds for the gateway to respond with the list of objects.
   */
  @Post('bacnet')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async createBacnetDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: {
      name: string;
      site: string;
      siteId: string;
      tenantId: string;
      gatewayId?: string;
      ip: string;
      port: number;
      protocol: 'bacnet';
      /** Instância BACnet do device (retornada pelo discovery) */
      deviceInstance?: number;
      /** Rota BACnet (device MS/TP atrás de roteador) — retornada pelo discovery/scan */
      net?: number | null;
      adr?: number[] | null;
      selectedPoints: Array<{
        objectType: string;
        instance: number;
        objectName: string;
        tag: string;
        unit?: string;
      }>;
    },
  ) {
    const tenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!tenantId) {
      throw new BadRequestException('tenantId é obrigatório');
    }

    // Config BACnet persistida (Json): rota net/adr + instância do device —
    // consumida pelo DeviceConfigPublisher (polling/COV) e pelas escritas.
    const net = typeof body.net === 'number' && body.net > 0 ? body.net : null;
    const adr = Array.isArray(body.adr) && body.adr.length > 0 ? body.adr : null;
    const bacnetConfig: Record<string, unknown> = {};
    if (typeof body.deviceInstance === 'number' && body.deviceInstance >= 0) {
      bacnetConfig.deviceInstance = body.deviceInstance;
    }
    if (net) {
      bacnetConfig.net = net;
      bacnetConfig.adr = adr;
    }

    const device = await this.prisma.device.create({
      data: {
        name: body.name,
        protocol: 'bacnet',
        ip: body.ip,
        port: body.port,
        status: 'offline',
        tenantId,
        siteId: body.siteId || null,
        gatewayId: body.gatewayId || null,
        ...(Object.keys(bacnetConfig).length > 0
          ? { config: bacnetConfig as Prisma.InputJsonValue }
          : {}),
        points: {
          create: body.selectedPoints.map((p) => ({
            tag: p.tag,
            objectName: repairMojibake(p.objectName ?? p.tag),
            objectType: String(p.objectType),
            instance: p.instance,
            unit: p.unit ?? '',
          })),
        },
      },
      include: { points: true },
    });

    // Publica a config de polling atualizada para o gateway ler os novos pontos
    await this.configPublisher.publishForDevice(device.id);
    // Cobertura padrão de histórico (best-effort; nunca quebra o cadastro)
    await this.defaultTrends.applyDefaultsForDevice(device.id);

    // Mapeia para o formato esperado pelo frontend
    return {
      id: device.id,
      name: device.name,
      protocol: device.protocol,
      site: body.site,
      siteId: device.siteId,
      tenantId: device.tenantId,
      gatewayId: device.gatewayId,
      ip: device.ip,
      port: device.port,
      status: device.status,
      // Dispositivo recém-cadastrado: nenhuma comunicação real ainda.
      lastCommunication: null,
      points: device.points.map((p) => ({
        id: p.id,
        tag: p.tag,
        objectName: p.objectName,
        objectType: p.objectType,
        instance: p.instance,
        unit: p.unit ?? '',
        value: false,
        status: 'normal',
        lastUpdate: p.createdAt.toISOString(),
      })),
    };
  }

  /**
   * POST /devices/modbus/test-connection
   * Valida a comunicação Modbus TCP com o equipamento via gateway ANTES do
   * cadastro de registradores. O gateway tenta abrir o socket e responde.
   */
  @Post('modbus/test-connection')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async testModbusConnection(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TestModbusConnectionDto,
  ): Promise<ModbusConnectionResult> {
    const scopedTenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!scopedTenantId || String(scopedTenantId).trim() === '') {
      throw new BadRequestException('tenantId é obrigatório');
    }
    body = { ...body, tenantId: scopedTenantId };
    await this.assertGatewayInTenant(String(body.gatewayId ?? ''), scopedTenantId);
    if (!body.gatewayId || String(body.gatewayId).trim() === '') {
      throw new BadRequestException('gatewayId é obrigatório');
    }

    const isRtu = body.connectionType === 'rtu';
    let serial: ModbusSerialConfig | undefined;
    if (isRtu) {
      try {
        serial = normalizeModbusSerial(body.serial);
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
    } else {
      if (!body.ip || String(body.ip).trim() === '') {
        throw new BadRequestException('ip é obrigatório');
      }
      if (!body.port || body.port <= 0 || body.port > 65535) {
        throw new BadRequestException('port deve ser um número válido (1-65535)');
      }
    }

    const unitId = Number(body.unitId ?? 1);
    if (!Number.isInteger(unitId) || unitId < 1 || unitId > 247) {
      throw new BadRequestException('Unit ID deve ser um inteiro entre 1 e 247');
    }

    return this.modbusConnection.testConnection({
      tenantId: body.tenantId,
      gatewayId: body.gatewayId,
      connectionType: isRtu ? 'rtu' : 'tcp',
      ip: body.ip,
      port: body.port != null ? Number(body.port) : undefined,
      unitId,
      ...(serial ? { serial } : {}),
    });
  }

  /**
   * POST /devices/mqtt/sensor-credential
   * Garante (cria sob demanda) e retorna a credencial MQTT DEDICADA que o
   * equipamento deve usar para publicar — escopada por ACL em
   * `bluebee/{tenant}/gateway/{gateway}/sensors/#` (publish-only). Não dá ao
   * sensor acesso aos tópicos de comando/config/telemetria do gateway.
   */
  @Post('mqtt/sensor-credential')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async ensureSensorCredential(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { tenantId: string; gatewayId: string },
  ): Promise<{ username: string; password: string; broker: string | null; topicPrefix: string }> {
    if (!body.gatewayId || String(body.gatewayId).trim() === '') {
      throw new BadRequestException('gatewayId é obrigatório');
    }
    const isGlobal = user.role === 'ADMIN' || user.role === 'CCO';
    const tenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!tenantId) {
      throw new BadRequestException('tenantId é obrigatório');
    }

    const gateway = await this.prisma.gateway.findFirst({
      where: { id: body.gatewayId, tenantId },
    });
    if (!gateway) {
      throw new NotFoundException('Gateway não encontrado para este tenant');
    }

    let username = gateway.sensorMqttUser;
    let password = gateway.sensorMqttPass;

    // Gera e provisiona na primeira vez; depois é estável (não reseta a senha).
    if (!username || !password) {
      username = `${gateway.id}-sensors`;
      password = randomBytes(16).toString('hex');
      await this.emqxProvisioning.provisionSensorUser(gateway.id, gateway.tenantId, password);
      await this.prisma.gateway.update({
        where: { id: gateway.id },
        data: { sensorMqttUser: username, sensorMqttPass: password },
      });
      this.logger.log(`Credencial de sensor provisionada para o gateway ${gateway.id}`);
    }

    return {
      username,
      password,
      broker: process.env.MQTT_BROKER_URL ?? null,
      topicPrefix: this.sensorTopicPrefix(gateway.tenantId, gateway.id),
    };
  }

  /**
   * POST /devices/mqtt/sample-topic
   * Pede ao gateway para escutar um tópico MQTT-nativo por alguns segundos e
   * devolver uma amostra do payload — para o usuário ver a estrutura e escolher
   * o jsonPath. Recusa tópicos dentro de `bluebee/` (guard anti-loop).
   */
  @Post('mqtt/sample-topic')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async sampleMqttTopic(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SampleMqttTopicDto,
  ): Promise<MqttSampleResult> {
    const sampleTenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!sampleTenantId || String(sampleTenantId).trim() === '') {
      throw new BadRequestException('tenantId é obrigatório');
    }
    body = { ...body, tenantId: sampleTenantId };
    if (!body.gatewayId || String(body.gatewayId).trim() === '') {
      throw new BadRequestException('gatewayId é obrigatório');
    }
    await this.assertGatewayInTenant(body.gatewayId, sampleTenantId);

    // Modo raiz: a captura escuta o namespace raiz do equipamento (fora de
    // bluebee/). O gateway precisa de ACL de subscribe nesse raiz — aplicamos
    // aqui (candidato + raízes já cadastradas) para a amostra funcionar ANTES
    // do cadastro do dispositivo.
    const rootTopic = (body.rootTopic ?? '').trim();
    if (rootTopic) {
      const root = this.validateRootTopicFormat(rootTopic);
      this.assertSafeSourceTopic(body.topic, `${root}/`);
      // Autorização do raiz ANTES de qualquer ACL: o candidato não pode
      // pertencer/colidir com um device de outro tenant/gateway — senão a
      // amostra viraria um canal de espionagem de tópicos alheios.
      await this.assertRootTopicUsableForSampling(root, sampleTenantId, body.gatewayId);
      const roots = await this.collectRootTopicsForGateway(sampleTenantId, body.gatewayId);
      const alreadyRegistered = roots.some((r) => r === root || root.startsWith(`${r}/`));
      try {
        await this.emqxProvisioning.applyGatewayRootAcl(body.gatewayId, sampleTenantId, [...roots, root]);
      } catch (err) {
        this.logger.warn(`Falha ao liberar ACL de amostra para raiz ${root}: ${(err as Error).message}`);
      }
      try {
        return await this.mqttSample.sampleTopic({
          tenantId: body.tenantId,
          gatewayId: body.gatewayId,
          topic: body.topic.trim(),
        });
      } finally {
        // Raiz ainda não cadastrado: reverte a ACL para o conjunto canônico ao
        // fim da amostra (o cadastro do device reaplica com o raiz definitivo).
        if (!alreadyRegistered) {
          void this.emqxProvisioning
            .applyGatewayRootAcl(body.gatewayId, sampleTenantId, roots)
            .catch((err: Error) =>
              this.logger.warn(`Falha ao reverter ACL de amostra da raiz ${root}: ${err.message}`),
            );
        }
      }
    }
    this.assertSafeSourceTopic(body.topic, this.sensorTopicPrefix(body.tenantId, body.gatewayId));

    return this.mqttSample.sampleTopic({
      tenantId: body.tenantId,
      gatewayId: body.gatewayId,
      topic: body.topic.trim(),
    });
  }

  /**
   * POST /devices/mqtt
   * Cadastra um dispositivo MQTT-nativo. O gateway faz o bridge: assina os
   * sourceTopic dos pontos, extrai o valor por jsonPath e republica no tópico
   * canônico. Sem discovery — pontos informados manualmente (com captura de amostra).
   */
  @Post('mqtt')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async createMqttDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: {
      name: string;
      site: string;
      siteId: string;
      tenantId: string;
      gatewayId?: string;
      selectedPoints: Array<MqttPointInput>;
      /** Modo de tópico: 'prefix' (padrão atual) ou 'root' (tópico raiz próprio). */
      topicMode?: 'prefix' | 'root';
      /** Tópico raiz próprio do equipamento (obrigatório no modo 'root'). */
      rootTopic?: string;
      /** Tópico de presença/heartbeat (opcional em ambos os modos). */
      heartbeatTopic?: string | null;
      heartbeatTimeoutSeconds?: number | null;
    },
  ) {
    const tenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!tenantId) {
      throw new BadRequestException('tenantId é obrigatório');
    }

    const gatewayId = body.gatewayId;
    if (!gatewayId) {
      throw new BadRequestException('gatewayId é obrigatório para dispositivos MQTT (faz o bridge dos tópicos)');
    }

    const points = body.selectedPoints ?? [];
    // Modo raiz: pontos são adicionados depois (credencial precisa existir primeiro).
    const isRootMode = body.topicMode === 'root';
    if (points.length === 0 && !isRootMode) {
      throw new BadRequestException('Informe ao menos um ponto MQTT');
    }

    // Modo de tópico: valida raiz (formato + unicidade global) e heartbeat.
    let rootTopic: string | null = null;
    if (isRootMode) {
      rootTopic = this.validateRootTopicFormat(body.rootTopic ?? '');
      await this.assertRootTopicAvailable(rootTopic);
    }
    const scopePrefix = isRootMode
      ? `${rootTopic}/`
      : this.sensorTopicPrefix(tenantId, gatewayId);
    const heartbeat = this.validateHeartbeat(
      body.heartbeatTopic,
      body.heartbeatTimeoutSeconds,
      scopePrefix,
    );

    const config: MqttDeviceConfigJson = {
      topicMode: isRootMode ? 'root' : 'prefix',
      ...(rootTopic ? { rootTopic } : {}),
      heartbeatTopic: heartbeat.heartbeatTopic,
      heartbeatTimeoutSeconds: heartbeat.heartbeatTimeoutSeconds,
    };

    let device = await this.prisma.device.create({
      data: {
        name: body.name,
        protocol: 'mqtt',
        ip: '',
        port: 0,
        status: 'offline',
        tenantId,
        siteId: body.siteId || null,
        gatewayId,
        config: config as Prisma.InputJsonValue,
        points: {
          create: points.map((p, i) => this.toMqttPointData(p, i, scopePrefix)),
        },
      },
      include: { points: true },
    });

    // Modo raiz: provisiona a credencial DEDICADA do equipamento (ACL restrita
    // a publicar sob o raiz e assinar só os tópicos de comando) e libera o
    // subscribe do gateway nos namespaces raiz. Best-effort: sem EMQX
    // configurado só loga (mesmo padrão da credencial de sensores).
    if (isRootMode && rootTopic) {
      const password = randomBytes(16).toString('hex');
      try {
        await this.emqxProvisioning.provisionRootDeviceUser(
          device.id,
          password,
          rootTopic,
          this.deviceCommandSubscribeTopics(device.points),
        );
        const roots = await this.collectRootTopicsForGateway(tenantId, gatewayId);
        await this.emqxProvisioning.applyGatewayRootAcl(gatewayId, tenantId, roots);
        device = await this.prisma.device.update({
          where: { id: device.id },
          data: {
            config: {
              ...config,
              deviceMqttUser: this.emqxProvisioning.deviceUsername(device.id),
              deviceMqttPass: password,
            } as Prisma.InputJsonValue,
          },
          include: { points: true },
        });
        this.logger.log(`Credencial dedicada provisionada para o dispositivo raiz ${device.id}`);
      } catch (err) {
        this.logger.error(`Falha ao provisionar credencial do dispositivo raiz ${device.id}: ${(err as Error).message}`);
      }
    }

    // Publica o mapa de bridge para o gateway assinar os tópicos
    await this.configPublisher.publishForDevice(device.id);
    // Cobertura padrão de histórico (best-effort; nunca quebra o cadastro)
    await this.defaultTrends.applyDefaultsForDevice(device.id);

    return this.mapMqttDevice(device, body.site);
  }

  @Post('modbus')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async createModbusDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: {
      name: string;
      site: string;
      siteId: string;
      tenantId: string;
      gatewayId?: string;
      equipmentType?: string;
      connectionType?: 'tcp' | 'rtu';
      ip?: string;
      port?: number;
      serial?: unknown;
      unitId: number;
      pollingInterval: number;
      protocol: 'modbus';
      selectedPoints: Array<ModbusPointInput>;
    },
  ) {
    const tenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!tenantId) {
      throw new BadRequestException('tenantId é obrigatório');
    }

    const isRtu = body.connectionType === 'rtu';
    let serial: ModbusSerialConfig | undefined;
    if (isRtu) {
      try {
        serial = normalizeModbusSerial(body.serial);
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
    } else if (!body.ip || String(body.ip).trim() === '') {
      throw new BadRequestException('ip é obrigatório no modo TCP');
    }

    const device = await this.prisma.device.create({
      data: {
        name: body.name,
        protocol: 'modbus',
        // No modo RTU o "endereço" é a porta serial (espelhada em ip p/ exibição).
        ip: isRtu ? serial!.path : body.ip!,
        port: isRtu ? 0 : (body.port || 502),
        status: 'offline',
        tenantId,
        siteId: body.siteId || null,
        gatewayId: body.gatewayId || null,
        // Config do device específica de Modbus (lida pelo gateway no polling)
        config: {
          connectionType: isRtu ? 'rtu' : 'tcp',
          ...(serial ? { serial: { ...serial } } : {}),
          unitId: body.unitId ?? 1,
          pollingIntervalMs: (body.pollingInterval ?? 15) * 1000,
          ...(body.equipmentType ? { equipmentType: body.equipmentType } : {}),
        },
        points: {
          create: (body.selectedPoints ?? []).map((p) => this.toModbusPointData(p)),
        },
      },
      include: { points: true },
    });

    // Publica a config de polling Modbus para o gateway ler os registradores
    await this.configPublisher.publishForDevice(device.id);
    // Cobertura padrão de histórico (best-effort; nunca quebra o cadastro)
    await this.defaultTrends.applyDefaultsForDevice(device.id);

    return this.mapModbusDevice(device, body.site, body.equipmentType);
  }

  /**
   * POST /devices/:id/points
   * Adiciona registradores manualmente a um device Modbus (Modbus não tem
   * discovery — os pontos são cadastrados a partir do mapa do fabricante).
   * Ignora duplicados e republica a config para o gateway ler os novos registradores.
   */
  @Post(':id/points')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async addPoints(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { points?: Array<ModbusPointInput | MqttPointInput> },
  ) {
    const device = await this.prisma.device.findUnique({
      where: { id },
      include: { points: true },
    });
    if (!device) throw new NotFoundException('Dispositivo não encontrado');

    const isGlobal = user.role === 'ADMIN' || user.role === 'CCO';
    if (!isGlobal && device.tenantId !== user.tenantId) {
      throw new BadRequestException('Sem permissão para editar este dispositivo');
    }

    if (device.protocol !== 'modbus' && device.protocol !== 'mqtt') {
      throw new BadRequestException(
        'Adição manual de pontos suportada apenas para dispositivos Modbus e MQTT',
      );
    }

    if (device.protocol === 'mqtt' && !device.gatewayId) {
      throw new BadRequestException('Dispositivo MQTT sem gateway — não é possível adicionar pontos');
    }

    const points = body.points ?? [];
    if (points.length > 0) {
      let data: Prisma.DevicePointCreateManyInput[];
      if (device.protocol === 'mqtt') {
        const scopePrefix = this.mqttTopicScope(
          device.tenantId,
          device.gatewayId as string,
          this.mqttDeviceConfig(device),
        );
        data = this.buildMqttPointsData(id, device.points, points as MqttPointInput[], scopePrefix);
      } else {
        const modbusPoints = points as ModbusPointInput[];
        // Detecta conflito com o índice único [deviceId, objectType, instance]
        // (para Modbus, instance = registrador) ANTES de criar, para reportar
        // 409 em vez de o skipDuplicates engolir a violação silenciosamente.
        const existingRegisters = new Set(
          device.points.filter((p) => p.objectType === 'modbus').map((p) => p.instance),
        );
        for (const p of modbusPoints) {
          if (existingRegisters.has(p.register)) {
            throw new ConflictException(
              `Já existe um ponto com o registrador ${p.register} neste dispositivo`,
            );
          }
        }
        data = modbusPoints.map((p) => ({ deviceId: id, ...this.toModbusPointData(p) }));
      }

      await this.prisma.devicePoint.createMany({ data, skipDuplicates: true });
      this.logger.log(`${points.length} ponto(s) ${device.protocol} adicionado(s) em ${id}`);
    }

    await this.configPublisher.publishForDevice(id);
    // Cobertura padrão de histórico para os pontos recém-adicionados
    await this.defaultTrends.applyDefaultsForDevice(id);

    const updated = await this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: { points: true, site: true },
    });

    // Modo raiz: os pontos comandáveis mudaram → re-sincroniza a ACL de
    // subscribe da credencial dedicada do equipamento.
    if (device.protocol === 'mqtt') {
      await this.syncRootModeAcls(updated, updated.points);
    }

    return device.protocol === 'mqtt'
      ? this.mapMqttDevice(updated, updated.site?.name ?? '')
      : this.mapModbusDevice(updated, updated.site?.name ?? '');
  }

  /** Monta os dados de criação de pontos MQTT, continuando o índice (instance) após os existentes. */
  private buildMqttPointsData(
    deviceId: string,
    existing: Array<{ instance: number }>,
    points: MqttPointInput[],
    scopePrefix: string,
  ): Prisma.DevicePointCreateManyInput[] {
    const maxInstance = existing.reduce((max, p) => Math.max(max, p.instance), -1);
    return points.map((p, i) => ({ deviceId, ...this.toMqttPointData(p, maxInstance + 1 + i, scopePrefix) }));
  }

  /**
   * POST /devices/scan-bacnet
   *
   * Triggers a BACnet network scan (Who-Is broadcast) via MQTT command to the
   * target gateway. Waits up to ~20 seconds for the gateway to respond with
   * the list of controllers found on its local network (IP, instance, vendor/model).
   */
  /** Garante que o par tenant/gateway confere e que o usuário pode usá-lo. */
  private async assertGatewayInTenant(gatewayId: string, tenantId: string): Promise<void> {
    const gw = await this.prisma.gateway.findFirst({
      where: { id: gatewayId, tenantId },
      select: { id: true },
    });
    if (!gw) {
      throw new ForbiddenException('Gateway não pertence ao cliente informado');
    }
  }

  @Post('scan-bacnet')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async scanBacnet(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ScanBacnetDto,
  ): Promise<BacnetScanResult> {
    if (!body.tenantId || body.tenantId.trim() === '') {
      throw new BadRequestException('tenantId e obrigatorio');
    }
    if (!body.gatewayId || body.gatewayId.trim() === '') {
      throw new BadRequestException('gatewayId e obrigatorio');
    }

    // Papel de cliente: só pode escanear no próprio tenant; o gateway
    // informado precisa pertencer ao tenant efetivo.
    const scanTenantId = resolveBodyTenantScope(user, body.tenantId) ?? body.tenantId;
    if (scanTenantId !== body.tenantId) {
      throw new ForbiddenException('tenantId não corresponde ao seu cliente');
    }
    await this.assertGatewayInTenant(body.gatewayId, scanTenantId);

    this.logger.log(
      `BACnet network scan request — tenant: ${body.tenantId}, gateway: ${body.gatewayId}`,
    );

    try {
      return await this.bacnetNetworkDiscovery.scanBacnet(body);
    } catch (err) {
      const msg = (err as Error).message ?? 'Erro interno no scan de rede';
      this.logger.error(`Unhandled scan error: ${msg}`);
      return { success: false, error: msg };
    }
  }

  @Post('discover-bacnet')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async discoverBacnet(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DiscoverBacnetDto,
  ): Promise<BacnetDiscoveryResult> {
    if (!body.tenantId || body.tenantId.trim() === '') {
      throw new BadRequestException('tenantId e obrigatorio');
    }
    if (!body.gatewayId || body.gatewayId.trim() === '') {
      throw new BadRequestException('gatewayId e obrigatorio');
    }
    if (!body.ip || body.ip.trim() === '') {
      throw new BadRequestException('ip e obrigatorio');
    }
    if (!body.port || body.port <= 0 || body.port > 65535) {
      throw new BadRequestException('port deve ser um numero valido (1-65535)');
    }
    // deviceInstance é opcional — se omitido, o gateway descobre via Who-Is automaticamente
    if (body.deviceInstance !== undefined && body.deviceInstance < 0) {
      throw new BadRequestException('deviceInstance deve ser um numero nao negativo');
    }

    const discTenantId = resolveBodyTenantScope(user, body.tenantId) ?? body.tenantId;
    if (discTenantId !== body.tenantId) {
      throw new ForbiddenException('tenantId não corresponde ao seu cliente');
    }
    await this.assertGatewayInTenant(body.gatewayId, discTenantId);

    this.logger.log(
      `BACnet discovery request — tenant: ${body.tenantId}, gateway: ${body.gatewayId}, ` +
      `device: ${body.ip}:${body.port}` +
      (body.deviceInstance !== undefined ? ` instance ${body.deviceInstance}` : ' (instância via Who-Is)'),
    );

    try {
      return await this.bacnetDiscovery.discoverBacnet(body);
    } catch (err) {
      const msg = (err as Error).message ?? 'Erro interno no discovery';
      this.logger.error(`Unhandled discovery error: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * POST /devices/bacnet/write
   *
   * Sends a BACnet write-property command via MQTT to the target gateway.
   * Waits up to 10 seconds for the gateway to confirm execution.
   */
  /**
   * DELETE /devices/:id
   * Exclui um dispositivo e todos os seus pontos. Apenas ADMIN ou CCO.
   */
  /**
   * PATCH /devices/:id
   * Atualiza os campos editáveis do dispositivo (nome, site, IP, porta).
   * Campos específicos de protocolo que não existem no schema (deviceInstance,
   * equipmentType, unitId, pollingInterval) são ignorados.
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async updateDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      siteId?: string;
      ip?: string;
      port?: number;
      // Campos específicos de Modbus (ignorados nos demais protocolos)
      unitId?: number;
      pollingInterval?: number;
      serial?: unknown;
      // Ativo crítico (card de Ativos Críticos do dashboard).
      critical?: boolean;
      // Campos específicos de MQTT: presença/heartbeat (null limpa o heartbeat).
      heartbeatTopic?: string | null;
      heartbeatTimeoutSeconds?: number | null;
    },
  ) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Dispositivo não encontrado');

    const isGlobal = user.role === 'ADMIN' || user.role === 'CCO';
    if (!isGlobal && device.tenantId !== user.tenantId) {
      throw new BadRequestException('Sem permissão para editar este dispositivo');
    }

    if (body.siteId) {
      const site = await this.prisma.site.findFirst({
        where: { id: body.siteId, tenantId: device.tenantId },
      });
      if (!site) throw new BadRequestException('Site inválido para este dispositivo');
    }

    // Modbus: atualiza também unitId/pollingInterval/serial dentro de config.
    // O modo de conexão (tcp/rtu) NÃO muda na edição — só os parâmetros do modo.
    let modbusConfigPatch: Record<string, unknown> | null = null;
    let serialPathMirror: string | null = null;
    if (device.protocol === 'modbus') {
      const cfg = (device.config ?? {}) as Record<string, unknown>;
      const isRtu = cfg.connectionType === 'rtu';
      const patch: Record<string, unknown> = {};
      if (body.unitId != null) {
        const unitId = Number(body.unitId);
        if (!Number.isInteger(unitId) || unitId < 1 || unitId > 247) {
          throw new BadRequestException('Unit ID deve ser um inteiro entre 1 e 247');
        }
        patch.unitId = unitId;
      }
      if (body.pollingInterval != null && Number(body.pollingInterval) > 0) {
        patch.pollingIntervalMs = Number(body.pollingInterval) * 1000;
      }
      if (isRtu && body.serial != null) {
        try {
          const serial = normalizeModbusSerial(body.serial);
          patch.serial = { ...serial };
          serialPathMirror = serial.path;
        } catch (err) {
          throw new BadRequestException((err as Error).message);
        }
      }
      if (Object.keys(patch).length > 0) {
        modbusConfigPatch = { ...cfg, ...patch };
      }
    }

    // MQTT: heartbeat/presença editável (tópico + janela). O modo de tópico e
    // o rootTopic são IMUTÁVEIS na edição (mudam a identidade/ACL do device).
    let mqttConfigPatch: Record<string, unknown> | null = null;
    if (
      device.protocol === 'mqtt' &&
      (body.heartbeatTopic !== undefined || body.heartbeatTimeoutSeconds !== undefined)
    ) {
      const cfg = this.mqttDeviceConfig(device);
      const scopePrefix = this.mqttTopicScope(device.tenantId, device.gatewayId ?? '', cfg);
      const heartbeat = this.validateHeartbeat(
        body.heartbeatTopic !== undefined ? body.heartbeatTopic : cfg.heartbeatTopic,
        body.heartbeatTimeoutSeconds !== undefined ? body.heartbeatTimeoutSeconds : cfg.heartbeatTimeoutSeconds,
        scopePrefix,
      );
      mqttConfigPatch = { ...(cfg as Record<string, unknown>), ...heartbeat };
    }

    await this.prisma.device.update({
      where: { id },
      data: {
        ...(body.name?.trim() ? { name: body.name.trim() } : {}),
        ...(body.ip?.trim() ? { ip: body.ip.trim() } : {}),
        ...(body.port != null ? { port: Number(body.port) } : {}),
        ...(body.siteId ? { siteId: body.siteId } : {}),
        ...(typeof body.critical === 'boolean' ? { critical: body.critical } : {}),
        ...(modbusConfigPatch ? { config: modbusConfigPatch as Prisma.InputJsonValue } : {}),
        ...(mqttConfigPatch ? { config: mqttConfigPatch as Prisma.InputJsonValue } : {}),
        // No modo RTU, ip espelha a porta serial para exibição/identificação.
        ...(serialPathMirror ? { ip: serialPathMirror } : {}),
      },
    });

    // Mudanças de conexão/polling Modbus e de heartbeat MQTT precisam chegar ao gateway.
    if (device.protocol === 'modbus' || mqttConfigPatch) {
      await this.configPublisher.publishForDevice(id);
    }

    this.logger.log(`Dispositivo atualizado: ${id} por ${user.email}`);
    return this.loadDeviceResponse(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, SensitiveActionGuard)
  async deleteDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    if (user.role !== 'ADMIN' && user.role !== 'CCO') {
      throw new BadRequestException('Apenas ADMIN ou CCO podem excluir dispositivos');
    }

    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Dispositivo não encontrado');

    await this.prisma.$transaction([
      this.prisma.devicePoint.deleteMany({ where: { deviceId: id } }),
      this.prisma.device.delete({ where: { id } }),
    ]);

    this.logger.log(`Dispositivo excluído: ${id} por ${user.email}`);

    // Modo raiz: revoga a credencial dedicada e retira o raiz da ACL do gateway.
    if (device.protocol === 'mqtt' && this.mqttDeviceConfig(device).topicMode === 'root') {
      try {
        await this.emqxProvisioning.deprovisionRootDeviceUser(id);
        if (device.gatewayId) {
          const roots = await this.collectRootTopicsForGateway(device.tenantId, device.gatewayId);
          await this.emqxProvisioning.applyGatewayRootAcl(device.gatewayId, device.tenantId, roots);
        }
      } catch (err) {
        this.logger.warn(`Falha ao desprovisionar credencial raiz de ${id}: ${(err as Error).message}`);
      }
    }

    // Republica a config do gateway (sem este device) para parar de poll-eá-lo
    if (device.gatewayId) {
      await this.configPublisher.publishForGateway(device.tenantId, device.gatewayId);
    }
  }

  /**
   * DELETE /devices/:id/points/:pointId
   * Exclui um único ponto do dispositivo. Guards são por método neste controller,
   * então a rota é protegida explicitamente com JwtAuthGuard + checagem de posse
   * tenant↔device (mesmo padrão de addPoints). As relações que referenciam o ponto
   * (Trend/AlarmRule e seus registros) têm onDelete: Cascade no schema, então são
   * removidas em cascata pelo banco. Depois republica a config ao gateway.
   */
  @Delete(':id/points/:pointId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async deletePoint(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('pointId') pointId: string,
  ): Promise<void> {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Dispositivo não encontrado');

    const isGlobal = user.role === 'ADMIN' || user.role === 'CCO';
    if (!isGlobal && device.tenantId !== user.tenantId) {
      throw new BadRequestException('Sem permissão para editar este dispositivo');
    }

    const point = await this.prisma.devicePoint.findUnique({ where: { id: pointId } });
    if (!point || point.deviceId !== id) {
      throw new NotFoundException('Ponto não encontrado neste dispositivo');
    }

    await this.prisma.devicePoint.delete({ where: { id: pointId } });
    this.logger.log(`Ponto ${pointId} excluído do dispositivo ${id} por ${user.email}`);

    // Republica a config do device (sem este ponto) para o gateway parar de lê-lo
    await this.configPublisher.publishForDevice(id);
  }

  /**
   * PATCH /devices/:id/points/:pointId
   * Atualiza um ponto. Para todos os protocolos: nome de exibição (objectName),
   * papel operacional e criticidade — sem republicar config (o polling é por
   * tag/objeto). Para pontos MQTT e Modbus, aceita também a edição técnica
   * (tag/tópico/escrita no MQTT; registrador/tipo/dado/escala/offset/limites no
   * Modbus), sempre atualizando o MESMO registro (nunca excluir/recriar — o id
   * preserva trends, alarmes e favoritos) e republicando a config retida ao
   * gateway. Mesma checagem de permissão/tenant da exclusão de ponto.
   */
  @Patch(':id/points/:pointId')
  @UseGuards(JwtAuthGuard)
  async updatePoint(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('pointId') pointId: string,
    @Body() body: {
      objectName?: string;
      opRole?: string | null;
      // Ponto crítico (card de Ativos Críticos do dashboard).
      critical?: boolean;
      write?: MqttPointInput['write'];
      // Campos técnicos — pontos de devices MQTT e Modbus (edição completa).
      tag?: string;
      sourceTopic?: string;
      jsonPath?: string | null;
      valueType?: 'number' | 'boolean';
      unit?: string;
      // Campos técnicos — apenas para pontos de devices Modbus.
      register?: number;
      registerType?: string;
      dataType?: string;
      scale?: number;
      offset?: number;
      minExpected?: number | null;
      maxExpected?: number | null;
    },
  ) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Dispositivo não encontrado');

    const isGlobal = user.role === 'ADMIN' || user.role === 'CCO';
    if (!isGlobal && device.tenantId !== user.tenantId) {
      throw new BadRequestException('Sem permissão para editar este dispositivo');
    }

    const point = await this.prisma.devicePoint.findUnique({ where: { id: pointId } });
    if (!point || point.deviceId !== id) {
      throw new NotFoundException('Ponto não encontrado neste dispositivo');
    }

    const data: Prisma.DevicePointUpdateInput = {};

    if (body.objectName !== undefined) {
      const objectName = body.objectName?.trim();
      if (!objectName) {
        throw new BadRequestException('O nome do ponto não pode ficar vazio');
      }
      data.objectName = objectName;
    }

    // Papel operacional (card Ativos Críticos + contexto p/ IA):
    // status | fault | mode | setpoint | null (limpa).
    if (body.opRole !== undefined) {
      const role = body.opRole === null || body.opRole === '' ? null : String(body.opRole);
      if (role !== null && !['status', 'fault', 'mode', 'setpoint'].includes(role)) {
        throw new BadRequestException('opRole deve ser "status", "fault", "mode", "setpoint" ou null');
      }
      data.opRole = role;
    }

    if (typeof body.critical === 'boolean') {
      data.critical = body.critical;
    }

    // Campos técnicos MQTT (tópico, jsonPath, tipo e binding de escrita) — só
    // para pontos de devices MQTT. Qualquer mudança aqui exige republicar a
    // config retida do device para o gateway aplicar sem restart.
    const touchesMqttTechnical =
      body.write !== undefined ||
      body.sourceTopic !== undefined ||
      body.jsonPath !== undefined ||
      body.valueType !== undefined;
    // Campos técnicos Modbus (registrador, tipo, dado, escala, offset, limites)
    // — só para pontos de devices Modbus. Também exigem republicar a config.
    const touchesModbusTechnical =
      body.register !== undefined ||
      body.registerType !== undefined ||
      body.dataType !== undefined ||
      body.scale !== undefined ||
      body.offset !== undefined ||
      body.minExpected !== undefined ||
      body.maxExpected !== undefined;
    let mustRepublish = false;

    if (touchesMqttTechnical && (device.protocol !== 'mqtt' || !device.gatewayId)) {
      throw new BadRequestException('Edição técnica (tópico/escrita) só se aplica a pontos MQTT');
    }
    if (touchesModbusTechnical && device.protocol !== 'modbus') {
      throw new BadRequestException(
        'Edição técnica (registrador/tipo/escala) só se aplica a pontos Modbus',
      );
    }

    if (body.unit !== undefined) {
      const unit = String(body.unit).trim();
      data.unit = unit;
      // Modbus: a unidade viaja na config de registradores do gateway.
      if (device.protocol === 'modbus' && unit !== (point.unit ?? '')) {
        mustRepublish = true;
      }
    }

    if (body.tag !== undefined) {
      // A tag é a chave de casamento da telemetria (deviceId + tag) — edição
      // só nos protocolos com edição técnica completa (MQTT e Modbus).
      if (device.protocol !== 'mqtt' && device.protocol !== 'modbus') {
        throw new BadRequestException('Edição de tag só se aplica a pontos MQTT ou Modbus');
      }
      const tag = String(body.tag).trim();
      if (!tag) {
        throw new BadRequestException('A tag do ponto não pode ficar vazia');
      }
      if (tag !== point.tag) {
        const duplicate = await this.prisma.devicePoint.findFirst({
          where: { deviceId: id, tag, NOT: { id: pointId } },
          select: { id: true },
        });
        if (duplicate) {
          throw new ConflictException(`Já existe um ponto com a tag "${tag}" neste dispositivo`);
        }
        data.tag = tag;
        mustRepublish = true;
      }
    }

    if (touchesModbusTechnical) {
      const currentBinding = (point.binding ?? {}) as Record<string, unknown>;
      const nextBinding: Record<string, unknown> = { ...currentBinding };

      if (body.register !== undefined) {
        const register = Number(body.register);
        if (!Number.isInteger(register) || register < 0) {
          throw new BadRequestException('O registrador deve ser um número inteiro não negativo');
        }
        if (register !== point.instance) {
          // Índice único [deviceId, objectType, instance] — para Modbus,
          // instance = registrador (mesma checagem do cadastro).
          const duplicate = await this.prisma.devicePoint.findFirst({
            where: { deviceId: id, objectType: 'modbus', instance: register, NOT: { id: pointId } },
            select: { id: true },
          });
          if (duplicate) {
            throw new ConflictException(
              `Já existe um ponto com o registrador ${register} neste dispositivo`,
            );
          }
          data.instance = register;
        }
        nextBinding.register = register;
      }

      if (body.registerType !== undefined) {
        if (!['holding', 'input', 'coil', 'discrete'].includes(body.registerType)) {
          throw new BadRequestException(
            'registerType deve ser "holding", "input", "coil" ou "discrete"',
          );
        }
        nextBinding.registerType = body.registerType;
      }

      if (body.dataType !== undefined) {
        if (!['int16', 'uint16', 'int32', 'uint32', 'float32', 'boolean'].includes(body.dataType)) {
          throw new BadRequestException('Tipo de dado Modbus inválido');
        }
        nextBinding.dataType = body.dataType;
      }

      if (body.scale !== undefined) {
        const scale = Number(body.scale);
        if (!Number.isFinite(scale) || scale === 0) {
          throw new BadRequestException('A escala deve ser um número diferente de zero');
        }
        nextBinding.scale = scale;
      }

      if (body.offset !== undefined) {
        const offset = Number(body.offset);
        if (!Number.isFinite(offset)) {
          throw new BadRequestException('O offset deve ser um número');
        }
        nextBinding.offset = offset;
      }

      // Limites esperados (opcionais) — null limpa o valor.
      for (const key of ['minExpected', 'maxExpected'] as const) {
        const raw = body[key];
        if (raw === undefined) continue;
        if (raw === null) {
          delete nextBinding[key];
        } else {
          const num = Number(raw);
          if (!Number.isFinite(num)) {
            throw new BadRequestException(`${key} deve ser um número ou null`);
          }
          nextBinding[key] = num;
        }
      }
      const effMin = nextBinding.minExpected as number | undefined;
      const effMax = nextBinding.maxExpected as number | undefined;
      if (typeof effMin === 'number' && typeof effMax === 'number' && effMin > effMax) {
        throw new BadRequestException('O valor mínimo esperado não pode ser maior que o máximo');
      }

      if (JSON.stringify(nextBinding) !== JSON.stringify(currentBinding)) {
        data.binding = nextBinding as Prisma.InputJsonValue;
        mustRepublish = true;
      }
    }

    if (touchesMqttTechnical) {
      const currentBinding = (point.binding ?? {}) as Record<string, unknown>;
      const nextBinding: Record<string, unknown> = { ...currentBinding };
      const scopePrefix = this.mqttTopicScope(
        device.tenantId,
        device.gatewayId!,
        this.mqttDeviceConfig(device),
      );

      if (body.sourceTopic !== undefined) {
        this.assertSafeSourceTopic(body.sourceTopic, scopePrefix);
        nextBinding.sourceTopic = body.sourceTopic.trim();
      }
      if (body.jsonPath !== undefined) {
        nextBinding.jsonPath = body.jsonPath?.trim() || null;
      }
      if (body.valueType !== undefined) {
        if (!['number', 'boolean'].includes(body.valueType)) {
          throw new BadRequestException('valueType deve ser "number" ou "boolean"');
        }
        nextBinding.valueType = body.valueType;
      }
      if (body.write !== undefined) {
        const write = this.sanitizeWriteBinding(body.write, scopePrefix);
        if (write) {
          nextBinding.write = write as unknown as Prisma.InputJsonValue;
        } else {
          delete nextBinding.write;
        }
      }

      if (JSON.stringify(nextBinding) !== JSON.stringify(currentBinding)) {
        data.binding = nextBinding as Prisma.InputJsonValue;
        mustRepublish = true;
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nada para atualizar');
    }

    const updated = await this.prisma.devicePoint.update({
      where: { id: pointId },
      data,
    });
    this.logger.log(`Ponto ${pointId} atualizado (${Object.keys(data).join(', ')}) por ${user.email}`);

    // Republica a config retida do device para o gateway aplicar o novo
    // tópico/jsonPath/escrita sem reinício manual.
    if (mustRepublish) {
      await this.configPublisher.publishForDevice(id);
      // Modo raiz: tópicos de comando podem ter mudado → re-sincroniza a ACL
      // de subscribe da credencial dedicada do equipamento.
      if (device.protocol === 'mqtt') {
        const allPoints = await this.prisma.devicePoint.findMany({
          where: { deviceId: id },
          select: { binding: true },
        });
        await this.syncRootModeAcls(device, allPoints);
      }
    }

    return updated;
  }

  /**
   * POST /devices/:id/bacnet/sync
   * Sincronização incremental: adiciona ao dispositivo apenas os novos pontos
   * descobertos na controladora, sem duplicar os já cadastrados.
   */
  @Post(':id/bacnet/sync')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async syncBacnetPoints(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { newPoints?: SyncPointInput[] },
  ) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Dispositivo não encontrado');
    // Papel de cliente só sincroniza dispositivos do próprio tenant.
    const syncScope = resolveTenantScope(user);
    if (syncScope && device.tenantId !== syncScope) {
      throw new ForbiddenException('Sem permissão para editar este dispositivo');
    }

    const newPoints = body.newPoints ?? [];
    if (newPoints.length === 0) {
      throw new BadRequestException('Selecione ao menos um ponto para sincronizar');
    }
    {
      await this.prisma.devicePoint.createMany({
        data: newPoints.map((p) => ({
          deviceId: id,
          tag: p.tag,
          objectName: repairMojibake(p.objectName ?? p.tag),
          objectType: String(p.objectType),
          instance: p.instance,
          unit: p.unit ?? '',
        })),
        skipDuplicates: true,
      });
      this.logger.log(`Sync incremental: ${newPoints.length} novo(s) ponto(s) em ${id}`);
    }

    // Republica a config de polling para o gateway ler os novos pontos automaticamente
    await this.configPublisher.publishForDevice(id);
    // Cobertura padrão de histórico para os pontos recém-sincronizados
    await this.defaultTrends.applyDefaultsForDevice(id);

    return this.loadDeviceResponse(id);
  }

  /**
   * POST /devices/:id/bacnet/sync/replace
   * Sincronização total: substitui todos os pontos do dispositivo pelos
   * descobertos agora na controladora.
   */
  @Post(':id/bacnet/sync/replace')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async replaceBacnetPoints(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { points?: SyncPointInput[] },
  ) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Dispositivo não encontrado');
    const replaceScope = resolveTenantScope(user);
    if (replaceScope && device.tenantId !== replaceScope) {
      throw new ForbiddenException('Sem permissão para editar este dispositivo');
    }

    const points = body.points ?? [];
    await this.prisma.$transaction([
      this.prisma.devicePoint.deleteMany({ where: { deviceId: id } }),
      this.prisma.devicePoint.createMany({
        data: points.map((p) => ({
          deviceId: id,
          tag: p.tag,
          objectName: repairMojibake(p.objectName ?? p.tag),
          objectType: String(p.objectType),
          instance: p.instance,
          unit: p.unit ?? '',
        })),
        skipDuplicates: true,
      }),
    ]);
    this.logger.log(`Sync total: ${points.length} ponto(s) substituídos em ${id}`);

    // Republica a config de polling com o conjunto atualizado de pontos
    await this.configPublisher.publishForDevice(id);
    // Cobertura padrão de histórico para o conjunto recriado de pontos
    await this.defaultTrends.applyDefaultsForDevice(id);

    return this.loadDeviceResponse(id);
  }

  /**
   * POST /devices/bacnet/write
   * Força um valor (ou libera o override) em uma saída física BACnet — ação
   * sensível que atua em equipamentos reais. Exige usuário autenticado e papel
   * autorizado (ADMIN/CCO/SUPERVISOR/CLIENTE), alinhado às demais ações operacionais.
   * Usuários com escopo de tenant só podem comandar dispositivos do seu tenant.
   */
  @Post('bacnet/write')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR, UserRole.CLIENTE)
  async writeBacnet(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: WriteBacnetDto,
  ): Promise<BacnetWriteResult> {
    if (!body.tenantId || String(body.tenantId).trim() === '') {
      throw new BadRequestException('tenantId e obrigatorio');
    }
    // Usuários com escopo de tenant (SUPERVISOR/CLIENTE) só comandam o próprio tenant.
    // ADMIN/CCO são globais e podem atuar em qualquer tenant.
    const isGlobal = user.role === UserRole.ADMIN || user.role === UserRole.CCO;
    if (!isGlobal && body.tenantId !== user.tenantId) {
      throw new BadRequestException('Sem permissão para comandar este dispositivo');
    }
    if (!body.gatewayId || String(body.gatewayId).trim() === '') {
      throw new BadRequestException('gatewayId e obrigatorio');
    }
    if (!body.ip || String(body.ip).trim() === '') {
      throw new BadRequestException('ip e obrigatorio');
    }
    if (!body.port || body.port <= 0 || body.port > 65535) {
      throw new BadRequestException('port deve ser um numero valido (1-65535)');
    }
    if (body.objectType === undefined || body.objectType === null || body.objectType < 0) {
      throw new BadRequestException('objectType e obrigatorio e deve ser um numero nao negativo');
    }
    if (body.objectInstance === undefined || body.objectInstance === null || body.objectInstance < 0) {
      throw new BadRequestException('objectInstance e obrigatorio e deve ser um numero nao negativo');
    }
    // `value: null` é intencional — significa relinquish (liberar o override na
    // prioridade informada). Só rejeitamos quando o campo está AUSENTE.
    if (body.value === undefined) {
      throw new BadRequestException('value e obrigatorio');
    }
    if (body.priority !== undefined && (body.priority < 1 || body.priority > 16)) {
      throw new BadRequestException('priority deve estar entre 1 e 16');
    }

    this.logger.log(
      `BACnet write request — tenant: ${body.tenantId}, gateway: ${body.gatewayId}, ` +
        `device: ${body.ip}:${body.port}, objectType: ${body.objectType}, ` +
        `objectInstance: ${body.objectInstance}, value: ${String(body.value)}`,
    );

    return this.bacnetWrite.writeBacnet(body);
  }

  /**
   * POST /devices/mqtt/write
   * Comanda um ponto MQTT-nativo comandável (ex.: relé Shelly Gen4) — ação
   * sensível que atua em equipamentos reais. Mesmos papéis do write BACnet
   * (ADMIN/CCO/SUPERVISOR/CLIENTE). O binding de escrita (tópico de comando, template
   * de payload, tópico de resposta) é resolvido do banco — o frontend só envia
   * device/ponto/valor, nunca o tópico.
   */
  @Post('mqtt/write')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR, UserRole.CLIENTE)
  async writeMqtt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: WriteMqttDto,
  ): Promise<MqttWriteResult> {
    if (!body.deviceId || String(body.deviceId).trim() === '') {
      throw new BadRequestException('deviceId e obrigatorio');
    }
    if (!body.pointId || String(body.pointId).trim() === '') {
      throw new BadRequestException('pointId e obrigatorio');
    }
    if (body.value === undefined || body.value === null) {
      throw new BadRequestException('value e obrigatorio');
    }

    const device = await this.prisma.device.findUnique({
      where: { id: body.deviceId },
      include: { points: { where: { id: body.pointId } } },
    });
    if (!device || device.protocol !== 'mqtt') {
      throw new NotFoundException('Dispositivo MQTT não encontrado');
    }

    // Usuários com escopo de tenant (SUPERVISOR/CLIENTE) só comandam o próprio tenant.
    const isGlobal = user.role === UserRole.ADMIN || user.role === UserRole.CCO;
    if (!isGlobal && device.tenantId !== user.tenantId) {
      throw new BadRequestException('Sem permissão para comandar este dispositivo');
    }
    const point = device.points[0];
    if (!point) {
      throw new NotFoundException('Ponto não encontrado neste dispositivo');
    }

    // Binding de escrita resolvido pelo MESMO caminho do runner de automações
    // (fonte única): valida gateway + tópico de comando + template de payload.
    let target: ReturnType<typeof resolveMqttWriteTarget>;
    try {
      target = resolveMqttWriteTarget(device, point);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }

    this.logger.log(
      `MQTT write request — tenant: ${device.tenantId}, gateway: ${device.gatewayId}, ` +
        `device: ${device.id}, point: ${point.tag}, value: ${String(body.value)}`,
    );

    const { isDigital: _isDigital, ...request } = target;
    return this.mqttWrite.writeMqtt({ ...request, value: body.value });
  }

  /**
   * POST /devices/modbus/write
   * Escreve um holding register ou coil Modbus — ação sensível que atua em
   * equipamentos reais. Mesmos papéis dos writes BACnet/MQTT
   * (ADMIN/CCO/SUPERVISOR/CLIENTE). O binding do registrador e a config de conexão
   * (TCP/RTU, unitId, serial) são resolvidos do banco — o frontend só envia
   * device/ponto/valor, nunca endereço ou tipo de registrador.
   */
  @Post('modbus/write')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR, UserRole.CLIENTE)
  async writeModbus(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: WriteModbusDto,
  ): Promise<ModbusWriteResult> {
    if (!body.deviceId || String(body.deviceId).trim() === '') {
      throw new BadRequestException('deviceId e obrigatorio');
    }
    if (!body.pointId || String(body.pointId).trim() === '') {
      throw new BadRequestException('pointId e obrigatorio');
    }
    if (body.value === undefined || body.value === null) {
      throw new BadRequestException('value e obrigatorio');
    }
    const numericValue = typeof body.value === 'boolean' ? (body.value ? 1 : 0) : Number(body.value);
    if (!Number.isFinite(numericValue)) {
      throw new BadRequestException('value deve ser um numero valido');
    }

    const device = await this.prisma.device.findUnique({
      where: { id: body.deviceId },
      include: { points: { where: { id: body.pointId } } },
    });
    if (!device || device.protocol !== 'modbus') {
      throw new NotFoundException('Dispositivo Modbus não encontrado');
    }

    // Usuários com escopo de tenant (SUPERVISOR/CLIENTE) só comandam o próprio tenant.
    const isGlobal = user.role === UserRole.ADMIN || user.role === UserRole.CCO;
    if (!isGlobal && device.tenantId !== user.tenantId) {
      throw new BadRequestException('Sem permissão para comandar este dispositivo');
    }
    const point = device.points[0];
    if (!point) {
      throw new NotFoundException('Ponto não encontrado neste dispositivo');
    }

    // Resolução compartilhada de binding/config (mesmo caminho das automações):
    // valida holding/coil, RTU com serial cadastrada, etc.
    let target: ResolvedModbusWriteTarget;
    try {
      target = resolveModbusWriteTarget(device, point);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }

    this.logger.log(
      `Modbus write request — tenant: ${device.tenantId}, gateway: ${device.gatewayId}, ` +
        `device: ${device.id}, point: ${point.tag}, ` +
        `${target.registerType} reg ${target.register}, value: ${numericValue}`,
    );

    const { isDigital: _isDigital, ...request } = target;
    return this.modbusWrite.writeModbus({ ...request, value: numericValue });
  }
}
