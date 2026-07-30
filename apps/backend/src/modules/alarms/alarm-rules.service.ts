import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AlarmRule, AlarmType, AlarmSeverity, AlarmCondition } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlarmEngineService } from './alarm-engine.service.js';

export interface CreateAlarmRuleInput {
  pointId: string;
  name: string;
  message: string;
  type: AlarmType;
  severity: AlarmSeverity;
  enabled?: boolean;
  activationState?: boolean | null;
  condition?: AlarmCondition | null;
  limitValue?: number | null;
  limitLow?: number | null;
  limitHigh?: number | null;
  hysteresis?: number | null;
  delaySeconds?: number | null;
}

export interface UpdateAlarmRuleInput {
  name?: string;
  message?: string;
  severity?: AlarmSeverity;
  enabled?: boolean;
  activationState?: boolean | null;
  condition?: AlarmCondition | null;
  limitValue?: number | null;
  limitLow?: number | null;
  limitHigh?: number | null;
  hysteresis?: number | null;
  delaySeconds?: number | null;
}

export interface AlarmRuleFilters {
  tenantId?: string;
  deviceId?: string;
  pointId?: string;
}

const RANGE_LIMIT_CONDITIONS = new Set<AlarmCondition>(['GT', 'LT', 'GTE', 'LTE']);
const RANGE_BAND_CONDITIONS = new Set<AlarmCondition>(['BETWEEN', 'OUTSIDE']);

const POINT_SELECT = {
  id: true, tag: true, objectName: true, objectType: true, instance: true, unit: true, deviceId: true,
} as const;

@Injectable()
export class AlarmRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: AlarmEngineService,
  ) {}

  findAll(filters: AlarmRuleFilters) {
    return this.prisma.alarmRule.findMany({
      where: {
        ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
        ...(filters.pointId ? { pointId: filters.pointId } : {}),
        ...(filters.deviceId ? { point: { deviceId: filters.deviceId } } : {}),
      },
      include: {
        point: { select: POINT_SELECT },
        _count: { select: { events: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string | undefined): Promise<AlarmRule> {
    const rule = await this.prisma.alarmRule.findFirst({ where: tenantId ? { id, tenantId } : { id } });
    if (!rule) throw new NotFoundException(`Regra de alarme ${id} não encontrada`);
    return rule;
  }

  async create(input: CreateAlarmRuleInput): Promise<AlarmRule> {
    if (!input.name?.trim()) throw new BadRequestException('name é obrigatório');
    if (!input.message?.trim()) throw new BadRequestException('message é obrigatório');
    this.validateByType(input.type, input);

    const point = await this.prisma.devicePoint.findUnique({
      where: { id: input.pointId },
      include: { device: { select: { tenantId: true } } },
    });
    if (!point) throw new NotFoundException(`Ponto ${input.pointId} não encontrado`);

    const rule = await this.prisma.alarmRule.create({
      data: {
        tenantId: point.device.tenantId,
        pointId: input.pointId,
        name: input.name.trim(),
        message: input.message.trim(),
        type: input.type,
        severity: input.severity,
        enabled: input.enabled ?? true,
        activationState: input.type === 'STATE_CHANGE' ? input.activationState ?? true : null,
        condition: input.type === 'VALUE_RANGE' ? input.condition ?? null : null,
        limitValue: input.type === 'VALUE_RANGE' ? input.limitValue ?? null : null,
        limitLow: input.type === 'VALUE_RANGE' ? input.limitLow ?? null : null,
        limitHigh: input.type === 'VALUE_RANGE' ? input.limitHigh ?? null : null,
        hysteresis: input.hysteresis ?? 0,
        delaySeconds: input.delaySeconds ?? 0,
      },
    });
    await this.engine.reload();
    return rule;
  }

  async update(id: string, tenantId: string | undefined, input: UpdateAlarmRuleInput): Promise<AlarmRule> {
    const existing = await this.findOne(id, tenantId);

    // Revalida a coerência dos campos analógicos quando algum for alterado.
    if (existing.type === 'VALUE_RANGE') {
      const merged = {
        condition: input.condition ?? existing.condition,
        limitValue: input.limitValue ?? existing.limitValue,
        limitLow: input.limitLow ?? existing.limitLow,
        limitHigh: input.limitHigh ?? existing.limitHigh,
      };
      if (input.condition !== undefined || input.limitValue !== undefined || input.limitLow !== undefined || input.limitHigh !== undefined) {
        this.validateRange(merged.condition, merged.limitValue, merged.limitLow, merged.limitHigh);
      }
    }

    const data: Prisma.AlarmRuleUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.message !== undefined) data.message = input.message.trim();
    if (input.severity !== undefined) data.severity = input.severity;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.delaySeconds !== undefined) data.delaySeconds = input.delaySeconds ?? 0;
    if (input.hysteresis !== undefined) data.hysteresis = input.hysteresis ?? 0;
    if (existing.type === 'STATE_CHANGE' && input.activationState !== undefined) {
      data.activationState = input.activationState ?? true;
    }
    if (existing.type === 'VALUE_RANGE') {
      if (input.condition !== undefined) data.condition = input.condition;
      if (input.limitValue !== undefined) data.limitValue = input.limitValue;
      if (input.limitLow !== undefined) data.limitLow = input.limitLow;
      if (input.limitHigh !== undefined) data.limitHigh = input.limitHigh;
    }

    const rule = await this.prisma.alarmRule.update({ where: { id }, data });
    await this.engine.reload();
    return rule;
  }

  async delete(id: string, tenantId: string | undefined): Promise<void> {
    await this.findOne(id, tenantId);
    await this.prisma.alarmRule.delete({ where: { id } });
    await this.engine.reload();
  }

  // ── Validação por tipo ────────────────────────────────────────────────────
  private validateByType(type: AlarmType, input: CreateAlarmRuleInput): void {
    if (type === 'STATE_CHANGE') {
      if (typeof input.activationState !== 'boolean') {
        throw new BadRequestException('activationState (boolean) é obrigatório para STATE_CHANGE');
      }
      return;
    }
    this.validateRange(input.condition ?? null, input.limitValue ?? null, input.limitLow ?? null, input.limitHigh ?? null);
  }

  private validateRange(
    condition: AlarmCondition | null,
    limitValue: number | null,
    limitLow: number | null,
    limitHigh: number | null,
  ): void {
    if (!condition) throw new BadRequestException('condition é obrigatório para VALUE_RANGE');
    if (RANGE_LIMIT_CONDITIONS.has(condition)) {
      if (typeof limitValue !== 'number') {
        throw new BadRequestException(`limitValue é obrigatório para a condição ${condition}`);
      }
    } else if (RANGE_BAND_CONDITIONS.has(condition)) {
      if (typeof limitLow !== 'number' || typeof limitHigh !== 'number') {
        throw new BadRequestException(`limitLow e limitHigh são obrigatórios para a condição ${condition}`);
      }
      if (limitLow > limitHigh) {
        throw new BadRequestException('limitLow não pode ser maior que limitHigh');
      }
    }
  }
}
