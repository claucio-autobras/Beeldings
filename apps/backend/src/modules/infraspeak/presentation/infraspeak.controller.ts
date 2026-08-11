import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard.js';
import { Roles } from '../../auth/presentation/decorators/roles.decorator.js';
import { UserRole } from '../../auth/domain/interfaces/auth.interface.js';
import { CurrentUser } from '../../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import { AiRateLimitGuard } from '../../ai/ai-rate-limit.guard.js';
import {
  RequestsService,
  type CreateInfraspeakRequestInput,
  type InfraspeakFormOptions,
  type InfraspeakRequestItem,
  type InfraspeakRequestsResult,
} from '../application/requests.service.js';
import { TicketIndexService, type TicketSyncResult } from '../application/ticket-index.service.js';
import {
  TicketAnalysisService,
  type AnalyzeTicketInput,
  type TicketAnalysisResult,
} from '../application/ticket-analysis.service.js';

/**
 * Endpoints internos da integração Infraspeak. Leitura dos chamados e criação
 * de novo chamado (failure) no sandbox/produção conforme configuração. Segue o
 * padrão dos demais controllers do projeto, incluindo a proteção por
 * JwtAuthGuard. A criação (`POST /infraspeak/requests`) é registrada na trilha
 * de auditoria via allowlist do AuditInterceptor.
 */
@Controller('infraspeak')
@UseGuards(JwtAuthGuard)
export class InfraspeakController {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly ticketIndex: TicketIndexService,
    private readonly ticketAnalysis: TicketAnalysisService,
  ) {}

  /**
   * Retorna todos os chamados consolidados (paginação tratada internamente).
   * Filtros JQL aceitos pela Infraspeak podem ser repassados via query string.
   */
  @Get('/requests')
  async getRequests(@Query() query: Record<string, string>): Promise<InfraspeakRequestsResult> {
    return this.requestsService.findAll(query);
  }

  /**
   * Dados de apoio para o formulário de abertura de chamado (tipos de problema
   * folha e locais disponíveis na Infraspeak).
   */
  @Get('/form-options')
  async getFormOptions(): Promise<InfraspeakFormOptions> {
    return this.requestsService.getFormOptions();
  }

  /**
   * Cria um chamado (failure) na Infraspeak. Validação dos campos e mapeamento
   * de erros JSON:API acontecem no serviço/cliente.
   */
  @Post('/requests')
  async createRequest(
    @Body() body: CreateInfraspeakRequestInput,
  ): Promise<InfraspeakRequestItem & { name: string }> {
    const created = await this.requestsService.create(body ?? ({} as CreateInfraspeakRequestInput));
    // `name` dá um rótulo legível ao registro de auditoria (interceptor usa res.name).
    return { ...created, name: `Chamado Infraspeak #${created.id ?? '?'}` };
  }

  /**
   * Analista de IA: analisa um chamado existente (failureId) ou um rascunho e
   * recomenda ações fundamentadas em casos anteriores semelhantes da cópia
   * local. Rate limit por usuário (chama a API paga da Anthropic). Falha da IA
   * degrada para o contexto factual (aiError=true), nunca 5xx.
   */
  @Post('/requests/analyze')
  @UseGuards(AiRateLimitGuard)
  async analyzeRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AnalyzeTicketInput,
  ): Promise<TicketAnalysisResult> {
    return this.ticketAnalysis.analyze(user, body ?? {});
  }

  /**
   * Dispara manualmente uma passada de sincronização do histórico de chamados
   * (a periódica roda sozinha na instância líder). Nunca lança por
   * indisponibilidade da Infraspeak: o erro volta em `error`. Restrito a
   * papéis operacionais e sob o rate limit de IA: consome API externa
   * (Infraspeak + embeddings pagos) — não pode ser vetor de custo por abuso.
   */
  @Post('/tickets/sync')
  @UseGuards(RolesGuard, AiRateLimitGuard)
  @Roles(UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR)
  async syncTickets(): Promise<TicketSyncResult & { indexedTotal: number }> {
    const result = await this.ticketIndex.syncOnce();
    return { ...result, indexedTotal: await this.ticketIndex.countIndexed() };
  }

  /** Estado da base local de chamados (para a UI indicar cobertura da análise). */
  @Get('/tickets/status')
  async ticketsStatus(): Promise<{
    indexedTotal: number;
    lastRunAt: Date | null;
    indexing: boolean;
  }> {
    const status = this.ticketIndex.getStatus();
    return {
      indexedTotal: await this.ticketIndex.countIndexed(),
      lastRunAt: status.lastRunAt,
      indexing: status.indexing,
    };
  }
}
