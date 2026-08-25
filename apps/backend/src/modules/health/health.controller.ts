import { Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../auth/domain/interfaces/auth.interface.js';
import { StorageMonitorService } from './storage-monitor.service.js';
import type { StorageEnvironment } from './storage-monitor.service.js';
import { EmqxMonitorService } from './emqx-monitor.service.js';
import type { EmqxBrokerSnapshot } from './emqx-monitor.service.js';
import { EmqxReprovisionService } from './emqx-reprovision.service.js';
import type { EmqxReprovisionReport } from './emqx-reprovision.service.js';

/** Papéis administrativos que podem ver a saúde de infraestrutura. */
const ADMIN_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR]);

/**
 * HealthController — expõe métricas de saúde de infraestrutura.
 *
 * Diferente de /cluster/status (público), uso de storage é informação de
 * capacidade/operação, então fica atrás de JwtAuthGuard e restrito a papéis
 * administrativos.
 */
@Controller('health')
@UseGuards(JwtAuthGuard)
export class HealthController {
  constructor(
    private readonly storage: StorageMonitorService,
    private readonly emqxMonitor: EmqxMonitorService,
    private readonly emqxReprovision: EmqxReprovisionService,
  ) {}

  /** Saúde do broker EMQX (conexões, taxas, descartes) — admins globais. */
  @Get('broker')
  async getBroker(@CurrentUser() user: AuthenticatedUser): Promise<EmqxBrokerSnapshot> {
    if (!ADMIN_ROLES.has(user.role)) {
      throw new ForbiddenException('Acesso restrito a administradores');
    }
    return this.emqxMonitor.getSnapshot();
  }

  /**
   * Re-provisiona no EMQX as credenciais e ACLs de TODOS os gateways e
   * dispositivos cadastrados (recuperação após perda de estado do broker).
   * Idempotente; execução única por vez. Restrito ao ADMIN global — é uma
   * ação de escrita na infraestrutura.
   */
  @Post('broker/reprovision')
  async reprovisionBroker(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EmqxReprovisionReport> {
    if (user.role !== UserRole.ADMIN || user.tenantId) {
      throw new ForbiddenException('Ação restrita a administradores globais');
    }
    return this.emqxReprovision.reprovisionAll('manual');
  }

  /** Último relatório de re-provisionamento desta instância (ou null). */
  @Get('broker/reprovision')
  getReprovisionReport(
    @CurrentUser() user: AuthenticatedUser,
  ): { report: EmqxReprovisionReport | null } {
    if (!ADMIN_ROLES.has(user.role)) {
      throw new ForbiddenException('Acesso restrito a administradores');
    }
    return { report: this.emqxReprovision.getLastReport() };
  }

  /** Uso atual do banco vs. quota (para o dashboard de servidores). */
  @Get('storage')
  async getStorage(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{
    usedBytes: number;
    quotaBytes: number;
    percent: number;
    environment: StorageEnvironment;
    ingestionBlocked: boolean;
    blockPercent: number;
  }> {
    if (!ADMIN_ROLES.has(user.role)) {
      throw new ForbiddenException('Acesso restrito a administradores');
    }
    return this.storage.getStorageStatus();
  }

  /** Maiores tabelas por tamanho (drilldown do card de uso do banco). */
  @Get('storage/tables')
  async getStorageTables(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ tables: { name: string; bytes: number }[] }> {
    if (!ADMIN_ROLES.has(user.role)) {
      throw new ForbiddenException('Acesso restrito a administradores');
    }
    return { tables: await this.storage.getTableBreakdown() };
  }
}
