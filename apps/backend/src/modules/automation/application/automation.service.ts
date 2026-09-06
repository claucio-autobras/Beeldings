import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  CreateAutomationInput,
  UpdateAutomationInput,
  AutomationActionInput,
  ScheduleTriggerConfig,
  AutomationCondition,
} from '../domain/automation.types.js';

/** Inclui as ações ordenadas na consulta de uma automação. */
const withActions = {
  actions: { orderBy: { order: 'asc' } },
} satisfies Prisma.AutomationInclude;

@Injectable()
export class AutomationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista automações do tenant (opcionalmente filtradas por site). */
  async list(tenantId: string, siteId?: string) {
    return this.prisma.automation.findMany({
      where: {
        tenantId,
        // Filtro por site inclui as automações do site E as do cliente inteiro
        // (siteId nulo = valem para todos os sites).
        ...(siteId ? { OR: [{ siteId }, { siteId: null }] } : {}),
      },
      include: withActions,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Lista o histórico de execuções do tenant, paginado, com filtros opcionais
   * por automação, resultado e site (site inclui automações do cliente inteiro).
   */
  async listRuns(
    tenantId: string,
    opts: {
      automationId?: string;
      result?: 'SUCCESS' | 'PARTIAL' | 'FAILURE';
      siteId?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const where: Prisma.AutomationRunWhereInput = {
      tenantId,
      ...(opts.automationId ? { automationId: opts.automationId } : {}),
      ...(opts.result ? { result: opts.result } : {}),
      ...(opts.siteId
        ? { automation: { OR: [{ siteId: opts.siteId }, { siteId: null }] } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.automationRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.automationRun.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** Busca uma automação garantindo pertencer ao tenant. */
  async get(tenantId: string, id: string) {
    const automation = await this.prisma.automation.findFirst({
      where: { id, tenantId },
      include: withActions,
    });
    if (!automation) throw new NotFoundException('Automação não encontrada');
    return automation;
  }

  async create(tenantId: string, createdBy: string | null, input: CreateAutomationInput) {
    this.validate(input);
    return this.prisma.automation.create({
      data: {
        tenantId,
        siteId: input.siteId ?? null,
        name: input.name.trim(),
        enabled: input.enabled ?? true,
        mode: input.mode,
        triggerType: input.triggerType ?? 'SCHEDULE',
        triggerConfig: input.triggerConfig as unknown as Prisma.InputJsonValue,
        condition: this.conditionJson(input.condition),
        evalSeconds: input.evalSeconds ?? 30,
        executesOn: input.executesOn ?? 'CLOUD',
        priority: input.priority ?? 8,
        createdBy,
        actions: { create: input.actions.map((a) => this.actionData(a)) },
      },
      include: withActions,
    });
  }

  async update(tenantId: string, id: string, input: UpdateAutomationInput) {
    await this.get(tenantId, id);
    this.validate(input);
    // Substitui as ações inteiras (delete + recreate) numa transação.
    return this.prisma.$transaction(async (tx) => {
      await tx.automationAction.deleteMany({ where: { automationId: id } });
      return tx.automation.update({
        where: { id },
        data: {
          siteId: input.siteId ?? null,
          name: input.name.trim(),
          enabled: input.enabled ?? true,
          mode: input.mode,
          triggerType: input.triggerType ?? 'SCHEDULE',
          triggerConfig: input.triggerConfig as unknown as Prisma.InputJsonValue,
          condition: this.conditionJson(input.condition),
          evalSeconds: input.evalSeconds ?? 30,
          executesOn: input.executesOn ?? 'CLOUD',
          priority: input.priority ?? 8,
          actions: { create: input.actions.map((a) => this.actionData(a)) },
        },
        include: withActions,
      });
    });
  }

  async setEnabled(tenantId: string, id: string, enabled: boolean) {
    await this.get(tenantId, id);
    return this.prisma.automation.update({
      where: { id },
      data: { enabled },
      include: withActions,
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.get(tenantId, id);
    await this.prisma.automation.delete({ where: { id } });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private actionData(a: AutomationActionInput): Prisma.AutomationActionCreateWithoutAutomationInput {
    return {
      order: a.order,
      branch: a.branch,
      type: a.type,
      targetPointId: a.targetPointId ?? null,
      value: a.value === undefined || a.value === null ? Prisma.JsonNull : (a.value as Prisma.InputJsonValue),
      delaySeconds: a.delaySeconds ?? 0,
      config: a.config ? (a.config as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    };
  }

  private conditionJson(condition?: AutomationCondition | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return condition ? (condition as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;
  }

  /** Validação de negócio antes de persistir. */
  private validate(input: CreateAutomationInput): void {
    if (!input.name || !input.name.trim()) {
      throw new BadRequestException('Nome é obrigatório');
    }
    if (!input.actions || input.actions.length === 0) {
      throw new BadRequestException('Ao menos uma ação é obrigatória');
    }
    if (
      input.priority !== undefined &&
      (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 16)
    ) {
      throw new BadRequestException('Prioridade deve ser um inteiro entre 1 e 16');
    }
    const trigger = input.triggerConfig as ScheduleTriggerConfig | undefined;
    if (!trigger || !Array.isArray(trigger.entries) || trigger.entries.length === 0) {
      throw new BadRequestException('Ao menos um horário de agenda é obrigatório');
    }
    if (trigger.timezone && !this.isValidTimezone(trigger.timezone)) {
      throw new BadRequestException(`Timezone inválido: ${trigger.timezone}`);
    }
    for (const entry of trigger.entries) {
      if (!this.isValidHHmm(entry.time)) {
        throw new BadRequestException(`Horário inválido: ${entry.time}`);
      }
      if (entry.endTime && !this.isValidHHmm(entry.endTime)) {
        throw new BadRequestException(`Horário de término inválido: ${entry.endTime}`);
      }
      if (!Array.isArray(entry.days) || entry.days.length === 0) {
        throw new BadRequestException('Selecione ao menos um dia da semana');
      }
      if (entry.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
        throw new BadRequestException('Dia da semana inválido (use 0–6, domingo a sábado)');
      }
    }
    if (input.mode === 'CONTINUOUS' && !input.condition) {
      throw new BadRequestException('Modo contínuo requer uma condição (SE)');
    }
    for (const a of input.actions) {
      if (a.type === 'WRITE_POINT') {
        if (!a.targetPointId) {
          throw new BadRequestException('Ação de escrita requer um ponto de destino');
        }
        if (a.value === undefined || a.value === null) {
          throw new BadRequestException('Ação de escrita requer um valor');
        }
      }
      if (a.type === 'NOTIFY' && (!a.config || !a.config.message?.trim())) {
        throw new BadRequestException('Ação de notificação requer uma mensagem');
      }
    }
  }

  /** Valida "HH:mm" com faixas reais (hora 0–23, minuto 0–59). */
  private isValidHHmm(value: string): boolean {
    const m = /^(\d{2}):(\d{2})$/.exec(value);
    if (!m) return false;
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
  }

  /** Valida um identificador de timezone IANA via Intl. */
  private isValidTimezone(tz: string): boolean {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }
}
