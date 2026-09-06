import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Device, DevicePoint, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TelemetryGateway } from '../../mqtt/telemetry.gateway.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../../auth/domain/interfaces/auth.interface.js';

/** Perfis globais (Autobras): enxergam todos os tenants. */
const GLOBAL_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR]);

/**
 * Nível de acesso exigido sobre a bancada:
 * - 'read': listar/visualizar (qualquer papel com acesso ao tenant);
 * - 'command': setar valor de ponto (perfis globais + CLIENTE do tenant, mesma
 *   regra dos writes BACnet/MQTT/Modbus — VISUALIZADOR fica de fora);
 * - 'manage': mutações estruturais (criar dispositivo, adicionar/remover pontos)
 *   — só perfis globais.
 */
type SimulatorAccess = 'read' | 'command' | 'manage';

/** Tipos de ponto virtual expostos ao frontend. */
export type VirtualKind = 'analog' | 'digital' | 'multistate';

/** Estado nomeado de um ponto multistate. */
export interface VirtualState {
  value: number;
  label: string;
}

/** Payload de criação de um ponto virtual. */
export interface NewVirtualPointDto {
  tag: string;
  objectName?: string;
  kind: VirtualKind;
  unit?: string;
  states?: VirtualState[];
  initialValue?: number | boolean;
}

/** Shape de ponto virtual retornado ao frontend (ver virtual.types.ts). */
export interface VirtualPointView {
  id: string;
  tag: string;
  objectName: string;
  objectType: 'AV' | 'BV' | 'MSI';
  instance: number;
  unit: string;
  kind: VirtualKind;
  currentValue: number | boolean;
  states: VirtualState[];
  value: number | boolean;
  status: string;
  lastUpdate: string;
}

/** Shape de dispositivo virtual retornado ao frontend. */
export interface VirtualDeviceView {
  id: string;
  name: string;
  protocol: 'virtual';
  siteId: string | null;
  tenantId: string;
  gatewayId: null;
  config: { virtual: true; projectId: string };
  points: VirtualPointView[];
}

/** Config Json guardada no binding de cada ponto virtual. */
interface VirtualBinding {
  kind: VirtualKind;
  currentValue: number | boolean;
  states?: VirtualState[];
  updatedAt?: string;
}

/** kind → objectType (string BACnet). */
const KIND_TO_OBJECT_TYPE: Record<VirtualKind, 'AV' | 'BV' | 'MSI'> = {
  analog: 'AV',
  digital: 'BV',
  multistate: 'MSI',
};

/** objectType (string) → número BACnet (alinhado a OBJECT_TYPE_NUM do frontend). */
const OBJECT_TYPE_NUM: Record<string, number> = {
  AV: 2,
  BV: 5,
  MSI: 13,
};

type DeviceWithPoints = Device & { points: DevicePoint[] };

/**
 * Bancada de Testes do SCADA: pontos virtuais (telemetria simulada, sem hardware).
 * Reaproveita os models `Device`/`DevicePoint`, isolando os dispositivos virtuais
 * da produção (`protocol='virtual'`, `gatewayId=null`, `config.virtual=true`). A
 * config específica do ponto (kind/currentValue/states) vive no `binding` Json.
 */
@Injectable()
export class SimulatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telemetry: TelemetryGateway,
  ) {}

  /**
   * Garante (idempotente) o dispositivo virtual de um projeto e o retorna com
   * seus pontos. Cria na primeira chamada; nas seguintes reaproveita o existente.
   */
  async ensureDevice(
    projectId: string,
    user: AuthenticatedUser,
  ): Promise<VirtualDeviceView> {
    if (!projectId?.trim()) {
      throw new BadRequestException('projectId é obrigatório');
    }
    const project = await this.resolveProject(projectId, user, 'manage');

    const existing = await this.findProjectDevice(project.tenantId, projectId);
    if (existing) return this.toDeviceView(existing);

    const created = await this.prisma.device.create({
      data: {
        name: 'Bancada de Testes',
        protocol: 'virtual',
        ip: '',
        port: 0,
        status: 'online',
        tenantId: project.tenantId,
        siteId: project.siteId ?? null,
        gatewayId: null,
        config: { virtual: true, projectId } as Prisma.InputJsonValue,
      },
      include: { points: true },
    });
    return this.toDeviceView(created);
  }

  /** Lista os dispositivos virtuais de um projeto (com pontos). */
  async listDevices(
    projectId: string,
    user: AuthenticatedUser,
  ): Promise<VirtualDeviceView[]> {
    if (!projectId?.trim()) {
      throw new BadRequestException('projectId é obrigatório');
    }
    const project = await this.resolveProject(projectId, user, 'read');

    const devices = await this.prisma.device.findMany({
      where: { protocol: 'virtual', tenantId: project.tenantId },
      include: { points: true },
      orderBy: { createdAt: 'asc' },
    });
    return devices
      .filter((d) => this.deviceProjectId(d) === projectId)
      .map((d) => this.toDeviceView(d));
  }

  /** Adiciona pontos virtuais ao dispositivo e retorna o dispositivo atualizado. */
  async addPoints(
    deviceId: string,
    points: NewVirtualPointDto[],
    user: AuthenticatedUser,
  ): Promise<VirtualDeviceView> {
    const device = await this.getWritableDevice(deviceId, user, 'manage');
    if (!Array.isArray(points) || points.length === 0) {
      throw new BadRequestException('Informe ao menos um ponto virtual');
    }

    // Próxima instância livre por objectType (respeita o índice único).
    const nextInstance: Record<string, number> = {};
    for (const p of device.points) {
      const key = p.objectType;
      nextInstance[key] = Math.max(nextInstance[key] ?? -1, p.instance);
    }

    for (const raw of points) {
      const kind = raw.kind;
      const objectType = KIND_TO_OBJECT_TYPE[kind];
      if (!objectType) {
        throw new BadRequestException(`Tipo de ponto inválido: ${String(kind)}`);
      }
      const tag = raw.tag?.trim();
      if (!tag) {
        throw new BadRequestException('tag é obrigatória');
      }

      const states =
        kind === 'multistate'
          ? (raw.states ?? []).map((s, i) => ({ value: i, label: String(s.label ?? '').trim() })).filter((s) => s.label)
          : undefined;
      if (kind === 'multistate' && (!states || states.length < 2)) {
        throw new BadRequestException('Ponto multistate exige ao menos 2 estados');
      }

      const currentValue = this.initialValue(kind, raw.initialValue);
      const instance = (nextInstance[objectType] ?? -1) + 1;
      nextInstance[objectType] = instance;

      const binding: VirtualBinding = {
        kind,
        currentValue,
        ...(states ? { states } : {}),
        updatedAt: new Date().toISOString(),
      };

      await this.prisma.devicePoint.create({
        data: {
          deviceId: device.id,
          tag,
          objectName: raw.objectName?.trim() || tag,
          objectType,
          instance,
          unit: raw.unit?.trim() || '',
          binding: binding as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const updated = await this.loadDevice(device.id);
    // Emite telemetria dos pontos recém-criados para que já apareçam ao vivo.
    this.emitTelemetry(updated);
    return this.toDeviceView(updated);
  }

  /** Atualiza o valor corrente de um ponto e emite telemetria ao vivo. */
  async setPointValue(
    deviceId: string,
    pointId: string,
    value: number | boolean,
    user: AuthenticatedUser,
  ): Promise<VirtualDeviceView> {
    // Comando de valor: mesma regra dos writes BACnet/MQTT/Modbus — CLIENTE do
    // tenant do projeto pode comandar; gestão estrutural segue só p/ globais.
    const device = await this.getWritableDevice(deviceId, user, 'command');
    const point = device.points.find((p) => p.id === pointId);
    if (!point) {
      throw new NotFoundException(`Ponto virtual ${pointId} não encontrado`);
    }

    const binding = this.readBinding(point);
    const coerced = this.coerceValue(binding.kind, value);
    const next: VirtualBinding = {
      ...binding,
      currentValue: coerced,
      updatedAt: new Date().toISOString(),
    };

    await this.prisma.devicePoint.update({
      where: { id: pointId },
      data: { binding: next as unknown as Prisma.InputJsonValue },
    });

    const updated = await this.loadDevice(device.id);
    this.emitTelemetry(updated, [pointId]);
    return this.toDeviceView(updated);
  }

  /** Remove um ponto virtual. */
  async deletePoint(
    deviceId: string,
    pointId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const device = await this.getWritableDevice(deviceId, user, 'manage');
    const point = device.points.find((p) => p.id === pointId);
    if (!point) {
      throw new NotFoundException(`Ponto virtual ${pointId} não encontrado`);
    }
    await this.prisma.devicePoint.delete({ where: { id: pointId } });
  }

  // ─── Internos ────────────────────────────────────────────────────────────────

  /**
   * Resolve o projeto e o tenant efetivo, aplicando isolamento por tenant e o
   * nível de acesso exigido (ver SimulatorAccess).
   */
  private async resolveProject(
    projectId: string,
    user: AuthenticatedUser,
    access: SimulatorAccess,
  ): Promise<{ id: string; tenantId: string; siteId: string | null }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, tenantId: true, siteId: true },
    });
    if (!project) {
      throw new NotFoundException(`Gateway ${projectId} não encontrado`);
    }
    const isGlobal = GLOBAL_ROLES.has(user.role);
    if (!isGlobal && user.tenantId !== project.tenantId) {
      throw new ForbiddenException('Sem acesso a este gateway');
    }
    if (access === 'manage' && !isGlobal) {
      throw new ForbiddenException('Sem permissão para gerir a bancada de testes');
    }
    if (access === 'command' && !isGlobal && user.role !== UserRole.CLIENTE) {
      throw new ForbiddenException('Sem permissão para comandar pontos da bancada de testes');
    }
    return project;
  }

  /**
   * Carrega um dispositivo virtual para escrita, validando que é virtual e que o
   * usuário tem o nível de acesso exigido (isolamento por tenant via projeto).
   */
  private async getWritableDevice(
    deviceId: string,
    user: AuthenticatedUser,
    access: SimulatorAccess,
  ): Promise<DeviceWithPoints> {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      include: { points: true },
    });
    if (!device || device.protocol !== 'virtual') {
      throw new NotFoundException(`Dispositivo virtual ${deviceId} não encontrado`);
    }
    const projectId = this.deviceProjectId(device);
    if (!projectId) {
      throw new BadRequestException('Dispositivo virtual sem gateway associado');
    }
    // Reaproveita a validação de isolamento/permissão do projeto.
    await this.resolveProject(projectId, user, access);
    return device;
  }

  private async findProjectDevice(
    tenantId: string,
    projectId: string,
  ): Promise<DeviceWithPoints | null> {
    const devices = await this.prisma.device.findMany({
      where: { protocol: 'virtual', tenantId },
      include: { points: true },
      orderBy: { createdAt: 'asc' },
    });
    return devices.find((d) => this.deviceProjectId(d) === projectId) ?? null;
  }

  private async loadDevice(deviceId: string): Promise<DeviceWithPoints> {
    return this.prisma.device.findUniqueOrThrow({
      where: { id: deviceId },
      include: { points: true },
    });
  }

  private deviceProjectId(device: Device): string | null {
    const config = (device.config ?? {}) as { projectId?: unknown };
    return typeof config.projectId === 'string' ? config.projectId : null;
  }

  private readBinding(point: DevicePoint): VirtualBinding {
    const b = (point.binding ?? {}) as Partial<VirtualBinding>;
    const kind: VirtualKind =
      b.kind === 'digital' || b.kind === 'multistate' ? b.kind : 'analog';
    return {
      kind,
      currentValue: b.currentValue ?? this.initialValue(kind),
      states: b.states,
      updatedAt: b.updatedAt,
    };
  }

  private initialValue(kind: VirtualKind, provided?: number | boolean): number | boolean {
    if (provided !== undefined && provided !== null) return this.coerceValue(kind, provided);
    if (kind === 'digital') return false;
    return 0;
  }

  private coerceValue(kind: VirtualKind, value: number | boolean): number | boolean {
    if (kind === 'digital') return Boolean(value);
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  private toDeviceView(device: DeviceWithPoints): VirtualDeviceView {
    const projectId = this.deviceProjectId(device) ?? '';
    return {
      id: device.id,
      name: device.name,
      protocol: 'virtual',
      siteId: device.siteId,
      tenantId: device.tenantId,
      gatewayId: null,
      config: { virtual: true, projectId },
      points: device.points
        .map((p) => this.toPointView(p))
        .sort((a, b) => a.tag.localeCompare(b.tag)),
    };
  }

  private toPointView(point: DevicePoint): VirtualPointView {
    const binding = this.readBinding(point);
    const objectType = (['AV', 'BV', 'MSI'].includes(point.objectType)
      ? point.objectType
      : 'AV') as 'AV' | 'BV' | 'MSI';
    return {
      id: point.id,
      tag: point.tag,
      objectName: point.objectName,
      objectType,
      instance: point.instance,
      unit: point.unit ?? '',
      kind: binding.kind,
      currentValue: binding.currentValue,
      states: binding.states ?? [],
      value: binding.currentValue,
      status: 'normal',
      lastUpdate: binding.updatedAt ?? point.createdAt.toISOString(),
    };
  }

  /**
   * Emite telemetria ao vivo (evento `bacnet:telemetry`) para os pontos virtuais
   * — mesmo formato dos pontos reais, para que `useScreenTelemetry` os resolva por
   * `objectType:objectInstance`. Se `onlyPointIds` for dado, emite só esses pontos.
   */
  private emitTelemetry(device: DeviceWithPoints, onlyPointIds?: string[]): void {
    const filter = onlyPointIds ? new Set(onlyPointIds) : null;
    const points = device.points
      .filter((p) => !filter || filter.has(p.id))
      .map((p) => {
        const binding = this.readBinding(p);
        const num = OBJECT_TYPE_NUM[p.objectType];
        if (num === undefined) return null;
        return {
          tag: p.tag,
          objectType: num,
          objectInstance: p.instance,
          value: typeof binding.currentValue === 'boolean' ? Number(binding.currentValue) : binding.currentValue,
          unit: p.unit ?? null,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (points.length === 0) return;
    // Escopo por tenant do device virtual (bancada) — mesmo isolamento por room
    // dos pontos reais.
    this.telemetry.emitTelemetry(
      {
        timestamp: new Date().toISOString(),
        deviceId: device.id,
        points,
      },
      device.tenantId,
    );
  }
}
