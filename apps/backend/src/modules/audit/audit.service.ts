import { Injectable, Logger } from '@nestjs/common';
import type { AuditResult, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditActor {
  id?: string | null;
  name?: string | null;
  email: string;
  role?: string | null;
}

export interface AuditRecordInput {
  /** Ator da ação; `null`/ausente apenas em falha de login de usuário inexistente. */
  actor?: AuditActor | null;
  /** Código da ação: LOGIN/LOGOUT/CREATE/UPDATE/DELETE/COMMAND/ACK. */
  action: string;
  /** Rótulo legível da entidade (ex.: "Regra de alarme"). */
  entityType?: string | null;
  entityName?: string | null;
  entityId?: string | null;
  /** Resumo legível before→after (ex.: "Severidade: MÉDIA → ALTA"). */
  change?: string | null;
  /** Metadados não-sensíveis (NUNCA segredos). */
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  /** Cliente afetado; `null` = ação global/admin. */
  tenantId?: string | null;
  /** Nome do cliente (snapshot); resolvido a partir do tenantId se omitido. */
  tenantName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  result?: AuditResult;
}

/**
 * Serviço central da trilha de auditoria (append-only). É **fire-and-forget**:
 * nunca derruba a ação principal se a gravação do log falhar. Faz snapshot do
 * ator e do nome do cliente para sobreviver à exclusão das entidades.
 *
 * Princípio de segurança: NENHUM segredo entra em `before`/`after`/metadados —
 * cabe a quem chama passar apenas dados seguros (ex.: diff de severidade).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      const tenantId = input.tenantId ?? null;
      const tenantName = tenantId
        ? (input.tenantName ?? (await this.resolveTenantName(tenantId)))
        : null;

      await this.prisma.auditLog.create({
        data: {
          tenantId,
          tenantName,
          actorUserId: input.actor?.id ?? null,
          actorName: input.actor?.name ?? null,
          actorEmail: input.actor?.email ?? 'desconhecido',
          actorRole: input.actor?.role ?? null,
          action: input.action,
          entityType: input.entityType ?? null,
          entityName: input.entityName ?? null,
          entityId: input.entityId ?? null,
          change: input.change ?? null,
          before: input.before ?? undefined,
          after: input.after ?? undefined,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          result: input.result ?? 'SUCCESS',
        },
      });
    } catch (err) {
      // Auditoria nunca pode quebrar a operação principal.
      this.logger.error(
        `Falha ao gravar evento de auditoria (${input.action}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async resolveTenantName(tenantId: string): Promise<string | null> {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });
      return tenant?.name ?? null;
    } catch {
      return null;
    }
  }
}
