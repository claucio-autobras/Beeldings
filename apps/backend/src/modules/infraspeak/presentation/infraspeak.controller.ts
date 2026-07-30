import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import {
  RequestsService,
  type InfraspeakRequestsResult,
} from '../application/requests.service.js';

/**
 * Endpoint interno (somente leitura) que expõe os chamados do negócio obtidos
 * da Infraspeak. Segue o padrão dos demais controllers do projeto, incluindo a
 * proteção por JwtAuthGuard.
 */
@Controller('infraspeak')
@UseGuards(JwtAuthGuard)
export class InfraspeakController {
  constructor(private readonly requestsService: RequestsService) {}

  /**
   * Retorna todos os chamados consolidados (paginação tratada internamente).
   * Filtros JQL aceitos pela Infraspeak podem ser repassados via query string.
   */
  @Get('/requests')
  async getRequests(@Query() query: Record<string, string>): Promise<InfraspeakRequestsResult> {
    return this.requestsService.findAll(query);
  }
}
